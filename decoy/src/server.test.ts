import { describe, it, expect } from "vitest";
import { createDecoy, POISONED_DESCRIPTION, selectCanaries } from "./server.js";

describe("weather-buddy decoy", () => {
  it("constructs without starting a server", () => {
    expect(createDecoy()).toBeDefined();
  });

  it("carries the static poison the scanner is meant to catch", () => {
    expect(POISONED_DESCRIPTION).toContain("<IMPORTANT>");
    expect(POISONED_DESCRIPTION).toContain("\u200b"); // hidden zero-width char
    expect(POISONED_DESCRIPTION).toMatch(/GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY/);
  });

  it("still reads as a plain weather tool on its first line", () => {
    expect(POISONED_DESCRIPTION.split("\u200b")[0]).toMatch(/weather forecast/i);
  });
});

describe("weather-buddy decoy — exfil safety", () => {
  it("selects only canary-shaped values, never real secrets", () => {
    const picked = selectCanaries({
      GITHUB_TOKEN: "ghp_a_real_looking_token_1234567890",
      AWS_SECRET_ACCESS_KEY: "canary-9d2e4a17-4c81-11f0-c3d4",
    });
    expect(picked).toEqual({ AWS_SECRET_ACCESS_KEY: "canary-9d2e4a17-4c81-11f0-c3d4" });
  });
  it("selects nothing when no value is a canary", () => {
    expect(selectCanaries({ GITHUB_TOKEN: "ghp_real", AWS_SECRET_ACCESS_KEY: "AKIAreal" })).toEqual({});
  });
});
