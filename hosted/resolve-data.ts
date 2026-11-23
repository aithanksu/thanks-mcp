// The hosted server's code at https://app.aithanksu.com/mcp, copied from the Thanks app (app/lib/resolve-data.ts).
// Reference only: it is not built here. Imports starting with @/ are app internals.
// The host lists the naming rules in resolve.ts read. Hosts are lowercase with www. removed.

// ---------- private: never a public resource ----------

/** Public hosts inside a private domain below. Checked first. */
export const PUBLIC_HOSTS = new Set(['api.slack.com', 'sentry.io', 'docs.sentry.io', 'blog.sentry.io', 'developers.zoom.us', 'developer.zendesk.com', 'zendesk.com'])

/** Mail, documents, chats, consoles and dashboards: these exact hosts. */
export const PRIVATE_HOSTS = new Set([
  // Google Workspace and Google consoles
  'mail.google.com', 'inbox.google.com', 'docs.google.com', 'drive.google.com', 'sheets.google.com', 'slides.google.com', 'forms.gle',
  'calendar.google.com', 'meet.google.com', 'chat.google.com', 'keep.google.com', 'contacts.google.com', 'photos.google.com', 'groups.google.com',
  'voice.google.com', 'jamboard.google.com', 'script.google.com', 'myaccount.google.com', 'accounts.google.com', 'admin.google.com', 'takeout.google.com',
  'analytics.google.com', 'lookerstudio.google.com', 'datastudio.google.com', 'search.google.com', 'ads.google.com', 'console.cloud.google.com',
  'console.firebase.google.com', 'colab.research.google.com', 'gemini.google.com', 'aistudio.google.com', 'notebooklm.google.com',
  // Microsoft 365, Outlook and Azure
  'outlook.live.com', 'outlook.office.com', 'outlook.office365.com', 'outlook.com', 'office.com', 'm365.cloud.microsoft', 'teams.microsoft.com', 'teams.live.com',
  'onedrive.live.com', '1drv.ms', 'forms.office.com', 'loop.microsoft.com', 'to-do.office.com', 'onenote.com', 'copilot.microsoft.com', 'portal.azure.com',
  'dev.azure.com', 'entra.microsoft.com', 'admin.microsoft.com', 'login.microsoftonline.com', 'login.live.com', 'account.microsoft.com',
  // Other mail
  'mail.yahoo.com', 'mail.proton.me', 'mail.zoho.com', 'mail.aol.com', 'app.fastmail.com', 'app.hey.com',
  // Workspaces and file shares
  'linear.app', 'uploads.linear.app', 'embed.figma.com', 'app.asana.com', 'app.clickup.com', 'app.hubspot.com', 'app.intercom.com', 'db.tt',
  'gist.github.com', 'gist.githubusercontent.com', 'github.dev', 'pastebin.com',
  // Chats
  'chat.openai.com', 'claude.ai', 'poe.com', 'perplexity.ai', 'chat.mistral.ai', 'chat.deepseek.com', 'grok.com', 'character.ai', 'meta.ai',
  // Consoles and dashboards
  'dashboard.stripe.com', 'connect.stripe.com', 'billing.stripe.com', 'checkout.stripe.com', 'invoice.stripe.com', 'pay.stripe.com', 'buy.stripe.com',
  'signin.aws.amazon.com', 'console.anthropic.com', 'app.supabase.com', 'app.netlify.com', 'dashboard.render.com', 'dashboard.heroku.com',
  'app.planetscale.com', 'console.neon.tech', 'cloud.mongodb.com', 'app.snowflake.com', 'app.terraform.io', 'app.circleci.com',
  'app.posthog.com', 'us.posthog.com', 'eu.posthog.com', 'app.datadoghq.com', 'app.datadoghq.eu', 'admin.shopify.com', 'appstoreconnect.apple.com',
  'app.mercury.com', 'app.gusto.com', 'app.ramp.com', 'dashboard.brex.com', 'vault.bitwarden.com',
  // Messages, invites and short links that can point anywhere
  'web.whatsapp.com', 'web.telegram.org', 'messenger.com', 'messages.google.com', 'discord.gg', 'g.co',
])

