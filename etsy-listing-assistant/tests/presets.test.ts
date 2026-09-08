import { describe, expect, it } from "vitest";
import { STARTER_PRESETS, requirePreset } from "../src/shared/presets.js";

describe("starter presets", () => {
  it("ships generic wall art, digital, and custom product presets", () => {
    expect(STARTER_PRESETS.map((preset) => preset.id)).toEqual([
      "wall-art",
      "digital-download",
      "custom-product",
    ]);
    for (const preset of STARTER_PRESETS) {
      expect(preset.name).not.toMatch(/etsy|anthropic|vendor/i);
      expect(preset.sampleThemes.length).toBeGreaterThan(0);
    }
  });

  it("rejects unknown presets", () => {
    expect(() => requirePreset("not-real")).toThrow(/Unknown preset/);
  });
});
