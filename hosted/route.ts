// The hosted server's code at https://app.aithanksu.com/mcp, copied from the Thanks app (app/app/mcp/route.ts).
// Reference only: it is not built here. Imports starting with @/ are app internals.
import { db } from '@/lib/db'
import { clientIp, json, readJson } from '@/lib/http'
import { handle, originAllowed, rpcError, text, versionAllowed, type ToolResult } from '@/lib/mcp'
import { keyHashFromHeader, pgBytea } from '@/lib/keys'
import { resourceMetadataUrl } from '@/lib/oauth'
import { allow } from '@/lib/redis'
import { MAX_BODY, type Status } from '@/lib/validate'

type RpcResult = { error?: 'unauthorized'; results?: { status: Status }[] }

function unauthorized(tokenSent: boolean): Response {
  const error = tokenSent ? 'error="invalid_token", ' : ''
  return json({ error: 'unauthorized' }, 401, { 'www-authenticate': `Bearer ${error}resource_metadata="${resourceMetadataUrl()}"` })
}

/** An MCP call cannot prove the agent read the site, so it always counts as the lowest kind. */
async function record(keyHash: Buffer, domain: string): Promise<ToolResult | 'unauthorized'> {
  const { data, error } = await db().rpc('ingest_thanks', {
    p_key_hash: pgBytea(keyHash),
    p_items: [{ type: 'website', id: domain, kind: 'cited' }],
  })
  if (error) return text('Thanks is temporarily unavailable.', true)
  const r = data as RpcResult
  if (r.error === 'unauthorized') return 'unauthorized'
  const status = r.results?.[0]?.status
  return text(said(status, domain))
}

/** What the agent reads back. A recorded thanks reminds it of any other site that helped. */
function said(status: Status | undefined, domain: string): string {
  switch (status) {
    case 'ok': return `Thanked ${domain}. If another site also helped with this task, thank it too, once each.`
    case 'duplicate': return `${domain} is already thanked today. Nothing more to do for it.`
    case 'opted_out': return `${domain} has opted out of Thanks. Nothing more to do for it.`
    case 'budget': return 'Today\'s thanks limit is reached. Nothing more to do today.'
    default: return `Not recorded for ${domain}.`
  }
}

export async function POST(req: Request) {
  if (!originAllowed(req.headers.get('origin'), process.env.SITE_URL ?? '')) {
    return json(rpcError(null, -32600, 'origin not allowed'), 403)
  }
  if (!(await allow(`mcp-ip:${clientIp(req)}`, 120, 60))) return json(rpcError(null, -32000, 'rate limited'), 429)

  const header = req.headers.get('authorization')
  const keyHash = keyHashFromHeader(header)
  if (!keyHash) return unauthorized(header !== null)

  if (!versionAllowed(req.headers.get('mcp-protocol-version'))) {
    return json(rpcError(null, -32600, 'unsupported MCP-Protocol-Version'), 400)
  }
  if (!(await allow(`mcp-k:${keyHash.subarray(0, 8).toString('hex')}`, 30, 60))) return json(rpcError(null, -32000, 'rate limited'), 429)

  const body = await readJson(req, MAX_BODY)
  if (body === undefined) return json(rpcError(null, -32700, 'parse error'), 400)

  const out = await handle(body, (domain) => record(keyHash, domain))
  if (out.status === 401) return unauthorized(true)
  if (out.status === 202) return new Response(null, { status: 202 })
  return json(out.body, out.status)
}

const notAllowed = () => new Response(null, { status: 405, headers: { allow: 'POST' } })
export const GET = notAllowed
export const DELETE = notAllowed