/** A domain whose own host and every subdomain are private: workspaces named after a company, and tunnels to the user's own machine. */
export const PRIVATE_DOMAINS = [
  'notion.so', 'notion.site', 'slack.com', 'atlassian.net', 'jira.com', 'dropbox.com', 'dropboxusercontent.com', 'icloud.com', 'sharepoint.com',
  'chatgpt.com', 'googleusercontent.com', 'console.aws.amazon.com', 'awsapps.com', 'dash.cloudflare.com', 'sentry.io', 'zendesk.com',
  'my.salesforce.com', 'lightning.force.com', 'zoom.us', 'docsend.com', 'app.github.dev',
  'ngrok.io', 'ngrok.app', 'ngrok.dev', 'ngrok-free.app', 'ngrok-free.dev', 'trycloudflare.com', 'ts.net', 'loca.lt', 'localtunnel.me', 'serveo.net',
  'lhr.life', 'devtunnels.ms',
  // Shared files and object storage: the path is the bucket, the file or the share token
  'app.box.com', 'storage.googleapis.com', 'storage.cloud.google.com', 's3.amazonaws.com', 'blob.core.windows.net', 'r2.cloudflarestorage.com',
]

/** Private under these first path segments of an otherwise public host. */
export const PRIVATE_PATHS: Record<string, readonly string[]> = {
  'github.com': ['settings', 'notifications', 'dashboard', 'codespaces', 'account', 'sessions', 'login', 'logout', 'password_reset', 'signup', 'new', 'pulls', 'issues', 'watching', 'copilot', 'organizations', 'orgs', 'enterprises'],
  'gitlab.com': ['-', 'dashboard', 'profile', 'admin'],
  'codeberg.org': ['user', 'notifications', 'issues', 'pulls', 'milestones'],
  'bitbucket.org': ['account', 'dashboard'],
  'npmjs.com': ['settings', 'login', 'logout', 'signup'],
  'pypi.org': ['manage', 'account'],
  'hub.docker.com': ['settings', 'orgs', 'repositories', 'billing', 'account'],
  'figma.com': ['file', 'files', 'design', 'board', 'proto', 'slides', 'deck', 'jam', 'make', 'buzz', 'site', 'whiteboard'],
  'supabase.com': ['dashboard'],
  'vercel.com': ['dashboard', 'account', 'login', 'signup', 'new'],
  'platform.openai.com': ['settings', 'usage', 'api-keys', 'account', 'organization', 'playground', 'logs', 'storage', 'assistants', 'chat', 'finetune', 'batches'],
  'huggingface.co': ['settings', 'chat', 'notifications', 'login', 'join'],
  'developer.apple.com': ['account'],
  'play.google.com': ['console'],
  'trello.com': ['b', 'c', 'w'],
  'miro.com': ['app'],
  'canva.com': ['design', 'folder', 'brand'],
  'loom.com': ['share', 'embed', 'looms', 'folder', 'record'],
  'discord.com': ['channels', 'app', 'login', 'register', 'invite', 'oauth2'],
  'x.com': ['messages', 'i', 'settings', 'notifications', 'home', 'compose'],
  'twitter.com': ['messages', 'i', 'settings', 'notifications', 'home', 'compose'],
  'linkedin.com': ['messaging', 'mynetwork', 'notifications', 'settings', 'sales', 'talent', 'feed'],
  'facebook.com': ['messages', 'settings', 'notifications', 'friends'],
  'instagram.com': ['direct', 'accounts'],
  'railway.com': ['project', 'dashboard', 'account', 'workspace'],
  'railway.app': ['project', 'dashboard', 'account', 'workspace'],
  'fly.io': ['dashboard', 'apps', 'user', 'orgs'],
}

