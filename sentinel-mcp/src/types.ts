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
