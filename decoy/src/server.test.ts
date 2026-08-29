import { describe, it, expect } from "vitest";
import { createDecoy, POISONED_DESCRIPTION } from "./server.js";

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