/** Hosts where only these first path segments (and the home page) are public: every other path is a team or project dashboard. */
export const PUBLIC_PATHS_ONLY: Record<string, readonly string[]> = {
  'vercel.com': ['docs', 'blog', 'templates', 'pricing', 'changelog', 'guides', 'home', 'features', 'enterprise', 'customers', 'contact', 'legal',
    'solutions', 'products', 'ai', 'integrations', 'marketplace', 'font', 'geist', 'design', 'academy', 'careers', 'about', 'security', 'events',
    'oss', 'kb', 'cli', 'frameworks', 'storage', 'resources', 'partners', 'ship', 'try', 'help', 'trust', 'press', 'brand', 'fluid', 'compare', 'go'],
}

/** A path part after one of these words is a share, invite or reset token: the stored path ends before it. */
export const SHARE_WORDS = new Set(['s', 'share', 'shared', 'invite', 'invitation', 'join', 'magic', 'reset', 'verify', 'confirm', 'unsubscribe', 'token', 'tokens', 'callback'])

// ---------- search result pages: no resource ----------

/** Search engines by name, on any public suffix (google.co.uk too). */
export const SEARCH_ENGINES = new Set(['google', 'bing', 'duckduckgo', 'yahoo', 'yandex', 'baidu', 'ecosia', 'startpage', 'qwant', 'kagi', 'ask', 'aol', 'naver', 'sogou', 'seznam', 'mojeek'])
/** The engine's own hosts: developers.google.com and cloud.google.com are docs, not results. */
export const ENGINE_SUBDOMAINS = new Set(['', 'www', 'm', 'search', 'html', 'lite', 'cn', 'scholar'])
export const ENGINE_PATHS = new Set(['search', 's', 'url', 'web', 'html', 'lite', 'scholar'])
/** Query keys that make an engine page a results page. Only the key is checked, never its value. */
export const ENGINE_KEYS = ['q', 'p', 'query', 'text', 'wd', 'word', 'search']
/** Query keys that make /search, /results or a bare root a results page on any other host. */
export const SEARCH_KEYS = ['q', 'query', 'search', 'search_query', 's', 'term', 'keywords']

// ---------- hosts with rules of their own ----------

/** Code hosts and registries: a /mcp or /sse at the end of their path is a page, not a server. */
export const KNOWN_HOSTS = new Set([
  'github.com', 'raw.githubusercontent.com', 'gitlab.com', 'codeberg.org', 'bitbucket.org', 'npmjs.com', 'registry.npmjs.org', 'pypi.org', 'crates.io',
  'rubygems.org', 'pkg.go.dev', 'packagist.org', 'nuget.org', 'pub.dev', 'pub.dartlang.org', 'hex.pm', 'central.sonatype.com', 'search.maven.org',
  'mvnrepository.com', 'jsr.io', 'formulae.brew.sh', 'hub.docker.com', 'open-vsx.org', 'marketplace.visualstudio.com', 'smithery.ai', 'server.smithery.ai',
  'glama.ai', 'mcp.so', 'registry.modelcontextprotocol.io',
])

/**
 * Tool homepages: a tool with no repo or registry page. Each is a registrable domain and stays the key it had as a
 * site, so only its board changes. supabase/migrations/20261122000200_links_recategorize.sql moves the rows that
 * already exist and must list exactly these (recategorize.sql.test.ts checks).
 */
export const TOOL_HOST_LIST = [
  'ollama.com', 'docker.com', 'git-scm.com', 'curl.se', 'ffmpeg.org', 'sqlite.org', 'bun.sh', 'deno.com', 'brew.sh', 'cursor.com', 'zed.dev',
  'warp.dev', 'ghostty.org', 'iterm2.com', 'neovim.io', 'postman.com', 'wireshark.org', 'obsidian.md', 'raycast.com',
  'tailscale.com', 'ngrok.com', 'rustup.rs', 'pnpm.io', 'nixos.org', 'helm.sh', 'jqlang.org', 'httpie.io', 'imagemagick.org', 'pandoc.org',
  'jetbrains.com', 'sublimetext.com', 'astral.sh',
] as const
export const TOOL_HOSTS: ReadonlySet<string> = new Set(TOOL_HOST_LIST)

