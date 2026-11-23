// node --test src/thanks-gate.hook-test.mjs (npm test runs it): which tool calls count as a source, and what the stop asks for.
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import assert from 'node:assert/strict'

const HOOK = fileURLToPath(new URL('../plugin/hooks/thanks-gate.mjs', import.meta.url))
const TMP = mkdtempSync(join(tmpdir(), 'thanks-gate-test-'))
let n = 0
const run = (mode, input) =>
  spawnSync(process.execPath, [HOOK, mode], { input: JSON.stringify(input), env: { PATH: process.env.PATH, TMPDIR: TMP }, encoding: 'utf8' }).stdout

/** Records one tool call in a fresh session, then stops: the block reason, or '' when it lets the stop through. */
function stopAfter(tool, camel = false) {
  const session = `s${++n}`
  run('record', camel ? { sessionId: session, toolName: tool } : { session_id: session, tool_name: tool })
  return run('stop', { session_id: session })
}

const COUNT = ['WebFetch', 'WebSearch', 'web_fetch', 'web_search', 'mcp__fetch__fetch', 'mcp__brave__web_search', 'mcp__exa__web_fetch',
  'mcp__browser__fetch_url', 'mcp__reader__read_url', 'mcp__bu__browse', 'mcp__firecrawl__scrape', 'mcp__firecrawl__crawl', 'fetch__fetch']
const SKIP = ['mcp__claude_ai_Gmail__search_threads', 'mcp__claude_ai_Slack__slack_search_public', 'mcp__plugin_context-mode_context-mode__ctx_search',
  'mcp__plugin_context-mode_context-mode__ctx_fetch_and_index', 'mcp__notion__notion-search', 'mcp__linear__search_issues', 'mcp__docs__search_docs',
  'mcp__x__fetch_messages', 'mcp__x__browser_screenshot', 'Read', 'Grep', 'Bash', 'webfetch', 'mcp__thanks__say_thanks']

test('web read tools count as a source', () => {
  for (const tool of COUNT) assert.match(stopAfter(tool), /"decision":"block"/, tool)
  assert.match(stopAfter('WebFetch', true), /"decision":"block"/)
})

test('mail, chat, notes, local search and other tools do not', () => {
  for (const tool of SKIP) assert.equal(stopAfter(tool), '', tool)
})

test('the stop asks for links only, once, and say_thanks clears it', () => {
  const session = 'links'
  run('record', { session_id: session, tool_name: 'WebFetch' })
  const { reason } = JSON.parse(run('stop', { session_id: session }))
  assert.match(reason, /exact public links/)
  assert.match(reason, /tools, sites, docs, APIs, MCP servers or packages/)
  assert.doesNotMatch(reason, /task kind|task_kind|why|package names/)
  assert.equal(run('stop', { session_id: session }), '')
  run('record', { session_id: 'cleared', tool_name: 'WebSearch' })
  run('record', { session_id: 'cleared', tool_name: 'mcp__thanks__say_thanks' })
  assert.equal(run('stop', { session_id: 'cleared' }), '')
})
