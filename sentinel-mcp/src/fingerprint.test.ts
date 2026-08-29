import { describe, it, expect } from "vitest";
import { fingerprint } from "./fingerprint.js";
import type { Tool } from "./types.js";

const toolA: Tool = {
  name: "get_weather",
  description: "Get the weather.",
  inputSchema: { type: "object", properties: { city: { type: "string" } } },
};
const toolB: Tool = {
  name: "send_email",
  description: "Send an email.",
  inputSchema: { type: "object", properties: { to: { type: "string" } } },
};

describe("fingerprint", () => {
  it("is a 64-char hex sha256 string", () => {
    const fp = fingerprint([toolA]);
    expect(fp).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is stable across calls with identical input", () => {
    expect(fingerprint([toolA, toolB])).toBe(fingerprint([toolA, toolB]));
  });

  it("is order-independent (canonicalizes by tool name)", () => {
    expect(fingerprint([toolA, toolB])).toBe(fingerprint([toolB, toolA]));
  });

  it("changes when a description changes", () => {
    const edited: Tool = { ...toolA, description: "Get the CURRENT weather." };
    expect(fingerprint([edited])).not.toBe(fingerprint([toolA]));
  });

  it("changes when an input schema changes", () => {
    const edited: Tool = {
      ...toolA,
      inputSchema: { type: "object", properties: { city: { type: "string" }, days: { type: "number" } } },
    };
    expect(fingerprint([edited])).not.toBe(fingerprint([toolA]));
  });

  it("is insensitive to key order within a schema", () => {
    const reordered: Tool = {
      ...toolA,
      inputSchema: { properties: { city: { type: "string" } }, type: "object" },
    };
    expect(fingerprint([reordered])).toBe(fingerprint([toolA]));
  });

  it("changes when a tool is added", () => {
    expect(fingerprint([toolA, toolB])).not.toBe(fingerprint([toolA]));
  });

  it("is insensitive to the order of set-like schema keywords (required, enum)", () => {
    const one: Tool = {
      name: "t",
      description: "d",
      inputSchema: { type: "object", required: ["a", "b"], properties: { m: { enum: [1, 2, 3] } } },
    };
    const reordered: Tool = {
      name: "t",
      description: "d",
      inputSchema: { type: "object", required: ["b", "a"], properties: { m: { enum: [3, 1, 2] } } },
    };
    expect(fingerprint([reordered])).toBe(fingerprint([one]));
  });

  it("does NOT sort an array named enum when it is instance data inside const", () => {
    const one: Tool = { name: "t", description: "d", inputSchema: { const: { enum: ["a", "b"] } } };
    const other: Tool = { name: "t", description: "d", inputSchema: { const: { enum: ["b", "a"] } } };
    expect(fingerprint([other])).not.toBe(fingerprint([one]));
  });
});
