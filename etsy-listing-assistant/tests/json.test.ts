import { describe, expect, it } from "vitest";
import { extractJsonObject } from "../src/shared/json.js";
import { parseGeneratedCopy } from "../src/server/generation.js";

describe("extractJsonObject", () => {
  it("reads fenced and raw objects", () => {
    expect(extractJsonObject('```json\n{"title":"A"}\n```')).toEqual({ title: "A" });
    expect(extractJsonObject('Sure.\n{"title":"B","tags":[]}\n')).toEqual({
      title: "B",
      tags: [],
    });
  });
});

describe("parseGeneratedCopy", () => {
  it("sanitizes tags and fills missing briefs", () => {
    const parsed = parseGeneratedCopy(
      {
        title: "Coastal Print",
        description: "Soft dusk light over a quiet harbor.",
        tags: ["Wall Art", "wall art", "lighthouse-print"],
      },
      {
        theme: "coastal lighthouse",
        ideaCount: 3,
        aspectRatio: "4:5",
        presetId: "wall-art",
      },
    );
    expect(parsed.copy.tags[0]).toBe("wall art");
    expect(parsed.briefs).toHaveLength(3);
  });
});
