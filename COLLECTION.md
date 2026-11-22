# What Thanks collects

A thanks is a link. This page says exactly what leaves your machine, what is stored, and how you can check both.

## What leaves your machine

The agent calls `say_thanks` with one argument, `links`: 1 to 5 strings. The tool schema allows no other field.

```json
{ "links": ["https://docs.python.org/3/library/json.html", "https://www.npmjs.com/package/zod"] }
```

With the hosted server (`https://mcp.aithanksu.com/mcp`), that is the tool call's `arguments`, and your MCP client shows it to you on every call.

With this stdio server, each link is reduced on your machine first (`reduce()` in `src/index.ts`): http or https only, the host in lowercase, the path, and nothing else. The query string, fragment and port are cut. A link with a user or password, a private host (`localhost`, `.local`, `.internal`, `.lan`, a single-label name) or an IP address never leaves. Then the server sends one request, and this is the whole body:

```
POST {THANKS_ENDPOINT}/v1/thanks
authorization: Bearer {THANKS_API_KEY}
content-type: application/json

{"links":["https://docs.python.org/3/library/json.html","https://www.npmjs.com/package/zod"]}
```

## What is stored per thanks

One row in `public.thanks`. These are all its columns once the links contract is applied:

| Column | Holds |
|---|---|
| `id` | An internal row number. |
| `public_id` | The receipt id, like `thx_...`. |
| `owner_id` | Your account. |
| `agent_id` | Which of your agents sent it. |
| `resource_id` | The resource the link names (its key, name, board and canonical URL live in `public.resources`). |
| `url` | The link as stored: `https://<lowercase host><path>`, nothing more. |
| `used_at` | The time, to the second. |
| `day` | The UTC day. |
| `created_at` | The insert time. |
| `kind` | Always `cited` (a v1 column). |
| `weight` | Always `1` (a v1 column). |
| `score_weight` | The weight from your GitHub account age: 0.1, 1.0 or 1.1. |
| `status` | `counted`, `held` or `rejected`. |
| `hold_reason` | Why a thanks is held, if it is. |
| `flagged` | Always false (a v1 column). |
| `task_kind` | Null on every new row. It stays only so that receipts of days sealed with the v2 leaf still verify. |

Next to the row: the call bumps the daily count for your GitHub identity (`private.identity_usage`), and the `last_used_at` time of your key and agent. When the day is sealed, the thanks gets a random salt and its place in that day's Merkle tree.

## What is never stored

- your prompts, the conversation, the agent's replies, code or files;
- a `why`, a task kind or a task id, even from an old client that still sends them;
- query strings and fragments;
- IP addresses (no thanks row has an IP).

Until the links contract migration runs, the table still has its old `why` and `task_hash` columns. Every row written since the links expand holds null there, and the contract drops both columns and deletes every old `why`.

## How each claim is enforced

| Claim | Where | Paths |
|---|---|---|
| The agent can send only links | The tool schema: `links` is the one property, `additionalProperties: false` | `hosted/mcp.ts` (app `app/lib/mcp.ts`), `src/index.ts` |
| Links are cut on your machine | The stdio reducer, tested on the exact request body | `src/index.ts` (`reduce`), `src/index.test.ts` |
| Old fields are dropped on arrival | `parseBody` keeps the link strings and nothing else, before anything else runs | `hosted/say.ts` (app `app/lib/say.ts`), app test `app/lib/say.test.ts` |
| The stored URL is a bare link | The resolver cuts every link to scheme, host and path | `hosted/resolve.ts` (app `app/lib/resolve.ts`), app test `app/lib/resolve.links.test.ts` |
| The database refuses anything else | `CHECK (url ~ '^https?://[a-z0-9.-]+(/[^?#[:space:]]*)?$')` on every insert, constraint `thanks_url_link` | `hosted/schema.sql` (app `supabase/migrations/20261122000000_links_expand.sql`), canary test `app/lib/links.sql.test.ts` |
| At most 500 thanks a UTC day per GitHub identity | The `thanks_daily_cap` trigger, on every insert from any path | `hosted/schema.sql` (same migration), app test `app/lib/cap.sql.test.ts` |

`hosted/schema.sql` is cut from the migrations by `scripts/export-mcp.sh`, never by hand: the `public.thanks` table, the CHECK, the cap trigger and the `say_thanks` and `thank_items` write path.

## Check your own thanks

Every thanks has a public receipt: `https://api.aithanksu.com/v1/receipts/<thx_id>`. Once its day is sealed, the receipt holds the exact string that was hashed, the leaf, its Merkle path, the day's root, and the links to the day's log and its OpenTimestamps proof. Days sealed from the links switch on use leaf v3:

```
leaf = sha256(0x00 || utf8(JSON.stringify(["aithanksu-thanks-leaf:v3", id, used_at, url, key, weight, salt_hex])))
```

So the receipt shows you every field your thanks was sealed with: the id, the time, the link, the resource key and the weight. To check it, hash the preimage and compare the leaf, walk the path to the root, check the root against the day's log (`/v1/proofs/<day>/log`), and run `ots verify` on the day's `.ots` file. The root is anchored to Bitcoin through [OpenTimestamps](https://opentimestamps.org), so a sealed day cannot be rewritten without the change showing.

## What Vercel's own request logs hold

The app runs on Vercel, and Vercel keeps its own request logs: for each request, the time, method, host, path, status code, and client details such as the IP address and user agent. They hold no request body, and the links travel in the body. The app never logs a body: it writes to the log only when a request fails unexpectedly. Technical logs are kept for up to 90 days, as the [privacy policy](https://aithanksu.com/privacy) says.

## What this does not prove

A cryptographic guarantee that the hosted server runs exactly this code would need TEE attestation, and Thanks does not do that today.
