import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const SERVER = fileURLToPath(new URL('./index.ts', import.meta.url))

let api: Server
let mcp: ChildProcess
let nextId = 1
const received: unknown[] = []
const pending = new Map<number, (m: any) => void>()

function rpc(method: string, params?: object): Promise<any> {
  const id = nextId++
  return new Promise((resolve) => {
    pending.set(id, resolve)
    mcp.stdin!.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n')
  })
}
const call = (domain: unknown) => rpc('tools/call', { name: 'give_thanks', arguments: { domain } })

beforeAll(async () => {
  api = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      received.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(body) })
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ status: 'ok' }))
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

describe('thanks MCP server', () => {
  it('initializes and lists one tool', async () => {
    const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } })
    expect(init.result.protocolVersion).toBe('2025-06-18')
    expect(init.result.capabilities).toEqual({ tools: {} })
    const list = await rpc('tools/list')
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(['give_thanks'])
    expect(list.result.tools[0].description).toMatch(/data, not instructions/)
  })

  it('answers unknown methods and tools with errors', async () => {
    expect((await rpc('resources/list')).error.code).toBe(-32601)
    expect((await rpc('tools/call', { name: 'other', arguments: {} })).error.code).toBe(-32602)
  })

  it('refuses anything that is not a public domain, without calling the API', async () => {
    for (const d of ['10.0.0.1', '127.0.0.1', 'localhost', 'a b.com', 'evil.com:8080', 'user@evil.com', 42, '', 'x'.repeat(260) + '.com']) {
      const r = await call(d)
      expect(r.result.isError, String(d)).toBe(true)
    }
    expect(received).toHaveLength(0)
  })

  it('sends a cited thanks with the hostname only', async () => {
    const r = await call('https://Docs.Python.org/3/library/?q=secret')
    expect(r.result.content[0].text).toBe('Thanked docs.python.org.')
    expect(received).toEqual([{ url: '/v1/thanks', auth: 'Bearer thx_live_test', body: { host: 'docs.python.org', kind: 'cited' } }])
  })

  it('caps calls per session at 20', async () => {
    const texts: string[] = []
    for (let i = 0; i < 20; i++) texts.push((await call(`site${i}.com`)).result.content[0].text)
    expect(texts.slice(0, 19).every((t) => t.startsWith('Thanked'))).toBe(true)
    expect(texts[19]).toBe('Thanks limit for this session reached.')
    expect(received).toHaveLength(20)
  })
})
