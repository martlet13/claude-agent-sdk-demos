import { describe, expect, it } from "vitest";
import {
  assertNeverActivates,
  sanitizeTags,
  validateCopy,
  validatePackForDraft,
  validatePublishRequest,
} from "../src/shared/validation.js";
import type { ListingPackManifest } from "../src/shared/types.js";

function pack(overrides: Partial<ListingPackManifest> = {}): ListingPackManifest {
  return {
    version: 1,
    id: "pack-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    presetId: "wall-art",
    theme: "sage botanicals",
    listingType: "physical",
    aspectRatio: "4:5",
    copy: {
      title: "Sage Botanical Line Art Print",
      description: "A calm botanical print for a hallway or kitchen.",
      tags: ["wall art", "botanical"],
    },
    images: [
      {
        id: "img-1",
        filename: "promo-01.svg",
        alt: "print",
        included: true,
        order: 0,
        source: "generated",
      },
    ],
    digitalFiles: [],
    price: 18,
    quantity: 1,
    ...overrides,
  };
}

describe("sanitizeTags", () => {
  it("lowercases, dedupes, and caps at 13", () => {
    const tags = sanitizeTags([
      "Wall Art",
      "wall art",
      "HOME_DECOR",
      "this tag is way too long for etsy",
      ...Array.from({ length: 20 }, (_, i) => `tag${i}`),
    ]);
    expect(tags[0]).toBe("wall art");
    expect(tags).toHaveLength(13);
    expect(tags.every((tag) => tag.length <= 20)).toBe(true);
  });
});

describe("validateCopy", () => {
  it("rejects an empty title and overlong title", () => {
    expect(validateCopy({ title: "", description: "x", tags: ["art"] }).ok).toBe(false);
    expect(
      validateCopy({ title: "x".repeat(141), description: "x", tags: ["art"] }).issues[0].field,
    ).toBe("title");
  });
});

describe("validatePackForDraft", () => {
  it("requires an included image and a digital file for downloads", () => {
    expect(validatePackForDraft(pack()).ok).toBe(true);
    expect(
      validatePackForDraft(
        pack({
          images: pack().images.map((image) => ({ ...image, included: false })),
        }),
      ).ok,
    ).toBe(false);
    expect(validatePackForDraft(pack({ listingType: "download" })).ok).toBe(false);
    expect(
      validatePackForDraft(
        pack({
          listingType: "download",
          digitalFiles: [{ id: "f", filename: "pack.zip", originalName: "pack.zip" }],
        }),
      ).ok,
    ).toBe(true);
  });
});

describe("validatePublishRequest", () => {
  it("requires a template and taxonomy", () => {
    const result = validatePublishRequest(
      {
        packId: "pack-1",
        templateId: "",
        taxonomyId: 0,
        price: 18,
        quantity: 1,
        listingType: "physical",
      },
      pack(),
    );
    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.field)).toContain("templateId");
    expect(result.issues.map((issue) => issue.field)).toContain("taxonomyId");
  });
});

describe("assertNeverActivates", () => {
  it("allows omitted or draft state and blocks active", () => {
    expect(() => assertNeverActivates({})).not.toThrow();
    expect(() => assertNeverActivates({ state: "draft" })).not.toThrow();
    expect(() => assertNeverActivates({ state: "active" })).toThrow(/drafts only/);
  });
});
