// Shared types for mcp-sentinel's judgment primitives.
//
// A `Tool` is the normalized shape of one MCP tool as the probe reports it after
// calling `tools/list`. Every judgment function below operates on these.

export interface Tool {
  readonly name: string;
  readonly description: string;
  /** The JSON Schema object for the tool's arguments, as returned by tools/list. */
  readonly inputSchema?: unknown;
  /** Publisher-supplied annotations (readOnlyHint, destructiveHint, …). Untrusted. */
  readonly annotations?: Record<string, unknown>;
}

export type Severity = "high" | "medium" | "low";

/**
 * One thing the static scanner found wrong with a tool. Every finding carries the
 * exact evidence that triggered it — a finding with no evidence is a bug.
 */
export interface Finding {
  /** Stable kebab-case rule id, e.g. "hidden-unicode". */
  readonly rule: string;
  readonly severity: Severity;
  /** Name of the tool the finding is about. */
  readonly tool: string;
  /** One-line statement of what was found. */
  readonly summary: string;
  /** The exact text / bytes / value that triggered the finding. */
  readonly evidence: string;
}

/** The kinds of change `diffCapability` reports. Reworded prose is deliberately absent. */
export type CapabilityChangeKind =
  | "tool_added"
  | "tool_removed"
  | "schema_changed"
  | "new_path_reference"
  | "new_env_reference"
  | "new_network_reference";

export interface CapabilityChange {
  readonly kind: CapabilityChangeKind;
  readonly tool: string;
  /** What changed, concretely: the added token, or before→after for a schema. */
  readonly detail: string;
}

/**
 * One captured outbound request that carried a canary value out of the sandbox,
 * parsed from a line of the probe run's canary_hits.jsonl. The field names mirror
 * the pinned addon schema (`match`, `body_snippet` → bodySnippet).
 */
export interface CaptureHit {
  readonly ts: number;
  readonly url: string;
  readonly method: string;
  /** The canary value that leaked (e.g. canary-7f3a…). */
  readonly match: string;
  /** Where the canary was found: "body" | "header" | "url" | "unknown". */
  readonly location: string;
  readonly bodySnippet: string;
}

/** The verdict-input produced from a capture log. `leaked` mandates a `malicious` verdict. */
export interface CaptureAnalysis {
  readonly leaked: boolean;
  /** "malicious" when a canary left the sandbox (unambiguous exfiltration), else null. */
  readonly verdict: "malicious" | null;
  readonly hits: CaptureHit[];
  /** Distinct destinations a canary was sent to. */
  readonly requests: { readonly url: string; readonly method: string }[];
  readonly summary: string;
}
