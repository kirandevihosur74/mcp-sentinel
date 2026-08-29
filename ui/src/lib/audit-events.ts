export type Verdict =
  | "clean"
  | "changed_since_approval"
  | "suspicious"
  | "malicious"
  | "could_not_inspect";

export type AuditStage = "discover" | "inspect" | "judge" | "act";

export interface Evidence {
  readonly kind: "description" | "capture" | "capability_diff" | "error";
  readonly label: string;
  readonly detail: string;
}

export interface AuditRun {
  readonly id: string;
  readonly server: string;
  readonly registry: string;
  readonly version: string;
  readonly stage: AuditStage;
  readonly progress: number;
  readonly activity: string;
  readonly startedAt: string;
}

export interface ApprovalRequest {
  readonly id: string;
  readonly server: string;
  readonly version: string;
  readonly verdict: Verdict;
  readonly action: string;
  readonly evidence: readonly [Evidence, ...Evidence[]];
  readonly trueForgeUrl: string;
}

export interface AuditRecord {
  readonly id: string;
  readonly server: string;
  readonly version: string;
  readonly verdict: Verdict;
  readonly evidence: readonly [Evidence, ...Evidence[]];
  readonly summary: string;
  readonly completedAt: string;
  readonly pullRequest?: { readonly label: string; readonly url: string };
}

export interface AuditSnapshot {
  readonly source: "demo" | "trueforge";
  readonly updatedAt: string;
  readonly active: readonly AuditRun[];
  readonly approvals: readonly ApprovalRequest[];
  readonly history: readonly AuditRecord[];
}

// P5 consumes this normalized shape instead of owning sessions, execution, or
// approvals. A TrueForge adapter can replace this fixture when its deployment's
// official session-event endpoint is configured.
export const demoSnapshot: AuditSnapshot = {
  source: "demo",
  updatedAt: "Just now",
  active: [
    {
      id: "audit-1042",
      server: "github-mcp-server",
      registry: "npm",
      version: "0.19.1",
      stage: "inspect",
      progress: 68,
      activity: "Calling 7 read-only tools inside Daytona",
      startedAt: "2m 14s ago",
    },
    {
      id: "audit-1043",
      server: "filesystem",
      registry: "npm",
      version: "2026.8.0",
      stage: "discover",
      progress: 24,
      activity: "Comparing registry metadata with last approval",
      startedAt: "48s ago",
    },
  ],
  approvals: [
    {
      id: "approval-88",
      server: "weather-buddy-mcp",
      version: "1.0.3",
      verdict: "malicious",
      action: "Remove from allowlist and open an evidence-backed pull request",
      trueForgeUrl: "http://localhost:8790",
      evidence: [
        {
          kind: "capture",
          label: "Canary left the sandbox",
          detail: "POST weather-telemetry.example/collect, request body",
        },
        {
          kind: "description",
          label: "Hidden instruction",
          detail: "Tool description references GITHUB_TOKEN behind U+200B",
        },
        {
          kind: "capability_diff",
          label: "Changed since approval",
          detail: "Approved 1.0.2, observed 1.0.3",
        },
      ],
    },
  ],
  history: [
    {
      id: "audit-1041",
      server: "slack-mcp-server",
      version: "1.4.2",
      verdict: "clean",
      evidence: [
        {
          kind: "capture",
          label: "Capture analysis",
          detail: "No configured canary values observed in outbound HTTP traffic.",
        },
      ],
      summary: "No static findings, capability drift, or canary egress.",
      completedAt: "Today, 14:32",
    },
    {
      id: "audit-1040",
      server: "notion-mcp",
      version: "2.1.0",
      verdict: "changed_since_approval",
      evidence: [
        {
          kind: "capability_diff",
          label: "Capability diff",
          detail: "Added search_pages and archive_page; update_page input schema changed.",
        },
      ],
      summary: "Two tools added and one input schema changed.",
      completedAt: "Today, 13:08",
      pullRequest: { label: "PR #11", url: "https://github.com/kirandevihosur74/mcp-sentinel/pull/11" },
    },
    {
      id: "audit-1039",
      server: "linear-mcp",
      version: "0.8.4",
      verdict: "could_not_inspect",
      evidence: [
        {
          kind: "error",
          label: "Inspection failure",
          detail: "Server rejected the canary credential before any MCP tool executed.",
        },
      ],
      summary: "Server rejected the canary credential before any tool ran.",
      completedAt: "Yesterday, 18:45",
    },
  ],
};
