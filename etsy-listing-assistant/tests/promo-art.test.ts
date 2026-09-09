import { describe, expect, it } from "vitest";
import {
  briefsFromTheme,
  listingImageFilename,
  renderPromoPng,
  renderPromoSvg,
  wrapSvgLines,
} from "../src/server/promo-art.js";

describe("promo frames", () => {
  it("builds deterministic briefs and an SVG preview", () => {
    const briefs = briefsFromTheme("sage botanicals", 3);
    expect(briefs).toHaveLength(3);
    expect(briefs[0].filename).toBe("promo-01.svg");
    const svg = renderPromoSvg(briefs[0], "4:5");
    expect(svg).toContain("<svg");
    expect(svg).toContain("sage botanicals");
    expect(svg).toContain("<tspan");
  });

  it("renders an Etsy-compatible PNG listing image", () => {
    const [brief] = briefsFromTheme("terracotta sun", 1);
    const png = renderPromoPng(brief, "1:1");
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.length).toBeGreaterThan(200);
    expect(listingImageFilename(brief.filename)).toBe("promo-01.png");
  });

  it("wraps long headlines onto multiple lines", () => {
    expect(wrapSvgLines("Minimal botanical line drawings in sage and cream", 12).length).toBeGreaterThan(1);
  });
});
