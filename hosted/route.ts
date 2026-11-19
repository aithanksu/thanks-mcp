// The hosted server's code at https://app.aithanksu.com/mcp, copied from the Thanks app (app/app/mcp/route.ts).
// Reference only: it is not built here. Imports starting with @/ are app internals.
import { bearer, ownerGate } from '@/lib/bearer'
import { db } from '@/lib/db'
import { mcpOrigins } from '@/lib/hosts'
import { clientIp, json, MAX_BODY, readJson } from '@/lib/http'
import { pgBytea } from '@/lib/keys'
import { handle, originAllowed, rpcError, text, versionAllowed, type Hooks } from '@/lib/mcp'
import { resourceMetadataUrl } from '@/lib/oauth'
import { allow } from '@/lib/redis'
import { say, sayLine } from '@/lib/say'

function unauthorized(req: Request, tokenSent: boolean): Response {
  const error = tokenSent ? 'error="invalid_token", ' : ''
  return json({ error: 'unauthorized' }, 401, { 'www-authenticate': `Bearer ${error}resource_metadata="${resourceMetadataUrl(req)}"` })
}

function hooks(hash: Buffer): Hooks {
  return {
    async say(body) {
      try {
        const gate = await ownerGate(hash)
        if (gate) return gate
        const out = await say(hash, body)
        return out === 'unauthorized' ? { status: 401 } : text(sayLine(out.result, out.agent))
      } catch (e) {
        console.error(e)
        return text('Thanks is temporarily unavailable.', true)
      }
    },
    // The client's name is a label, so a failure here never fails initialize.
    async hello(name, version) {
      try {
        const { error } = await db().rpc('touch_agent', { p_key_hash: pgBytea(hash), p_client_name: name, p_client_version: version })
        if (error) console.error(`touch_agent: ${error.message}`)
      } catch (e) {
        console.error(e)
      }
    },
  }
}

export async function POST(req: Request) {
  if (!originAllowed(req.headers.get('origin'), mcpOrigins())) {
    return json(rpcError(null, -32600, 'origin not allowed'), 403)
  }
  if (!(await allow(`mcp-ip:${clientIp(req)}`, 120, 60))) return json(rpcError(null, -32000, 'rate limited'), 429)

  const keyHash = bearer(req)
  if (!keyHash) return unauthorized(req, req.headers.get('authorization') !== null)

  if (!versionAllowed(req.headers.get('mcp-protocol-version'))) {
    return json(rpcError(null, -32600, 'unsupported MCP-Protocol-Version'), 400)
  }
  if (!(await allow(`mcp-k:${keyHash.subarray(0, 8).toString('hex')}`, 30, 60))) return json(rpcError(null, -32000, 'rate limited'), 429)

  const body = await readJson(req, MAX_BODY)
  if (body === undefined) return json(rpcError(null, -32700, 'parse error'), 400)

  const out = await handle(body, hooks(keyHash))
  if (out.status === 401) return unauthorized(req, true)
  if (out.status === 202) return new Response(null, { status: 202 })
  if (out.status === 429) return json(out.body, 429, { 'retry-after': String(out.retryAfter ?? 60) })
  return json(out.body, out.status)
}

const notAllowed = () => new Response(null, { status: 405, headers: { allow: 'POST' } })
export const GET = notAllowed
export const DELETE = notAllowed
