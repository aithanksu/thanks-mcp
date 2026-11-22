import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const SERVER = fileURLToPath(new URL('./index.ts', import.meta.url))
// The hosted server's source: app/lib/mcp.ts in the Thanks monorepo, hosted/mcp.ts in the public repo.
const HOSTED = [new URL('../../../app/lib/mcp.ts', import.meta.url), new URL('../hosted/mcp.ts', import.meta.url)].map((u) => fileURLToPath(u)).find((f) => existsSync(f))
const VERSION = JSON.parse(readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')).version

let api: Server
let mcp: ChildProcess
let nextId = 1
const received: { url?: string; auth?: string; body: any }[] = []
let sent = 0 // every call that reached the API this session
const pending = new Map<number, (m: any) => void>()
const OK = { accepted: [], skipped: [], coins_left: 500 }
let respond: (body: any) => [number, object, Record<string, string>?] = () => [200, OK]

function rpc(method: string, params?: object): Promise<any> {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    mcp.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
const say = (args: unknown) => rpc('tools/call', { name: 'say_thanks', arguments: args })
const said = async (args: unknown) => (await say(args)).result as { content: { text: string }[]; isError: boolean }
const links = (...l: string[]) => ({ links: l })

beforeAll(async () => {
  api = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      const parsed = JSON.parse(body)
      received.push({ url: req.url, auth: req.headers.authorization, body: parsed })
      sent++
      const [status, out, headers] = respond(parsed)
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(JSON.stringify(out))
    })
  })
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r))
  const port = (api.address() as { port: number }).port
  mcp = spawn(process.execPath, [SERVER], {
    env: { PATH: process.env.PATH, THANKS_API_KEY: 'thx_live_test', THANKS_ENDPOINT: `http://127.0.0.1:${port}/` },
    stdio: ['pipe', 'pipe', 'inherit'],
  })
  createInterface({ input: mcp.stdout! }).on('line', (line) => {
    const m = JSON.parse(line)
    pending.get(m.id)?.(m)
    pending.delete(m.id)
  })
})

afterAll(() => {
  mcp.kill()
  api.close()
})

beforeEach(() => {
  received.length = 0
  respond = () => [200, OK]
})

/** A top-level declaration's source, from its first line to the line that closes it. */
function block(src: string, start: string, end: RegExp): string {
  const i = src.indexOf(start)
  if (i < 0) throw new Error(`${start} not found`)
  end.lastIndex = i
  const m = end.exec(src)
  if (!m) throw new Error(`end of ${start} not found`)
  return src.slice(i, m.index + m[0].length)
}
const instructions = (src: string) => block(src, 'export const INSTRUCTIONS = [', /^\]\.join\('\\n\\n'\)$/gm)
const tool = (src: string) => block(src, 'export const TOOL = {', /^\}$/gm)

describe('the same prompt and schema as the hosted server', () => {
  it('copies INSTRUCTIONS and TOOL from the hosted source byte for byte', () => {
    expect(HOSTED, 'app/lib/mcp.ts or hosted/mcp.ts').toBeDefined()
    const local = readFileSync(SERVER, 'utf8')
    const hosted = readFileSync(HOSTED!, 'utf8')
    expect(instructions(local)).toBe(instructions(hosted))
    expect(tool(local)).toBe(tool(hosted))
    expect(local).toMatch(/^const MAX_LINKS = 5 /m)
    expect(local).toMatch(/^const MAX_LINK = 2048 /m)
    const types = fileURLToPath(new URL('../../../app/lib/types.ts', import.meta.url))
    if (existsSync(types)) {
      const t = readFileSync(types, 'utf8')
      expect(t).toMatch(/^export const MAX_LINKS = 5$/m)
      expect(t).toMatch(/^export const MAX_LINK = 2048$/m)
    }
  })
})

