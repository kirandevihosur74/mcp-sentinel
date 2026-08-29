# agent/ — the TrueForge orchestrator

This directory is the whole TrueForge agent definition for mcp-sentinel: no
separate subagent file exists, because TrueForge subagents are dynamic-only —
the root model calls the built-in `create_sub_agent` tool at runtime, one
level deep. The inspector's full prompt lives inline inside
`instructions.md`, in the block the root passes to `create_sub_agent` for
each server it inspects.

- `agent.json` — the `AgentSpecSchema` TrueForge loads: model, MCP
  connectors, and harness config (subagents, sandbox, approvals, UI). Its
  `instructions` field already contains the full text below, inlined —
  paste this file into TrueForge as-is.
- `instructions.md` — the readable, diffable source of that prompt: the
  orchestrator's full system prompt and the inspector sub-agent's prompt.
  Edit here, then re-inline into `agent.json`'s `instructions` field.

## Loading this agent into TrueForge

1. **Start the harness.**
   ```bash
   npx @truefoundry/trueforge     # Node 22+, opens http://localhost:8790
   ```
2. **Register the three connectors** in Settings → MCP Servers:
   - `github` — paste a `GITHUB_TOKEN` with repo scope. This is where
     `require_approval_for_tools: ["@write", "@destructive"]` lives — set it
     so every PR and abuse-report draft pauses for a human.
   - `bright-data` — `https://mcp.brightdata.com/mcp?token=<BRIGHTDATA_API_KEY>`.
     Mark it `preload: true` so registry scraping is available from the
     first turn. That MCP connector is token-authenticated only; it doesn't
     take a zone. The separate `bdata` CLI path Discover also uses for
     scraping (see `CLAUDE.md`) is zone-scoped and must use `cli_unlocker`
     explicitly — set it in the CLI config (`bdata config`), don't rely on
     whatever zone is default.
   - `sentinel` — this repo's own MCP server. TrueForge connects to MCP
     servers by URL, so run sentinel over HTTP and register that URL. Build
     it (`npm run build -w sentinel-mcp`), start it
     (`npm run serve:http -w sentinel-mcp`, which runs `node
     sentinel-mcp/dist/http.js` and listens on `http://localhost:8391/mcp`,
     override with `SENTINEL_HTTP_PORT`), then in TrueForge choose Add MCP
     server, set the URL to `http://localhost:8391/mcp` and Auth type to
     None. (The stdio entry `node sentinel-mcp/dist/index.js` is for the
     local probe and tests, not for TrueForge.)
3. **Add the sandbox provider** (Daytona, or whatever this deployment wires
   up as the harness's `exec` backend). TrueForge owns that sandbox's
   lifecycle — provisioning and teardown are the harness's job, not
   something the agent or its sub-agents do explicitly. The sandbox ships
   with python3 only — each inspector bootstraps Node.js and mitmproxy in
   its own sandbox instance before it runs the probe or captures traffic.
   Nothing from a server under audit ever runs outside it.
4. **Compose the agent**: paste `agent.json` as the spec (or point the
   harness at this file directly). Its `instructions` field already carries
   the full text of `instructions.md`, inlined at commit time — `agent.json`
   is what you load as-is, no separate compose step needed. `instructions.md`
   stays the readable, diffable source; if you edit the prose, edit
   `instructions.md` and re-inline it into `agent.json`'s `instructions`
   field (keep the two in sync — the `$comment` says so).
5. **Enable in config** (already set in `agent.json`, verify it stuck):
   `dynamic_sub_agents`, `sandbox`, `ask_user_questions`, and
   `generative_ui` (drives the three-pane console — Doing / Waiting on you /
   Did).
6. **Set the model.** `agent.json` ships with `model.name` set to the
   placeholder `REPLACE_WITH_MODEL` — put a real model id there before
   saving to the Agents Library.
7. Save to the Agents Library and run it against `allowlist.json`.

## The four-stage flow

The root agent runs four stages per audit: **Discover** scrapes each
server's registry listing through `bright-data` (never plain `fetch`) and
triages which servers actually need a fresh look — new candidates, and
anything whose version, tool list, or maintainer drifted since the last
approval. **Inspect** fans out one dynamic sub-agent per flagged server; each
inspector bootstraps its own sandbox, launches the server under audit with
canary credentials and traffic capture, runs the probe, and calls
`sentinel`'s `static_scan`, `fingerprint`, `diff_capability`, and
`analyze_capture` to turn what it saw into evidence, then returns a verdict
candidate to the root and stops — inspectors cannot talk to the user.
**Judge** rolls each server's evidence into exactly one of five verdicts —
`clean`, `changed_since_approval`, `suspicious`, `malicious`, or the honest
`could_not_inspect` — always with the evidence attached. **Act** opens one
approval-gated PR per server against `allowlist.json` (add, update the
fingerprint, or pin/remove depending on the verdict), drafts an abuse report
and a detection-rule proposal on a confirmed `malicious` catch, and pauses
every write for a human to approve before anything leaves the sandbox's
findings and touches the real world.
