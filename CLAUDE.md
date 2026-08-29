# CLAUDE.md

Project rules for the coding assistant working in mcp-sentinel. Read README.md first for what we are building.

## What this is

An agent on TrueForge that audits MCP servers: scrape registries (Bright Data), inspect each server in a Daytona sandbox (subagents), judge, then open approval-gated PRs against `allowlist.json`. See README.md for the four stages and the demo script.

## Rules

- TypeScript everywhere. Node 22+.
- The harness does the loop, tool calls, subagents, sandbox, approvals and sessions. Do not reimplement any of that. If something feels like plumbing, check whether TrueForge already does it.
- Third-party MCP server code runs only inside the Daytona sandbox. Never `npm install` or execute a server under audit on the host.
- Every action with external effect (PR, abuse report) goes through a TrueForge approval. No exceptions, including in tests.
- Work on branches. Open a PR for every change. Qodo reviews it. Fix High findings before merge.
- Commit messages are imperative ("Add canary check", not "Added canary check").
- Keep files small and single-purpose. A hackathon repo that reads like real software is the Qodo track.

## Bright Data scraper configuration

All web data goes through Bright Data. Never use plain `fetch` against a registry.

CLI is installed and authenticated (`bdata config` must succeed). Zone: `cli_unlocker`.

### Registries

| Registry | Listing URL pattern | Fields we need |
|---|---|---|
| npm | `https://www.npmjs.com/package/<name>` | version, published date, maintainers, weekly downloads, repo URL |
| Smithery | `https://smithery.ai/server/<owner>/<name>` | version, tools list (name + description), repo URL, install count |
| Glama | `https://glama.ai/mcp/servers/<id>` | tools list, repo URL, last updated |
| mcp.so | `https://mcp.so/server/<name>` | description, repo URL, tags |

Start with npm and Smithery. Add the others only if both are solid.

### Collectors (Scraper Studio)

Create one collector per registry from a plain-English description, then record the `collector_id` here so it is reused and version-controlled:

```
bdata scraper create --url "<listing url>" --description "Extract package name, current version, publish date, maintainers, weekly downloads, repository URL, and the list of MCP tools with name and description"
```

| Registry | collector_id | Created | Last repaired |
|---|---|---|---|
| npm | | | |
| Smithery | | | |

Run: `bdata scraper run <collector_id> --urls "<url>" --sync` for single pages, `--input-file urls.txt` for batches.

Fallback for a page a collector can't handle: `bdata scrape "<url>" -f markdown` and parse the markdown.

### Freshness and repair rules

A scrape result is stale or broken if any of these hold:

- `version` is missing or empty
- `tools` is an empty array for a server known to have tools
- `repo_url` is missing
- the response is shorter than 500 characters

On a broken result, do not proceed with a partial audit. Instead:

1. Re-scrape once with `bdata scrape -f markdown` to confirm the page still exists.
2. If the page exists but the collector returned nothing, the layout changed. Re-run `bdata scraper create` against the current page, update the `collector_id` table above, and re-run.
3. Log the repair in the UI's Did pane and in `scrapers/registries.md`.

Mark the server `could_not_inspect` only if repair fails twice.

### Output shape

Every scrape is normalized to:

```
{
  registry, name, version, published_at, maintainers[], downloads_weekly,
  repo_url, tools: [{ name, description }], scraped_at, collector_id
}
```

This object is what the drift check compares against the fingerprint in `allowlist.json`.

## Sandbox conventions

- One Daytona sandbox per server under audit, destroyed after inspection.
- Install with a two-minute timeout. Timeout means `could_not_inspect`, not a retry loop.
- Canary env vars are prefixed `canary-` and are unique per run so a leak is attributable.
- Capture all outbound network from the sandbox. Any request carrying a canary value is `malicious`.

## Verdicts

`clean` | `changed_since_approval` | `suspicious` | `malicious` | `could_not_inspect`

Evidence is always attached: the exact description text, the captured request, or the diff. A verdict with no evidence is a bug.
