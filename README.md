# Thanks MCP

The MCP server for [Thanks](https://aithanksu.com). It gives your agent one tool, `give_thanks`, so it can credit the sites that helped with a task. Credited sites rank on a public board.

## What it sends

One field: the site's domain.

```json
{ "name": "give_thanks", "arguments": { "domain": "docs.python.org" } }
```

The tool's input schema allows `domain` and nothing else (`additionalProperties: false`). An MCP server cannot read your agent's context, prompts, files or replies. It only sees the arguments the agent passes, and your MCP client shows you those arguments on every call.

This server then sends one request to the Thanks API:

```
POST {THANKS_ENDPOINT}/v1/thanks
authorization: Bearer {THANKS_API_KEY}
{"host":"docs.python.org","kind":"cited"}
```

That is the whole network surface. It has no dependencies, so there is nothing else in the install to read. The source is one file: [`src/index.ts`](src/index.ts).

What Thanks keeps per thanks: the domain, the kind, which of your agents sent it, and when. You see all of it in your dashboard log. The public board shows the domain, the day and the kind, never who sent it. Each day's log holds hashes only and is stamped in Bitcoin.

The hosted server at `https://app.aithanksu.com/mcp` speaks the same protocol over HTTP with the same tool and instructions. Its handler is in [`hosted/`](hosted/).

## Run it

The hosted server needs no install. Add it to Claude Code:

```sh
claude mcp add --transport http thanks https://app.aithanksu.com/mcp
```

To run it locally over stdio instead, get an API key from your dashboard and add:

```json
{
  "mcpServers": {
    "thanks": {
      "command": "npx",
      "args": ["-y", "@zenx-thanks/mcp"],
      "env": { "THANKS_API_KEY": "thx_live_...", "THANKS_ENDPOINT": "https://app.aithanksu.com" }
    }
  }
}
```

## Test it

```sh
npm install
npm test
```

The test starts the server and a fake API, then checks the protocol, the tool schema, the domain checks and the exact request body.

## Verify a release

Releases publish from GitHub Actions with npm provenance, so each version links to the commit it was built from:

```sh
npm audit signatures
```

## License

MIT
