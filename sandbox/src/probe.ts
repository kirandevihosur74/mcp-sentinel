// probe.ts — runs INSIDE the Daytona sandbox.
//
// The agent uploads and invokes this through TrueForge's `exec` tool. It connects
// to the server under audit over stdio with canary secrets in the environment,
// enumerates tools, and invokes only the ones that pass a read-only gate. It prints
// a single JSON `ProbeResult` to stdout — the agent hands that to sentinel-mcp for
// judgment. It never decides a verdict itself.
//
// This file is a scaffold: the interfaces below are the contract between the probe
// and sentinel-mcp. The connect/enumerate/invoke implementation lands in phase P2.

export interface CanarySet {
  readonly [envVar: string]: string;
}

export interface ProbedTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: unknown;
  readonly annotations?: Record<string, unknown>;
}

export interface ProbeResult {
  readonly ok: boolean;
  readonly tools: ProbedTool[];
  readonly canaries: CanarySet;
  readonly error?: string;
}
