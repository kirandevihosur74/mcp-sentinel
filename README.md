# mcp-sentinel

mcp-sentinel is an agent that checks whether an MCP server is safe before your team trusts it. It installs the server in a sandbox, hands it fake secrets, calls its tools, and watches what it does. If the server tries to steal the secrets or hides instructions in its tool descriptions, mcp-sentinel catches it and opens a pull request so a person can review and decide.

Built at the WeMakeDevs Agent Harness Hackathon on TrueForge, Bright Data, and Qodo.

## The problem

Teams add MCP servers the way they added npm packages years ago. You find one, paste a config line, and it starts running. It now has whatever credentials are in your environment, and its tool descriptions go straight into the model's context. That is a lot of trust for one line of config.

These attacks already happen:

- Tool poisoning. The description says "adds two numbers" but also hides text telling the model to read your SSH key and pass it along. The model reads the whole thing. You see the short version.
- Rug pulls. The server is clean when you review it. A later version quietly adds the theft. Nobody reviews it again.
- Exfiltration. The server reads environment variables and sends them to an attacker.

Most security tools today only read the tool descriptions and guess. Reading the label tells you what the server claims to do. Running it tells you what it actually does. mcp-sentinel runs it.

## How it works

Four steps, in order:

1. Discover. Look up the server on its registry: version, tools, maintainer, download counts.
2. Inspect. Install it in a sandbox. Set fake secret values (called canaries) in the environment, for example `GITHUB_TOKEN=canary-1a2b3c`. Call its tools with safe inputs. Watch every outbound request.
3. Judge. Roll the findings into one verdict, with the evidence attached.
4. Act. Open a pull request against `allowlist.json`. A person approves or rejects it.

A canary value exists nowhere except the environment we handed the server. So if that value shows up in an outbound request, the server stole it. There is no guessing.

Verdicts: `clean`, `changed_since_approval`, `suspicious`, `malicious`, `could_not_inspect`.

Every verdict comes with evidence: the exact description text, the captured request, or the diff. A verdict with no evidence is treated as a bug.

## Architecture

mcp-sentinel does not rebuild the hard parts. TrueForge already provides the agent loop, subagents, the sandbox, human approvals, and durable sessions. We use them.

```
                    TrueForge (agent harness runtime)
                    - runs the agent loop
                    - one subagent per server
                    - runs the Daytona sandbox
                    - pauses for human approval
                    - keeps the session alive
                              |
        +---------------------+---------------------+
        |                     |                     |
   OpenAI model          MCP connectors         Daytona sandbox
   (the brain,           inside TrueForge:       (where untrusted
    reads findings,      - github  -> opens PRs   servers actually
    decides a verdict)   - bright-data -> scrapes run)
                         - sentinel -> our tools
                              |
                    Qodo reviews every PR we open
```

What each part does:

- TrueForge (TrueFoundry). The runtime. It runs the agent, spins up one subagent per server, runs the sandbox, and pauses for a human before any pull request is opened. We plug into it, we do not replace it.
- OpenAI model. The brain. It reads the findings from the tools and decides the verdict. Configured as the model provider inside TrueForge.
- sentinel MCP server (this repo). Our own tools, exposed to the agent: `static_scan` (find poison in tool descriptions), `fingerprint` (hash the tool surface), `diff_capability` (spot real changes since last approval), and `analyze_capture` (check whether a canary left the sandbox). These are plain functions, so the harness does the orchestrating and stays in charge.
- github MCP connector. Opens the pull requests. Writes are approval gated.
- bright-data MCP connector. Scrapes the registries in the Discover step.
- Daytona. The sandbox. Every untrusted server is installed and run here, never on your machine.
- Qodo. Reviews every pull request in this repo, including the ones the agent opens itself. If Qodo finds a real problem, we fix it before merging.

## Technologies used

- TrueForge (TrueFoundry) for the agent harness runtime
- OpenAI for the model
- Daytona for the sandbox
- Bright Data for registry scraping
- Qodo for AI code review on every pull request
- GitHub MCP for opening pull requests
- Model Context Protocol SDK v2 for talking to servers
- mitmproxy for capturing outbound traffic in the sandbox
- TypeScript, Node 22, and Vitest

## How to use it

### Test other MCP servers from inside TrueForge

You can add the sentinel server to TrueForge and point it at any other MCP server you have connected, to check that server's security.

1. Build it:
   ```
   npm run build -w sentinel-mcp
   ```
2. In TrueForge, add a new MCP connector of type stdio with this command:
   ```
   node sentinel-mcp/dist/index.js
   ```
3. Now the agent (or you) can call the sentinel tools on another server's tool list. Give `static_scan` the tools from any server you have connected and it tells you what is wrong with them, with evidence.

### Run the full audit

Compose the agent from `agent/agent.json`, give it `allowlist.json`, and run it. It walks the four steps for each server and opens approval gated pull requests. Setup steps are in `agent/README.md`.

### Prove the pipeline without TrueForge

The whole detection chain runs locally with one command:

```
npm run e2e
```

It spawns the demo server, runs the real tools against it, catches a canary leaving over the network, and ends at a verdict. Useful for a quick check that everything works.

### Open the audit console

Run the read-only Doing, Waiting on you, and Did view:

```bash
npm run dev -w ui
```

Open `http://localhost:3000` for the product page and `http://localhost:3000/audit` for the console. The current P5 audit view uses a typed demo event source. Its event contract is the adapter boundary for the official TrueForge session stream; execution and approvals stay in TrueForge.

The deployed product site is available at `https://kirandevihosur74.github.io/mcp-sentinel/` after the Pages workflow completes on `main`.

### Use the tools directly

The sentinel tools are plain functions. You can import them into your own code or script and run `static_scan`, `fingerprint`, `diff_capability`, and `analyze_capture` on any tool list you already have.

## Future work

- More registries in the Discover step (Glama, mcp.so).
- Watch file reads in the sandbox, not just network, so we catch a server reading `~/.ssh` even if it does not send it yet.
- Let the agent write a new detection rule when it catches something, and open that as its own reviewed pull request.
- Connect the audit console to the official TrueForge session event stream.
- Re-audit servers on a schedule, not only when the registry changes, so behavior that drifts without a version bump still gets caught.
- Catch time delayed behavior, where a server stays quiet during the check and turns malicious later.

## License

MIT