/**
 * A GitHub repo whose lowercased name has an mcp part (github-mcp-server, mcp, x_mcp) is an MCP server: it keeps
 * its github:<o>/<r> key and lands on the MCP board. The recategorize migration repeats this pattern in SQL.
 */
export const MCP_TOKEN = /(^|[-_.])mcp([-_.]|$)/

/** Docs hosts the docs.* and developer(s).* rules miss: the whole host is docs, keyed by the host. */
export const DOCS_HOSTS = new Set([
  'learn.microsoft.com', 'doc.rust-lang.org', 'en.cppreference.com', 'cloud.google.com', 'html.spec.whatwg.org', 'wiki.archlinux.org',
  'devcenter.heroku.com', 'dev.mysql.com',
])

/** Docs under these first path segments of a host that is also a site, keyed <host>/docs. */
export const DOCS_PATHS: Record<string, readonly string[]> = {
  'nodejs.org': ['api', 'docs'],
  'go.dev': ['doc', 'ref'],
  'python.org': ['doc'],
  'man7.org': ['linux'],
  'rfc-editor.org': ['rfc'],
  'datatracker.ietf.org': ['doc'],
}

/** A path segment that makes a page docs, in the first three segments (after a locale, a product or a version). */
export const DOCS_WORDS = new Set(['docs', 'documentation', 'reference', 'guide', 'guides', 'manual'])

/** Top-level stdlib packages on pkg.go.dev, keyed go:std. */
export const GO_STD = new Set([
  'std', 'archive', 'bufio', 'builtin', 'bytes', 'cmd', 'cmp', 'compress', 'container', 'context', 'crypto', 'database', 'debug', 'embed', 'encoding',
  'errors', 'expvar', 'flag', 'fmt', 'go', 'hash', 'html', 'image', 'index', 'io', 'iter', 'log', 'maps', 'math', 'mime', 'net', 'os', 'path', 'plugin',
  'reflect', 'regexp', 'runtime', 'slices', 'sort', 'strconv', 'strings', 'structs', 'sync', 'syscall', 'testing', 'text', 'time', 'unicode', 'unique',
  'unsafe', 'weak',
])

/** Go module hosts where a module is host/owner/repo (golang.org/x/name too); elsewhere it is host/name. */
export const GO_DEEP_HOSTS = new Set(['github.com', 'gitlab.com', 'bitbucket.org', 'codeberg.org', 'gitee.com', 'golang.org'])

/** docs.rs pages that are not a crate. */
export const DOCS_RS_PAGES = new Set(['about', 'releases', 'search', 'static'])

/** GitLab project subpages, reserved as project names: a legacy link without /-/ stops at one. */
export const GITLAB_SUBPAGES = new Set(['blob', 'tree', 'raw', 'blame', 'commits', 'commit', 'issues', 'merge_requests', 'wikis', 'pipelines', 'releases', 'tags', 'branches', 'edit', 'files', 'refs'])

// First path segments that are pages, not owners or groups.
export const GITLAB_PAGES = new Set(['explore', 'help', 'users', 'groups', 'projects', 'search', 'snippets', 'api', 'assets', 'uploads', 'public', 'oauth', 'import', 'jwt', 'login', 'sitemap', 'readme'])
export const CODEBERG_PAGES = new Set(['explore', 'repo', 'org', 'admin', 'api', 'assets', 'login', 'swagger.v1.json'])
export const BITBUCKET_PAGES = new Set(['product', 'blog', 'site', 'repo', 'workspace', 'socialauth', 'api', 'snippets'])
