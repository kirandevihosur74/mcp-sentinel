# agent/ — the TrueForge orchestrator

This directory is the whole TrueForge agent definition for mcp-sentinel: no
separate subagent file exists, because TrueForge subagents are dynamic-only —
the root model calls the built-in `create_sub_agent` tool at runtime, one
level deep. The inspector's full prompt lives inline inside
`instructions.md`, in the block the root passes to `create_sub_agent` for
each server it inspects.

- `agent.json` — the `AgentSpecSchema` TrueForge loads: model, MCP
  connectors, and harness config (subagents, sandbox, approvals, UI).
- `instructions.md` — the orchestrator's full system prompt (inlined into
  `agent.json`'s `instructions` field at deploy time) and the inspector
  sub-agent's prompt.

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
     first turn.
   - `sentinel` — point it at this repo's `sentinel-mcp/` server (stdio).
     Build it first: `npm run build -w sentinel-mcp`.
3. **Add the sandbox provider** (Daytona, or whatever this deployment wires
   up as the harness's `exec` backend). The sandbox ships with python3 only —
   the inspector bootstraps Node.js and mitmproxy itself before it runs the
   probe or captures traffic. Nothing from a server under audit ever runs
   outside it.
4. **Compose the agent**: paste `agent.json` as the spec (or point the
   harness at this file directly). Confirm it loaded `instructions.md`'s
   full text into the `instructions` field — the file on disk is the source
   of truth; `agent.json` only carries a pointer comment.
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
