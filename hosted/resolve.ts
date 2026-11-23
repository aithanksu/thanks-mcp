// The hosted server's code at https://app.aithanksu.com/mcp, copied from the Thanks app (app/lib/resolve.ts).
// Reference only: it is not built here. Imports starting with @/ are app internals.
import { parse } from 'tldts'
import {
  BITBUCKET_PAGES, CODEBERG_PAGES, DOCS_HOSTS, DOCS_PATHS, DOCS_RS_PAGES, DOCS_WORDS, ENGINE_KEYS, ENGINE_PATHS, ENGINE_SUBDOMAINS, GITLAB_PAGES,
  GITLAB_SUBPAGES, GO_DEEP_HOSTS, GO_STD, KNOWN_HOSTS, PRIVATE_DOMAINS, PRIVATE_HOSTS, PRIVATE_PATHS, PUBLIC_HOSTS, PUBLIC_PATHS_ONLY, SEARCH_ENGINES, SEARCH_KEYS, SHARE_WORDS, TOOL_HOSTS, MCP_TOKEN,
} from './resolve-data'
import { KIND_CATEGORY, type Kind, type Rejected, type Resolved } from './types'

// The naming rules: every link or shorthand becomes exactly one resource key on one of the six boards, and the
// first rule that matches wins. Pure, no I/O. The key alone decides the name and the canonical URL, so nothing an
// agent sends is shown on a public page except the link it used, cut to scheme, host and path.

