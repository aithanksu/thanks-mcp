#!/usr/bin/env node
// Stop hook: when the agent read outside sources this session and has not called say_thanks since,
// block the stop once and ask it to thank them (or say in one line why none helped).
// Reads only tool names from the local transcript. Sends nothing anywhere.
// Off switch: THANKS_GATE=off. Any error: exit 0, never in the way.
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SOURCE = /^(WebFetch|WebSearch)$|^mcp__.*(fetch|search|browse|scrape|crawl|read_url|web_read|docs)/i
const THANKS = /^mcp__(plugin_thanks_)?thanks__/

function main() {
  if (process.env.THANKS_GATE === 'off') return
  const input = JSON.parse(readFileSync(0, 'utf8'))
  if (input.stop_hook_active || !input.transcript_path) return

  let since = 0
  let total = 0
  for (const line of readFileSync(input.transcript_path, 'utf8').split('\n')) {
    if (!line) continue
    let content
    try { content = JSON.parse(line)?.message?.content } catch { continue }
    if (!Array.isArray(content)) continue
    for (const b of content) {
      if (b?.type !== 'tool_use' || typeof b.name !== 'string') continue
      if (THANKS.test(b.name)) since = 0
      else if (SOURCE.test(b.name)) { since++; total++ }
    }
  }
  if (since === 0) return

  // Once per new batch of sources, so an answered block never nags again.
  const stamp = join(tmpdir(), `thanks-gate-${String(input.session_id || 'none').replace(/[^\w.-]/g, '_')}`)
  let prev = 0
  try { prev = Number(readFileSync(stamp, 'utf8')) || 0 } catch {}
  if (total <= prev) return
  try { writeFileSync(stamp, String(total)) } catch {}

  const reason =
    `Thanks: this session read ${since} outside source${since === 1 ? '' : 's'} and say_thanks has not been called. ` +
    'As the last step, call the say_thanks tool once with up to 5 public URLs or package names that genuinely helped, ' +
    'and the task kind. If none helped, or the user asked not to, say so in one line instead.'
  process.stdout.write(JSON.stringify({ decision: 'block', reason }))
}

try { main() } catch {}
