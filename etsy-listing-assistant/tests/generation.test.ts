import { describe, expect, it } from "vitest";
import { buildGenerationPrompt, parseGeneratedCopy } from "../src/server/generation.js";
import { extractJsonObject } from "../src/shared/json.js";
import type { GenerateRequest } from "../src/shared/types.js";

const request: GenerateRequest = {
  theme: "terracotta sun over dunes",
  ideaCount: 2,
  aspectRatio: "4:5",
  presetId: "wall-art",
};

describe("parseGeneratedCopy", () => {
  it("enforces Etsy title and tag limits", () => {
    const parsed = parseGeneratedCopy(
      {
        title: "T".repeat(200),
        description: "A warm print for a sunny wall.",
        tags: ["Wall Art", "wall art", "this tag is definitely too long", "sun", "dunes"],
        materials: ["Cotton Paper", "archival ink"],
        imageBriefs: [
          { headline: "Sun", alt: "sun", motif: "emblem", palette: ["#111111", "#cc7744", "#f6efe4"] },
          { headline: "Dune", alt: "dune", motif: "wide", palette: ["#222222", "#dd8855", "#fff8ee"] },
        ],
      },
      request,
    );
    expect(parsed.copy.title).toHaveLength(140);
    expect(parsed.copy.tags).toEqual(["wall art", "this tag is definite", "sun", "dunes"]);
    expect(parsed.copy.materials).toEqual(["cotton paper", "archival ink"]);
    expect(parsed.briefs).toHaveLength(2);
    expect(parsed.briefs[0].palette[0]).toBe("#111111");
  });

  it("fills missing image briefs from the theme", () => {
    const parsed = parseGeneratedCopy(
      { title: "Desert Sun Print", description: "Warm geometry.", tags: ["print"] },
      request,
    );
    expect(parsed.briefs).toHaveLength(2);
    expect(parsed.briefs[0].filename).toBe("promo-01.svg");
  });
});

describe("buildGenerationPrompt", () => {
  it("includes theme, count, and optional seller additions", () => {
    const prompt = buildGenerationPrompt(
      { ...request, advancedPrompt: "avoid the word rustic" },
      "gallery-quality prints",
    );
    expect(prompt).toContain("terracotta sun over dunes");
    expect(prompt).toContain("Idea count (image briefs): 2");
    expect(prompt).toContain("avoid the word rustic");
    expect(prompt).toContain("gallery-quality prints");
  });

  it("mentions seller reference photos when present", () => {
    const prompt = buildGenerationPrompt(
      { ...request, referenceCount: 2 },
      "gallery-quality prints",
      2,
    );
    expect(prompt).toContain("2 reference photo");
  });
});

describe("extractJsonObject", () => {
  it("reads a fenced object used by the generation adapter", () => {
    const payload = extractJsonObject('Here you go:\n```json\n{"title":"Sage Print","description":"Quiet.","tags":["art"]}\n```');
    expect(payload).toMatchObject({ title: "Sage Print" });
  });
});