const MAX_REF = 2048
const MAX_KEY = 300
// Every key prefix is also a shorthand, so every key is a ref that resolves to itself.
const WORDS = ['github', 'gitlab', 'codeberg', 'bitbucket', 'npm', 'pypi', 'crates', 'gem', 'go', 'packagist', 'nuget', 'pub', 'hex', 'maven', 'jsr', 'mcp', 'api', 'brew', 'docker', 'vscode', 'openvsx'] as const
type Word = (typeof WORDS)[number]
const SHORT = new RegExp(`^(${WORDS.join('|')}):`, 'i')
const PREFIXED = new RegExp(`^(${WORDS.join('|')}):(.+)$`)
const SCHEME = /^([a-z][a-z0-9+.-]*):/i
const BLOCKED = new Set(['javascript', 'data', 'vbscript', 'file', 'blob', 'about', 'mailto', 'tel', 'sms', 'ftp', 'ws', 'wss', 'ssh', 'git', 'chrome', 'view-source', 'intent', 'content', 'filesystem'])
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/
const PRIVATE = /(^|\.)(localhost|local|internal|lan|arpa)$/
const OWN = /(^|\.)aithanksu\.com$/
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/
const GH_OWNER = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,38}$/
const GH_REPO = /^[a-z0-9._-]{1,100}$/
// First path segments on github.com that are pages, not owners. github is an owner: github/gitignore is a repo.
const GH_PAGES = new Set([
  'about', 'account', 'apps', 'blog', 'business', 'codespaces', 'collections', 'contact', 'copilot', 'customer-stories',
  'dashboard', 'developer', 'discussions', 'education', 'enterprise', 'events', 'explore', 'features', 'gist',
  'home', 'integrations', 'issues', 'join', 'login', 'logout', 'marketplace', 'mobile', 'models', 'new', 'nonprofit',
  'notifications', 'organizations', 'orgs', 'partners', 'password_reset', 'premium-support', 'pricing', 'pulls', 'readme',
  'resources', 'search', 'security', 'sessions', 'settings', 'signup', 'site', 'solutions', 'sponsors', 'stars', 'team',
  'topics', 'trending', 'users', 'watching',
])
const NPM_PART = /^[a-z0-9~-][a-z0-9._~-]*$/
const PYPI = /^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/i
const MCP_NAME = /^([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\/([a-z0-9](?:[a-z0-9._-]*[a-z0-9])?)$/
const FORGE_OWNER = /^[a-z0-9_][a-z0-9_.-]{0,99}$/
const FORGE_REPO = /^[a-z0-9_.-]{1,100}$/
const GITLAB_SEG = /^[a-z0-9_][a-z0-9_.-]{0,254}$/
const BREW = /^[a-z0-9][a-z0-9@+._-]{0,99}$/
const DOCKER = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/
const PUBLISHER = /^[a-z0-9][a-z0-9_-]{0,99}$/
const EXT_NAME = /^[a-z0-9][a-z0-9._-]{0,99}$/
const SERVER_ID = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const CRATE = /^[a-z][a-z0-9_-]{0,63}$/
const GEM = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/
const GO_ELEM = /^[A-Za-z0-9._~-]{1,100}$/
const COMPOSER_VENDOR = /^[a-z0-9]([_.-]?[a-z0-9]+)*$/
const COMPOSER_NAME = /^[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/
const NUGET = /^[a-z0-9_][a-z0-9_.-]{0,99}$/
const PUB = /^[a-z_][a-z0-9_]{0,63}$/
const HEX = /^[a-z][a-z0-9_]{0,63}$/
const MAVEN = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,99}$/
const JSR = /^[a-z0-9][a-z0-9-]{0,57}$/
const VERSION = /^v\d+(\.\d+)?(alpha\d*|beta\d*)?$/

type Named = Omit<Resolved, 'url'>

const reject = (reason: Rejected['reason']): Rejected => ({ reason })
const named = (kind: Kind, key: string, name: string, canonicalUrl: string): Named => ({ kind, key, category: KIND_CATEGORY[kind], name, canonicalUrl })
/** A key past the column limit is no key. */
const checked = (r: Resolved): Resolved | Rejected => (r.key.length > MAX_KEY ? reject('invalid') : r)

/** Turns any link or shorthand an agent sends into its resource, or the reason it is skipped. */
export function resolveRef(input: unknown): Resolved | Rejected {
  if (typeof input !== 'string') return reject('invalid')
  const ref = input.trim()
  if (!ref || ref.length > MAX_REF) return reject('invalid')

  const short = SHORT.exec(ref)
  if (short) {
    const r = shorthand(short[1].toLowerCase() as Word, ref.slice(short[0].length).trim())
    // A shorthand stores its canonical URL, and a stored url never has a query: the Marketplace's itemName stays in the key.
    return 'reason' in r ? r : checked({ ...r, url: r.canonicalUrl.replace(/[?#].*$/, '') })
  }

  const href = withScheme(ref)
  if (!href) return reject('invalid')
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return reject('invalid')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return reject('invalid')
  if (u.username || u.password) return reject('private')
  const host = publicHost(u.hostname)
  if (typeof host !== 'string') return host
  // Stored without port, query or fragment, where most tokens live, and the path ends before any part that
  // still looks like one: the key never needs them.
  const url = `${u.protocol}//${u.hostname.replace(/\.$/, '')}${safePath(u.pathname)}`
  if (url.length > MAX_REF) return reject('invalid')
  const r = byRules(stripWww(host), u)
  return 'reason' in r ? r : checked({ ...r, url })
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const EMAIL = /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i

/**
 * A path part that is an id, a token or an email: a UUID, an address, 16 or more characters mixing letters and digits,
 * a run of 6 or more digits anywhere in it (ORD1234567, u12345678), or 9 or more digits split by dashes or spaces (415-555-1234).
 */
function secretPart(seg: string): boolean {
  if (UUID.test(seg) || EMAIL.test(seg) || /\d{6}/.test(seg) || (/^[\d\s-]+$/.test(seg) && (seg.match(/\d/g)?.length ?? 0) >= 9)) return true
  return seg.split(/[-_.~:+=,!*'()@$;]/).some((p) => p.length >= 16 && /[a-z]/i.test(p) && /\d/.test(p))
}

/**
 * The path as it is stored: cut before the first part that looks like a secret, and before the part after a
 * share word (/s/<id>, /share/<id>, /invite/<code>). The key is read from the whole link; only the stored url is cut.
 */
export function safePath(pathname: string): string {
  const raw = pathname.split('/')
  for (let i = 1; i < raw.length; i++) {
    const seg = decode(raw[i])
    if (seg && (secretPart(seg) || (i > 1 && SHARE_WORDS.has(decode(raw[i - 1]).toLowerCase())))) return raw.slice(0, i).join('/') || '/'
  }
  return pathname
}

/** A key's web path: the prefix and every colon after it become slashes, so mcp:smithery:x is mcp/smithery/x. Hosts and host/docs keys are their own path. */
export function keyToPath(key: string): string {
  const m = PREFIXED.exec(key)
  return m ? `${m[1]}/${m[2].replace(/:/g, '/')}` : key
}

/**
 * The key for a web or API path after /r/ or /v1/resources/: github/o/r, a raw key (github:o/r), or a
 * host (with /docs). The canonical key, so a caller can redirect a path that is not; null for anything else.
 */
export function pathToKey(segments: readonly string[]): string | null {
  const parts = segments.flatMap((s) => decode(s).split('/')).filter(Boolean)
  if (parts.length === 0) return null
  const joined = parts.join('/')
  const [head, ...rest] = parts
  let ref: string
  if (SHORT.test(joined)) ref = joined
  else if ((WORDS as readonly string[]).includes(head)) ref = pathRef(head as Word, rest)
  else if (head.includes('.')) ref = joined
  else return null
  const r = resolveRef(ref)
  return 'key' in r ? r.key : null
}

/** The ref a key path stands for: mcp/smithery/x is mcp:smithery:x, maven/g/a is maven:g:a. */
function pathRef(word: Word, rest: string[]): string {
  if (word === 'mcp' && ['smithery', 'glama'].includes(rest[0])) return `mcp:${rest[0]}:${rest.slice(1).join('/')}`
  return `${word}:${rest.join(word === 'maven' ? ':' : '/')}`
}

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** An https:// is added only when there is no scheme: host:port and user:pw@host have none. */
function withScheme(s: string): string | null {
  const m = SCHEME.exec(s)
  if (!m) return `https://${s}`
  const scheme = m[1].toLowerCase()
  if (scheme === 'http' || scheme === 'https') return s
  if (BLOCKED.has(scheme)) return null
  const rest = s.slice(m[0].length)
  if (rest.startsWith('//')) return null
  if (/^\d+(?:[/?#]|$)/.test(rest) || /^[^/?#]*@/.test(rest)) return `https://${s}`
  return null
}

/** The host as the rules match it, or why it can never be thanked. */
function publicHost(raw: string): string | Rejected {
  const host = raw.toLowerCase().replace(/\.$/, '')
  if (host.startsWith('[') || IPV4.test(host)) return reject('private')
  if (!host || host.length > 253) return reject('invalid')
  const labels = host.split('.')
  if (!labels.every((l) => LABEL.test(l))) return reject('invalid')
  if (labels.length < 2 || PRIVATE.test(host)) return reject('private')
  const t = parse(host, { allowPrivateDomains: true })
  if (t.isIp || !t.domain || !(t.isIcann || t.isPrivate)) return reject('private')
  if (OWN.test(host)) return reject('invalid')
  return host
}

/** www. off, unless only a public suffix is left: www.co.uk and www.github.io are sites of their own. */
function stripWww(host: string): string {
  const bare = host.replace(/^www\.(?=[^.]+\.)/, '')
  return bare === host || parse(bare, { allowPrivateDomains: true }).domain ? bare : host
}

/** A bare host after mcp:, api: or tool:, through the same URL parser and checks as a URL. */
function bareHost(s: string): string | Rejected {
  if (!/^[^/?#@:\s\\]+\/?$/.test(s)) return reject('invalid')
  let u: URL
  try {
    u = new URL(`https://${s}`)
  } catch {
    return reject('invalid')
  }
  const host = publicHost(u.hostname)
  if (typeof host !== 'string') return host
  const bare = stripWww(host)
  return isPrivate(bare, []) ? reject('private') : bare
}

function shorthand(word: Word, rest: string): Named | Rejected {
  const two = /^([^/]+)\/([^/]+?)\/?$/.exec(rest)
  const or = (r: Named | null | false) => r || reject('invalid')
  switch (word) {
    case 'github':
      return or(two && github(two[1], two[2]))
    case 'gitlab':
      return or(gitlab(rest.replace(/\/$/, '').split('/')))
    case 'codeberg':
    case 'bitbucket':
      return or(two && forge(word, two[1], two[2]))
    case 'npm':
      return or(npm(rest))
    case 'pypi':
      return or(pypi(rest))
    case 'crates':
      return or(crate(rest))
    case 'gem':
      return or(gem(rest))
    case 'go':
      return or(goModule(rest.split('/')))
    case 'packagist':
      return or(two && packagist(two[1], two[2]))
    case 'nuget':
      return or(nuget(rest))
    case 'pub':
      return or(pub(rest))
    case 'hex':
      return or(hex(rest))
    case 'maven': {
      const p = rest.split(':')
      return or(p.length === 2 && maven(p[0], p[1]))
    }
    case 'jsr': {
      const m = /^(@[^/]+)\/([^/]+)$/.exec(rest)
      return or(m && jsr(m[1], m[2]))
    }
    case 'brew':
      return or(rest.startsWith('cask/') ? brew(rest.slice(5), true) : brew(rest))
    case 'docker':
      return or(two && docker(two[1], two[2]))
    case 'vscode':
    case 'openvsx': {
      const id = splitId(rest)
      return or(id && extension(word, id[0], id[1]))
    }
    case 'mcp': {
      const sub = /^(smithery|glama):(.*)$/i.exec(rest)
      if (sub) return or(sub[1].toLowerCase() === 'smithery' ? smithery(sub[2].trim()) : glama(sub[2].trim()))
      if (rest.includes('/') && !/\/$/.test(rest)) return or(registry(rest))
      const host = bareHost(rest)
      return typeof host === 'string' ? mcpHost(host) : host
    }
    case 'api': {
      const host = bareHost(rest)
      return typeof host === 'string' ? apiNamed(host) : host
    }
  }
}

function byRules(host: string, u: URL): Named | Rejected {
  const path = u.pathname
  const segs = path.split('/').filter(Boolean).map(decode)
  // 1. Private or logged-in pages never leave as a thanks; a search result page is no resource.
  if (isPrivate(host, segs)) return reject('private')
  if (isSearch(host, segs, u.searchParams)) return reject('invalid')
  const gh = ghRepo(host, segs)
  // 2. MCP servers
  const mcp = mcpRule(host, path, segs, gh)
  if (mcp) return mcp
  // 3. Packages
  const pkg = packageRule(host, segs)
  if (pkg) return pkg
  // 4. Tools: repos, formulae, images, extensions and curated homepages
  const tools = toolRule(host, segs, u.searchParams, gh)
  if (tools) return tools
  // 5. APIs: the key is the host, the exact url is stored
  if (isApi(host, segs)) return apiNamed(host)
  // 6. Docs: a docs host is its own key; docs under a path get <host>/docs, apart from the site.
  const docs = docsRule(host, segs)
  if (docs) return docs
  // 7. Sites: the registrable domain. Private suffixes stay apart: x.github.io is not github.io.
  const site = parse(host, { allowPrivateDomains: true }).domain
  if (!site) return reject('invalid') // publicHost checked it; a host with no registrable domain is never a key
  // A curated tool keeps the site's key and goes on the tools board.
  return named(TOOL_HOSTS.has(site) ? 'tool' : 'site', site, site, `https://${site}/`)
}

function isPrivate(host: string, segs: readonly string[]): boolean {
  if (PUBLIC_HOSTS.has(host)) return false
  if (PRIVATE_HOSTS.has(host) || host.startsWith('webmail.')) return true
  if (PRIVATE_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`))) return true
  const first = segs[0]?.toLowerCase()
  const only = PUBLIC_PATHS_ONLY[host]
  if (only && first && !only.includes(first)) return true
  return Boolean(first && PRIVATE_PATHS[host]?.includes(first))
}

/** Only the query keys are looked at, never their values. */
function isSearch(host: string, segs: readonly string[], query: URLSearchParams): boolean {
  const has = (keys: readonly string[]) => keys.some((k) => query.has(k))
  const t = parse(host, { allowPrivateDomains: true })
  const engine = (SEARCH_ENGINES.has(t.domainWithoutSuffix ?? '') && ENGINE_SUBDOMAINS.has(t.subdomain ?? '')) || host === 'search.brave.com'
  if (engine && (ENGINE_PATHS.has(segs[0] ?? '') || has(ENGINE_KEYS))) return true
  if (apiHost(host)) return false // api.github.com/search is an endpoint
  return (segs.length === 0 || segs[0] === 'search' || segs[0] === 'results') && has(SEARCH_KEYS)
}

/** owner and repo of a github.com or raw.githubusercontent.com link, lowercased and checked. */
function ghRepo(host: string, segs: readonly string[]): [string, string] | null {
  if (segs.length < 2 || (host !== 'github.com' && host !== 'raw.githubusercontent.com')) return null
  if (host === 'github.com' && GH_PAGES.has(segs[0].toLowerCase())) return null
  return ghParts(segs[0], segs[1])
}

function mcpRule(host: string, path: string, segs: readonly string[], gh: [string, string] | null): Named | null {
  switch (host) {
    case 'registry.modelcontextprotocol.io': {
      // /v0.1/servers/<name, its slash encoded>/versions/latest; a server id or the list falls through to the API rule.
      const name = segs[segs.indexOf('servers') + 1]
      return segs.includes('servers') && name?.includes('/') ? registry(name) : null
    }
    case 'smithery.ai':
      return segs[0] === 'server' ? smithery(serverId(segs.slice(1))) : null
    case 'server.smithery.ai':
      return smithery(serverId(segs))
    case 'glama.ai':
      return segs[0] === 'mcp' && segs[1] === 'servers' ? glama(serverId(segs.slice(2))) : null
    case 'mcp.so':
      // /server/<name>/<GitHub owner>
      return segs[0] === 'server' && segs.length >= 3 ? github(segs[2], segs[1], 'mcp') : null
  }
  if (gh) return MCP_TOKEN.test(gh[1]) ? github(gh[0], gh[1]) : null
  if ((parse(host, { allowPrivateDomains: true }).subdomain ?? '').split('.').includes('mcp')) return mcpHost(host)
  // A remote server's endpoint. On a code host, a registry or a docs page, it is a page named mcp.
  if (/\/(mcp|sse)\/?$/i.test(path) && !KNOWN_HOSTS.has(host) && !isDocs(host, segs)) return mcpHost(host)
  return null
}

function packageRule(host: string, segs: readonly string[]): Named | null {
  const [a = '', b = '', c = ''] = segs
  // A scoped name is one segment with its slash encoded, or two.
  const scoped = (x: string, y: string) => (x.includes('/') || !x.startsWith('@') ? x : `${x}/${y}`)
  switch (host) {
    case 'npmjs.com':
      return a === 'package' && b ? npm(scoped(b, c)) : null
    case 'registry.npmjs.org':
      return a && !a.startsWith('-') ? npm(scoped(a, b)) : null
    case 'pypi.org':
      return (a === 'project' || a === 'simple') && b ? pypi(b) : null
    case 'crates.io':
      return a === 'crates' && b ? crate(b) : null
    case 'rubygems.org':
      return a === 'gems' && b ? gem(b) : null
    case 'pkg.go.dev':
      return goModule(segs)
    case 'packagist.org':
      return a === 'packages' ? packagist(b, c) : null
    case 'nuget.org':
      return a === 'packages' && b ? nuget(b) : null
    case 'pub.dev':
    case 'pub.dartlang.org':
      return a === 'packages' && b ? pub(b) : null
    case 'hex.pm':
      return a === 'packages' && b ? hex(b) : null
    case 'central.sonatype.com':
    case 'search.maven.org':
    case 'mvnrepository.com':
      return a === 'artifact' ? maven(b, c) : null
    case 'jsr.io':
      return a.startsWith('@') ? jsr(a, b) : null
  }
  return null
}

function toolRule(host: string, segs: readonly string[], query: URLSearchParams, gh: [string, string] | null): Named | null {
  if (gh) return github(gh[0], gh[1])
  const [a = '', b = '', c = ''] = segs
  switch (host) {
    case 'gitlab.com': {
      // A project path ends at /-/, or at a reserved subpage in a legacy link.
      const dash = segs.indexOf('-')
      const stop = dash >= 0 ? dash : segs.findIndex((s, i) => i >= 2 && GITLAB_SUBPAGES.has(s))
      return gitlab(stop >= 0 ? segs.slice(0, stop) : segs)
    }
    case 'codeberg.org':
      return CODEBERG_PAGES.has(a) ? null : forge('codeberg', a, b)
    case 'bitbucket.org':
      return BITBUCKET_PAGES.has(a) ? null : forge('bitbucket', a, b)
    case 'formulae.brew.sh':
      return a === 'formula' ? brew(b) : a === 'cask' ? brew(b, true) : null
    case 'hub.docker.com':
      if (a === '_') return docker('library', b)
      if (a === 'r' || a === 'layers') return b === '_' ? docker('library', c) : docker(b, c)
      return null
    case 'open-vsx.org':
      return a === 'extension' ? extension('openvsx', b, c) : null
    case 'marketplace.visualstudio.com': {
      // The one query value ever read, and it goes into the key only.
      const id = a === 'items' ? splitId(query.get('itemName') ?? '') : null
      return id && extension('vscode', id[0], id[1])
    }
  }
  return null
}

const apiHost = (host: string) => host.startsWith('api.') || host.includes('.api.')
const apiNamed = (host: string) => named('api', `api:${host}`, host, `https://${host}/`)

/**
 * An api.* host, or an /api/..., /vN or /graphql path that is not docs: nodejs.org/api and MDN's /docs/Web/API
 * are docs. A bare /api is a docs landing page (zod.dev/api), not an endpoint.
 */
function isApi(host: string, segs: readonly string[]): boolean {
  if (apiHost(host)) return true
  if (isDocs(host, segs)) return false
  return segs.slice(0, 3).some((s, i) => (s === 'api' && i < segs.length - 1) || s === 'graphql' || VERSION.test(s))
}

const docsHost = (host: string) =>
  host.startsWith('docs.') || host.startsWith('developer.') || host.startsWith('developers.') || host.endsWith('.readthedocs.io') || DOCS_HOSTS.has(host)
/** A curated docs path, or a docs word in the first three segments: after a locale, a product or a version. */
const docsUnder = (host: string, segs: readonly string[]) =>
  Boolean(segs[0] && DOCS_PATHS[host]?.includes(segs[0])) || segs.slice(0, 3).some((s) => DOCS_WORDS.has(s))
const isDocs = (host: string, segs: readonly string[]) => docsHost(host) || docsUnder(host, segs)

function docsRule(host: string, segs: readonly string[]): Named | null {
  if (host === 'docs.rs') {
    const n = (segs[0] === 'crate' ? segs[1] : segs[0])?.toLowerCase()
    if (n && CRATE.test(n) && !DOCS_RS_PAGES.has(n)) return named('docs', `docs.rs/${n}`, `docs.rs/${n}`, `https://docs.rs/${n}`)
  }
  if (docsHost(host)) return named('docs', host, host, `https://${host}/`)
  if (docsUnder(host, segs)) return named('docs', `${host}/docs`, `${host}/docs`, `https://${host}/docs`)
  return null
}

// ---------- one maker per key format; each checks its parts and gives null for anything else ----------

function ghParts(owner: string, repo: string): [string, string] | null {
  const o = owner.toLowerCase()
  const r = repo.toLowerCase().replace(/\.git$/, '')
  return GH_OWNER.test(o) && GH_REPO.test(r) && !/^\.+$/.test(r) ? [o, r] : null
}

/** One key per repo, github:<o>/<r>. A repo with an mcp name part, or one mcp.so lists, is on the MCP board. */
function github(owner: string, repo: string, kind?: 'mcp'): Named | null {
  const p = ghParts(owner, repo)
  const k = kind ?? (p && MCP_TOKEN.test(p[1]) ? 'mcp' : 'repo')
  return p && named(k, `github:${p[0]}/${p[1]}`, `${p[0]}/${p[1]}`, `https://github.com/${p[0]}/${p[1]}`)
}

/** A project path, nested groups and all, up to GitLab's 20 levels. */
function gitlab(path: readonly string[]): Named | null {
  const segs = path.map((s) => s.toLowerCase())
  if (segs.length < 2 || segs.length > 20 || GITLAB_PAGES.has(segs[0])) return null
  segs[segs.length - 1] = segs[segs.length - 1].replace(/\.git$/, '')
  if (!segs.every((s) => GITLAB_SEG.test(s) && !/^\.+$/.test(s) && !s.endsWith('.atom'))) return null
  const p = segs.join('/')
  return named('repo', `gitlab:${p}`, p, `https://gitlab.com/${p}`)
}

function forge(which: 'codeberg' | 'bitbucket', owner: string, repo: string): Named | null {
  const o = owner.toLowerCase()
  const r = repo.toLowerCase().replace(/\.git$/, '')
  if (!FORGE_OWNER.test(o) || !FORGE_REPO.test(r) || /^\.+$/.test(r)) return null
  return named('repo', `${which}:${o}/${r}`, `${o}/${r}`, `https://${which}.org/${o}/${r}`)
}

function brew(raw: string, cask = false): Named | null {
  const n = raw.toLowerCase()
  if (!BREW.test(n)) return null
  const id = cask ? `cask/${n}` : n
  return named('brew', `brew:${id}`, id, `https://formulae.brew.sh/${cask ? 'cask' : 'formula'}/${n}`)
}

/** Official images live in the library namespace, shown by their bare name. */
function docker(namespace: string, image: string): Named | null {
  const ns = namespace.toLowerCase()
  const n = image.toLowerCase()
  if (!DOCKER.test(ns) || !DOCKER.test(n) || ns.length > 255 || n.length > 255) return null
  return ns === 'library'
    ? named('docker', `docker:library/${n}`, n, `https://hub.docker.com/_/${n}`)
    : named('docker', `docker:${ns}/${n}`, `${ns}/${n}`, `https://hub.docker.com/r/${ns}/${n}`)
}

/** publisher.name, split at the first dot: a publisher has none. */
function splitId(id: string): [string, string] | null {
  const i = id.indexOf('.')
  return i > 0 ? [id.slice(0, i), id.slice(i + 1)] : null
}

/** Extension ids are case-insensitive. The Marketplace's canonical URL keeps itemName: it comes from the key. */
function extension(registry: 'vscode' | 'openvsx', publisher: string, name: string): Named | null {
  const p = publisher.toLowerCase()
  const n = name.toLowerCase()
  if (!PUBLISHER.test(p) || !EXT_NAME.test(n)) return null
  const id = `${p}.${n}`
  return named('extension', `${registry}:${id}`, id, registry === 'vscode' ? `https://marketplace.visualstudio.com/items?itemName=${id}` : `https://open-vsx.org/extension/${p}/${n}`)
}

/** npm names lowercased, with any @version dropped; scoped names keep their scope. */
function npm(raw: string): Named | null {
  const s = raw.trim().toLowerCase()
  const m = /^(@[^/@]+\/[^/@]+|[^/@]+)(?:@[^/]*)?$/.exec(s)
  if (!m) return null
  const name = m[1]
  if (name.length > 214 || !name.split('/').every((p) => NPM_PART.test(p.replace(/^@/, '')))) return null
  if (name.startsWith('@') && name.split('/')[0].length < 2) return null
  return named('npm', `npm:${name}`, name, `https://www.npmjs.com/package/${name}`)
}

/** PEP 503: lowercase, and every run of - _ . becomes one -. A version or extras after the name is dropped. */
function pypi(raw: string): Named | null {
  const name = raw.trim().split(/[=<>!~;[\s@(/]/, 1)[0]
  if (!name || name.length > 200 || !PYPI.test(name)) return null
  const n = name.toLowerCase().replace(/[-_.]+/g, '-')
  return named('pypi', `pypi:${n}`, n, `https://pypi.org/project/${n}/`)
}

function crate(raw: string): Named | null {
  const n = raw.toLowerCase()
  return CRATE.test(n) ? named('crate', `crates:${n}`, n, `https://crates.io/crates/${n}`) : null
}

/** Gem names keep their case: RubyGems tells them apart. */
const gem = (raw: string): Named | null => (GEM.test(raw) ? named('gem', `gem:${raw}`, raw, `https://rubygems.org/gems/${raw}`) : null)

/**
 * A pkg.go.dev path cut to its module: host/owner/repo on code hosts, host/name elsewhere, plus a /vN major
 * version. Go paths are case sensitive, so only the host is lowercased. The standard library is go:std.
 */
function goModule(path: readonly string[]): Named | null {
  const parts = [...path]
  const at = parts.findIndex((p) => p.includes('@'))
  if (at >= 0) {
    parts[at] = parts[at].slice(0, parts[at].indexOf('@'))
    parts.length = at + 1
  }
  const host = (parts[0] ?? '').toLowerCase()
  if (!host.includes('.')) return GO_STD.has(host) ? named('go', 'go:std', 'std', 'https://pkg.go.dev/std') : null
  if (typeof publicHost(host) !== 'string') return null
  const n = GO_DEEP_HOSTS.has(host) ? 3 : 2
  if (parts.length < n) return null
  const mod = [host, ...parts.slice(1, n)]
  if (parts[n] && /^v\d+$/.test(parts[n])) mod.push(parts[n])
  if (!mod.slice(1).every((e) => GO_ELEM.test(e) && !/^\.+$/.test(e))) return null
  const m = mod.join('/')
  return named('go', `go:${m}`, m, `https://pkg.go.dev/${m}`)
}

function packagist(vendor: string, pkg: string): Named | null {
  const v = vendor.toLowerCase()
  const p = pkg.toLowerCase()
  if (!COMPOSER_VENDOR.test(v) || !COMPOSER_NAME.test(p)) return null
  return named('packagist', `packagist:${v}/${p}`, `${v}/${p}`, `https://packagist.org/packages/${v}/${p}`)
}

/** NuGet ids are case-insensitive: the key is lowercased. */
function nuget(raw: string): Named | null {
  const n = raw.toLowerCase()
  return NUGET.test(n) ? named('nuget', `nuget:${n}`, n, `https://www.nuget.org/packages/${n}`) : null
}

function pub(raw: string): Named | null {
  const n = raw.toLowerCase()
  return PUB.test(n) ? named('pub', `pub:${n}`, n, `https://pub.dev/packages/${n}`) : null
}

function hex(raw: string): Named | null {
  const n = raw.toLowerCase()
  return HEX.test(n) ? named('hex', `hex:${n}`, n, `https://hex.pm/packages/${n}`) : null
}

/** Maven coordinates keep their case. */
function maven(group: string, artifact: string): Named | null {
  if (!MAVEN.test(group) || !MAVEN.test(artifact)) return null
  return named('maven', `maven:${group}:${artifact}`, `${group}:${artifact}`, `https://central.sonatype.com/artifact/${group}/${artifact}`)
}

/** @scope/name, with any @version dropped. */
function jsr(scope: string, pkg: string): Named | null {
  const s = scope.toLowerCase().replace(/^@/, '')
  const n = pkg.toLowerCase().split('@', 1)[0]
  if (!scope.startsWith('@') || !JSR.test(s) || !JSR.test(n)) return null
  return named('jsr', `jsr:@${s}/${n}`, `@${s}/${n}`, `https://jsr.io/@${s}/${n}`)
}

const mcpHost = (host: string) => named('mcp', `mcp:${host}`, host, `https://${host}/mcp`)

/** A Smithery or Glama server id: @owner/name, or a single name. */
const serverId = (segs: readonly string[]) => (segs[0]?.startsWith('@') ? segs.slice(0, 2).join('/') : (segs[0] ?? ''))

function smithery(raw: string): Named | null {
  const s = raw.toLowerCase()
  return s.length <= 200 && SERVER_ID.test(s) ? named('mcp', `mcp:smithery:${s}`, s, `https://smithery.ai/server/${s}`) : null
}

function glama(raw: string): Named | null {
  const s = raw.toLowerCase()
  return s.length <= 200 && SERVER_ID.test(s) ? named('mcp', `mcp:glama:${s}`, s, `https://glama.ai/mcp/servers/${s}`) : null
}

/** An MCP Registry name, reverse DNS then a name. Its namespace must be a public domain. */
function registry(raw: string): Named | null {
  const s = raw.trim().toLowerCase()
  const m = MCP_NAME.exec(s)
  if (!m || s.length > 200) return null
  const domain = m[1].split('.').reverse().join('.')
  if (typeof publicHost(domain) !== 'string') return null
  const gh = /^io\.github\.([a-z0-9-]+)$/.exec(m[1])
  return gh
    ? named('mcp', `mcp:${s}`, `${gh[1]}/${m[2]}`, `https://github.com/${gh[1]}/${m[2]}`)
    : named('mcp', `mcp:${s}`, s, `https://${domain}/`)
}
