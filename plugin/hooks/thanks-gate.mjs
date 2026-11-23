#!/usr/bin/env node
// Asks the agent to say thanks when a task read outside sources and say_thanks was not called.
//   record (PostToolUse): counts web read tools per session: WebFetch, WebSearch, web_fetch, web_search, and
//                         MCP tools whose own name is on the WEB list below (fetch servers, browsers, Firecrawl,
//                         Brave, Exa, Tavily, Perplexity, Context7, DeepWiki, context-mode's ctx_fetch_and_index).
//                         Mail, chat, notes and local search tools never count.
//   stop   (Stop):        blocks the stop once per new batch of sources and asks for the thanks.
// Works in Claude Code and Grok Build: reads both input shapes (snake_case and camelCase) and both
// MCP tool names (mcp__server__tool and server__tool). Keeps a small counter file per session in the
// temp dir and sends nothing anywhere. Off switch: THANKS_GATE=off. Any error: exit 0.
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const THANKS = /thanks__(say|give)_thanks$/
// An allow-list of exact tool names, never a pattern like __.*search: a Gmail, Slack or local index search reads
// no public source. An MCP tool counts by its own name, the part after the last __.
const WEB = [
  'fetch', 'web_fetch', 'web_search', 'fetch_url', 'read_url', 'web_read', 'browse', 'scrape', 'crawl',
  'ctx_fetch_and_index', 'browser_navigate', 'puppeteer_navigate', 'playwright_navigate',
  'firecrawl_scrape', 'firecrawl_search', 'firecrawl_crawl', 'firecrawl_map', 'firecrawl_extract',
  'brave_web_search', 'brave_news_search', 'web_search_exa', 'crawling_exa', 'get_code_context_exa',
  'tavily-search', 'tavily-extract', 'tavily-crawl', 'tavily_search', 'tavily_extract',
  'perplexity_search', 'perplexity_ask', 'perplexity_research', 'get-library-docs', 'query-docs',
  'read_wiki_contents', 'read_wiki_structure',
]
const BUILT_IN = new Set(['WebFetch', 'WebSearch', 'web_fetch', 'web_search'])
const isSource = (tool) => BUILT_IN.has(tool) || (tool.includes('__') && WEB.includes(tool.slice(tool.lastIndexOf('__') + 2)))

function main() {
  if (process.env.THANKS_GATE === 'off') return
  const input = JSON.parse(readFileSync(0, 'utf8'))
  const session = String(input.session_id ?? input.sessionId ?? '')
  if (!session) return
  const file = join(tmpdir(), `thanks-gate-${session.replace(/[^\w.-]/g, '_')}.json`)
  let s = { since: 0, total: 0, asked: 0 }
  try { s = { ...s, ...JSON.parse(readFileSync(file, 'utf8')) } } catch {}
  const save = () => { try { writeFileSync(file, JSON.stringify(s)) } catch {} }

  if (process.argv[2] === 'record') {
    const tool = String(input.tool_name ?? input.toolName ?? '')
    if (THANKS.test(tool)) { s.since = 0; save() }
    else if (isSource(tool)) { s.since++; s.total++; save() }
    return
  }

  if (input.stop_hook_active || input.stopHookActive) return
  if (s.since === 0 || s.total <= s.asked) return
  s.asked = s.total
  save()
  const n = s.since
  const reason =
    `Thanks: this session read ${n} outside source${n === 1 ? '' : 's'} and say_thanks has not been called. ` +
    'As the last step, call the say_thanks tool once with the exact public links (up to 5) of the tools, sites, docs, ' +
    'APIs, MCP servers or packages that genuinely helped. If none helped, or the user asked not to, say so in one line instead.'
  process.stdout.write(JSON.stringify({ decision: 'block', reason }))
}

try { main() } catch {}
