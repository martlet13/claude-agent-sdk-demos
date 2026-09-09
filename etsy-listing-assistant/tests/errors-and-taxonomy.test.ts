import { describe, expect, it } from "vitest";
import { mapGenerationError } from "../src/server/generation-errors.js";
import { withTimeout } from "../src/server/timeout.js";
import { searchTaxonomy } from "../src/shared/taxonomy.js";

describe("mapGenerationError", () => {
  it("maps invalid API keys to a Setup recovery action", () => {
    expect(mapGenerationError(new Error("401 unauthorized invalid api key"))).toMatch(/Paste a valid Anthropic key/i);
  });

  it("maps rate limits and network failures", () => {
    expect(mapGenerationError(new Error("429 rate limit"))).toMatch(/rate-limited/i);
    expect(mapGenerationError(new Error("fetch failed ECONNRESET"))).toMatch(/Could not reach Claude/i);
  });
});

describe("withTimeout", () => {
  it("rejects after the limit", async () => {
    await expect(
      withTimeout(new Promise((resolve) => setTimeout(resolve, 100)), 10, "Generation timed out after 0s."),
    ).rejects.toThrow(/timed out/i);
  });
});

describe("searchTaxonomy", () => {
  const nodes = [
    { id: 2078, name: "Prints", path: "Art & Collectibles / Prints" },
    { id: 1234, name: "Digital Prints", path: "Art & Collectibles / Digital Prints" },
  ];

  it("filters by name, path, or id without calling Etsy", () => {
    expect(searchTaxonomy("digital", nodes).map((node) => node.id)).toEqual([1234]);
    expect(searchTaxonomy("2078", nodes).map((node) => node.id)).toEqual([2078]);
    expect(searchTaxonomy("", nodes)).toHaveLength(2);
  });
});
