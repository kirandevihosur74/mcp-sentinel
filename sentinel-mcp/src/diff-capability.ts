// Capability-level diff between two snapshots of a server's tools.
//
// The point is to separate *capability change* from *cosmetic change*. An audit of
// 33 real servers found 33 tool mutations, all benign on review — so flagging every
// reworded sentence produces noise that gets the whole tool switched off. This diff
// reports only things that change what a tool can DO: a new tool, a changed argument
// schema, or a description that newly references a file path, a credential env var,
// or a network destination. A reworded description with none of those is not a
// finding.

import { stableStringify } from "./canonical.js";
import type { Tool, CapabilityChange, CapabilityChangeKind } from "./types.js";

const URL_RE = /https?:\/\/[^\s)]+/gi;
// An env-var-shaped token: all-caps with at least one underscore (GITHUB_TOKEN).
const ENV_RE = /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g;

// Filesystem references, several forms — kept targeted so ordinary prose with a
// slash ("and/or", "read/write") is not mistaken for a path.
const PATH_RES: readonly RegExp[] = [
  /~\/[\w.\-/]*/g, // home-relative: ~/.ssh/id_rsa
  /\.\.?\/[\w.\-/]+/g, // explicit relative: ./x, ../secret
  /\b[A-Za-z]:\\[\w.\-\\]+/g, // Windows: C:\Users\...
  // absolute paths rooted at a known system directory (single- or multi-segment)
  /(?<![\w/])\/(?:etc|tmp|var|root|home|usr|proc|opt|dev|sys|mnt|bin|sbin)(?:\/[\w.\-]+)*/g,
  // a sensitive dotfile / credentials file anywhere (.env, .npmrc, id_rsa, …)
  /(?<![\w./-])(?:\.(?:env|npmrc|netrc|aws|ssh|gnupg|git-credentials)|id_rsa|id_ed25519|credentials)\b[\w.\-/]*/gi,
];

/** Normalize a destination so cosmetic edits (trailing punctuation, host casing) don't read as new. */
function normalizeUrl(raw: string): string {
  const trimmed = raw.replace(/[.,;:!?)\]'"]+$/, "");
  try {
    const u = new URL(trimmed);
    return `${u.protocol}//${u.host}${u.pathname}`.replace(/\/$/, "").toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}

interface CapabilityTokens {
  readonly network: Set<string>;
  readonly paths: Set<string>;
  readonly envs: Set<string>;
}

function extractTokens(description: string): CapabilityTokens {
  const network = new Set((description.match(URL_RE) ?? []).map(normalizeUrl));
  // Strip URLs before scanning for paths/envs so a URL's path segment isn't
  // double-counted as a filesystem path.
  const rest = description.replace(URL_RE, " ");
  const paths = new Set<string>();
  for (const re of PATH_RES) {
    for (const m of rest.matchAll(re)) paths.add(m[0]);
  }
  const envs = new Set(rest.match(ENV_RE) ?? []);
  return { network, paths, envs };
}

/** Members of `after` not present in `before`. */
function added(before: Set<string>, after: Set<string>): string[] {
  return [...after].filter((x) => !before.has(x));
}

function byName(tools: readonly Tool[]): Map<string, Tool> {
  return new Map(tools.map((t) => [t.name, t]));
}

/** Report capability changes from `before` to `after`. Cosmetic edits are omitted. */
export function diffCapability(before: readonly Tool[], after: readonly Tool[]): CapabilityChange[] {
  const changes: CapabilityChange[] = [];
  const beforeMap = byName(before);
  const afterMap = byName(after);

  const change = (kind: CapabilityChangeKind, tool: string, detail: string): void => {
    changes.push({ kind, tool, detail });
  };

  for (const name of afterMap.keys()) {
    if (!beforeMap.has(name)) change("tool_added", name, name);
  }
  for (const name of beforeMap.keys()) {
    if (!afterMap.has(name)) change("tool_removed", name, name);
  }

  for (const [name, afterTool] of afterMap) {
    const beforeTool = beforeMap.get(name);
    if (beforeTool === undefined) continue;

    if (stableStringify(beforeTool.inputSchema ?? null) !== stableStringify(afterTool.inputSchema ?? null)) {
      change("schema_changed", name, `input schema for ${name} changed`);
    }

    const b = extractTokens(beforeTool.description);
    const a = extractTokens(afterTool.description);
    for (const p of added(b.paths, a.paths)) change("new_path_reference", name, p);
    for (const e of added(b.envs, a.envs)) change("new_env_reference", name, e);
    for (const n of added(b.network, a.network)) change("new_network_reference", name, n);
  }

  return changes;
}
