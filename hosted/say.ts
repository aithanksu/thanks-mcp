// The hosted server's code at https://mcp.aithanksu.com/mcp, copied from the Thanks app (app/lib/say.ts).
// Reference only: it is not built here. Imports starting with @/ are app internals.
import { db } from './db'
import { publicOrigin, SITE_HOST } from './hosts'
import { pgBytea } from './keys'
import { resolveRef } from './resolve'
import { MAX_LINKS, type Category, type Kind, type SayResult, type SkipReason, type ThanksBody, type ThanksResult } from './types'

// The write path shared by MCP say_thanks and POST /v1/thanks: check the body, resolve every link here, then
// one say_thanks call that checks the key and records the rest. The link is the only thing an agent sends that
// goes anywhere: parseBody keeps it and drops every other field before anything else runs.

/** One item as say_thanks takes it. */
export type Item = { i: number; kind: Kind; key: string; category: Category; name: string; canonical_url: string; url: string }
export type Plan = { refs: string[]; items: Item[]; skipped: { i: number; reason: SkipReason }[] }
type Said = Exclude<SayResult, { error: 'unauthorized' }>

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/**
 * { links }, or a legacy shape mapped to it: say_thanks { resources: [{ ref, why }], task_kind, task_id } and
 * give_thanks { domain }, still sent by installed clients. A string is the 422 message. An over-long link is no
 * error: the resolver skips it.
 */
export function parseBody(body: unknown): ThanksBody | string {
  if (!isObject(body)) return 'the body must be a JSON object'
  if (body.links === undefined && body.resources !== undefined) return fromResources(body.resources)
  if (body.links === undefined && body.domain !== undefined) return typeof body.domain === 'string' ? { links: [body.domain] } : 'domain must be a string'
  const { links } = body
  if (!Array.isArray(links) || links.length < 1 || links.length > MAX_LINKS) return `links must be an array of 1 to ${MAX_LINKS} links`
  const out: string[] = []
  for (const [i, link] of links.entries()) {
    if (typeof link !== 'string') return `links[${i}] must be a string`
    out.push(link)
  }
  return { links: out }
}

/** Each ref is kept; its why, and the task kind and id beside it, are never read. */
function fromResources(resources: unknown): ThanksBody | string {
  if (!Array.isArray(resources) || resources.length < 1 || resources.length > MAX_LINKS) return `resources must be an array of 1 to ${MAX_LINKS} items`
  const links: string[] = []
  for (const [i, r] of resources.entries()) {
    if (!isObject(r) || typeof r.ref !== 'string') return `resources[${i}] must be an object with a ref string`
    links.push(r.ref)
  }
  return { links }
}

/** Every link resolved here; the database only sees the ones with a key. */
export function plan(body: ThanksBody): Plan {
  const p: Plan = { refs: [], items: [], skipped: [] }
  body.links.forEach((link, i) => {
    p.refs.push(link)
    const r = resolveRef(link)
    if ('reason' in r) p.skipped.push({ i, reason: r.reason })
    else p.items.push({ i, kind: r.kind, key: r.key, category: r.category, name: r.name, canonical_url: r.canonicalUrl, url: r.url })
  })
  return p
}

/** The answer in request order, the skips made here and in the database together. */
export function merge(p: Plan, rpc: Said): ThanksResult {
  const byI = (a: { i: number }, b: { i: number }) => a.i - b.i
  return {
    accepted: [...rpc.accepted].sort(byI).map(({ id, key, weight, status }) => ({ id, key, weight, status })),
    skipped: [...p.skipped, ...rpc.skipped].sort(byI).map(({ i, reason }) => ({ ref: p.refs[i], reason })),
    coins_left: rpc.coins_left,
  }
}

/** A skipped link as the reply shows it: the host of a URL, else the link, printable and short. */
function short(ref: string): string {
  try {
    const host = new URL(ref).hostname
    if (host) return host
  } catch {
    // not a URL: shown as it was sent
  }
  return Array.from(ref.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()).slice(0, 60).join('')
}

/** The public site, not the app host the API runs on: its pages are the ones an agent's link opens. */
const siteHost = () => {
  const origin = publicOrigin()
  return origin ? new URL(origin).host : SITE_HOST
}

/** The one line an agent reads back, spec page 9. */
export function sayLine(r: ThanksResult, agent: string): string {
  const parts: string[] = []
  if (r.accepted.length) parts.push(`Thanked ${r.accepted.length}: ${r.accepted.map((a) => (a.status === 'held' ? `${a.key} (held)` : a.key)).join(', ')}.`)
  if (r.skipped.length) parts.push(`Skipped ${r.skipped.length}: ${r.skipped.map((s) => `${short(s.ref)} (${s.reason})`).join(', ')}.`)
  parts.push(`${r.coins_left} thanks left today.`, `${siteHost()}/a/${agent}`)
  return parts.join(' ')
}

/** Records the thanks for the key. Calls the database even when every link was skipped: it checks the key. */
export async function say(hash: Buffer, body: ThanksBody): Promise<{ agent: string; result: ThanksResult } | 'unauthorized'> {
  const p = plan(body)
  // say_thanks keeps its old four-argument signature (20261122000000_links_expand); the task fields are always null.
  const { data, error } = await db().rpc('say_thanks', { p_key_hash: pgBytea(hash), p_items: p.items, p_task_kind: null, p_task_id: null })
  if (error) throw new Error(`say_thanks: ${error.message}`)
  const out = data as SayResult
  if ('error' in out) return 'unauthorized'
  return { agent: out.agent, result: merge(p, out) }
}
