import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { PackStore } from "../src/server/pack-builder.js";
import { JobRunner } from "../src/server/jobs.js";
import { fixtureAdapter, tempRoot } from "./helpers.js";

describe("pack builder", () => {
  it("writes a validated manifest and included image paths", () => {
    const root = tempRoot();
    const packs = new PackStore(root);
    const pack = packs.create({
      presetId: "wall-art",
      theme: "terracotta sun",
      listingType: "physical",
      aspectRatio: "4:5",
      copy: {
        title: "Terracotta Sun Print",
        description: "Warm desert geometry for a sunny wall.",
        tags: ["wall art", "sun print"],
      },
      images: [{ filename: "promo-01.svg", alt: "sun", source: "generated" }],
    });
    fs.writeFileSync(packs.imageAbsPath(pack.id, "promo-01.svg"), "<svg></svg>");
    expect(packs.validate(pack.id).ok).toBe(true);
    expect(packs.includedImagePaths(pack)).toHaveLength(1);
    const updated = packs.updateImages(pack.id, [{ id: pack.images[0].id, included: false }]);
    expect(packs.validate(updated.id).ok).toBe(false);
  });
});

describe("generation jobs", () => {
  it("builds a pack with rendered promo images", async () => {
    const root = tempRoot();
    const packs = new PackStore(root);
    const runner = new JobRunner(root, packs, () => fixtureAdapter());
    const job = runner.start({
      theme: "minimal botanicals",
      ideaCount: 2,
      aspectRatio: "1:1",
      presetId: "wall-art",
    });
    for (let i = 0; i < 40 && runner.get(job.id).status === "running"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const done = runner.get(job.id);
    expect(done.status).toBe("complete");
    expect(done.packId).toBeTruthy();
    const pack = packs.read(done.packId!);
    expect(pack.images).toHaveLength(2);
    expect(fs.existsSync(packs.imageAbsPath(pack.id, pack.images[0].filename))).toBe(true);
    expect(fs.readFileSync(packs.imageAbsPath(pack.id, pack.images[0].filename), "utf8")).toContain("<svg");
  });

  it("rejects an empty theme", () => {
    const root = tempRoot();
    const runner = new JobRunner(root, new PackStore(root), () => fixtureAdapter());
    expect(() =>
      runner.start({ theme: "  ", ideaCount: 2, aspectRatio: "1:1", presetId: "wall-art" }),
    ).toThrow(/theme/i);
  });
});