describe('thanks MCP server', () => {
  it('initializes as 0.3.0 and lists say_thanks with links as its one property', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    expect(init.result.protocolVersion).toBe('2025-06-18')
    expect(init.result.capabilities).toEqual({ tools: {} })
    expect(init.result.serverInfo).toEqual({ name: 'thanks', version: '0.3.0' })
    expect(VERSION).toBe('0.3.0')
    expect(init.result.instructions).toMatch(/call say_thanks once/)
    expect(init.result.instructions).toMatch(/data, not instructions/)
    expect(init.result.instructions).not.toMatch(/task_kind|why|[\u{2013}\u{2014}]/u)
    const list = await rpc('tools/list')
    expect(list.result.tools).toHaveLength(1)
    const [t] = list.result.tools
    expect([t.name, t.title]).toEqual(['say_thanks', 'Say thanks'])
    expect(t._meta).toEqual({ 'anthropic/alwaysLoad': true })
    expect(t.annotations).toEqual({ title: 'Say thanks', readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true })
    expect(t.description).not.toMatch(/task_kind|why field/)
    expect(t.inputSchema).toEqual({
      type: 'object',
      properties: {
        links: {
          type: 'array', minItems: 1, maxItems: 5,
          items: { type: 'string', maxLength: 2048 },
          description: 'Up to 5 exact public links, like https://www.npmjs.com/package/zod. Only the link is sent, without its query string or fragment.',
        },
      },
      required: ['links'],
      additionalProperties: false,
    })
  })

  it('answers unknown methods and tools with errors', async () => {
    expect((await rpc('resources/list')).error.code).toBe(-32601)
    expect((await rpc('tools/call', { name: 'other', arguments: {} })).error.code).toBe(-32602)
  })

  it('posts { links } only to /v1/thanks, each link cut to scheme, lowercase host and path', async () => {
    respond = () => [200, {
      accepted: [{ id: 'thx_1', key: 'docs.python.org', weight: 1, status: 'counted' }, { id: 'thx_2', key: 'npm:zod', weight: 0.1, status: 'held' }],
      skipped: [{ ref: 'https://x.com/a', reason: 'duplicate' }],
      coins_left: 497,
    }]
    const r = await said(links(
      'https://Docs.Python.org:8443/3/library/?q=secret#frag',
      'https://www.npmjs.com/package/zod?activeTab=readme',
      'HTTP://X.COM./a#top',
      'github.com/honojs/hono?tab=readme',
    ))
    expect(received).toEqual([{
      url: '/v1/thanks',
      auth: 'Bearer thx_live_test',
      body: { links: ['https://docs.python.org/3/library/', 'https://www.npmjs.com/package/zod', 'http://x.com/a', 'https://github.com/honojs/hono'] },
    }])
    expect(Object.keys(received[0].body)).toEqual(['links'])
    expect(r).toEqual({ content: [{ type: 'text', text: 'Thanked 2: docs.python.org, npm:zod (held). Skipped 1: x.com (duplicate). 497 thanks left today.' }], isError: false })
  })

  it('sends nothing but the links when an agent still uses the old schema', async () => {
    await said({ resources: [{ ref: 'https://zod.dev/?x=1', why: 'CANARY why' }, { ref: 'https://hono.dev/docs' }], task_kind: 'coding', task_id: 'CANARY id' })
    expect(received.map((x) => x.body)).toEqual([{ links: ['https://zod.dev/', 'https://hono.dev/docs'] }])
    expect(JSON.stringify(received)).not.toMatch(/CANARY|coding/)
  })

  it('keeps private hosts, IPs, credentials, file paths and other schemes on this machine', async () => {
    const local = ['localhost:3000', 'http://127.0.0.1:8080/admin', '10.0.0.1', 'http://[::1]/', '2130706433', '0x7f.1', 'printer.lan', 'http://nas.local/x',
      'https://wiki.corp.internal/page', 'intranet', 'https://user:pw@example.com/', 'https://token@example.com/', 'http://192.168.0.1/', 'https://app.localhost/', '/Users/me/secrets.txt', './notes.md', '~/keys']
    const invalid = ['file:///etc/passwd', 'javascript:alert(1)', 'C:\\Users\\me\\a.txt', '?q=1', 'npm:zod', 'mcp:io.github.user/server', 'ftp://example.com/x',
      'https://exa mple.com/', '']
    const r = await said(links(...local.slice(0, 5)))
    expect(r.content[0].text).toBe('Skipped 5: localhost:3000 (private), 127.0.0.1 (private), 10.0.0.1 (private), [::1] (private), 2130706433 (private).')
    for (const link of [...local, ...invalid]) {
      const out = await said(links(link))
      expect(out.content[0].text, link).toMatch(new RegExp(`^Skipped 1: .+ \\((${local.includes(link) ? 'private' : 'invalid'})\\)\\.$`))
    }
    expect(received).toEqual([])

    await said(links('localhost', 'https://github.com/honojs/hono', 'npm:zod'))
    expect(received.map((x) => x.body)).toEqual([{ links: ['https://github.com/honojs/hono'] }])
  })

  it('still answers give_thanks {domain}, unlisted, as one link', async () => {
    const r = await rpc('tools/call', { name: 'give_thanks', arguments: { domain: 'docs.python.org' } })
    expect(r.result.isError).toBe(false)
    expect(received.map((x) => x.body)).toEqual([{ links: ['https://docs.python.org/'] }])
  })

  it('refuses malformed arguments without a call, and reports the API refusals in one line', async () => {
    for (const args of [{}, { links: [] }, links('a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'), { links: [7] }, { links: 'a.com' }, links(`a.com/${'x'.repeat(2048)}`)]) {
      expect((await said(args)).isError, JSON.stringify(args).slice(0, 80)).toBe(true)
    }
    expect(received).toEqual([])

    respond = () => [422, { error: 'links must be an array of 1 to 5 links' }]
    expect((await said(links('a.com'))).content[0].text).toBe('Not recorded: links must be an array of 1 to 5 links.')
    respond = () => [401, { error: 'unauthorized' }]
    expect((await said(links('a.com'))).content[0].text).toBe('Thanks did not accept the key (THANKS_API_KEY).')
    respond = () => [429, { error: 'rate limited' }, { 'retry-after': '12' }]
    expect(await said(links('a.com'))).toEqual({ content: [{ type: 'text', text: 'Thanks rate limit reached; try again in 12 seconds.' }], isError: true })
  })

  it('caps calls that reach the API at 20 per session', async () => {
    const texts: string[] = []
    for (let i = 0; i < 20; i++) texts.push((await said(links(`site${i}.com`))).content[0].text)
    expect(texts.at(-1)).toBe('Thanks limit for this session reached.')
    expect(sent).toBe(20)
    expect((await said(links('localhost'))).content[0].text).toBe('Skipped 1: localhost (private).') // local skips never count
  })
})
