import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { GenerateRequest, ListingPackManifest } from "../shared/types.js";
import { requirePreset } from "../shared/presets.js";
import { sanitizeTags } from "../shared/validation.js";
import type { GenerationAdapter } from "./generation.js";
import { PackStore } from "./pack-builder.js";
import { briefsFromTheme, listingImageFilename, renderPromoPng, renderPromoSvg } from "./promo-art.js";
import { appPaths, ensureDir } from "./paths.js";

export type JobStatus = "queued" | "running" | "cancelling" | "cancelled" | "complete" | "error";

export interface GenerationJob {
  id: string;
  status: JobStatus;
  progress: string;
  error?: string;
  packId?: string;
  request: GenerateRequest;
  createdAt: string;
  updatedAt: string;
}

export class JobRunner {
  private readonly jobs = new Map<string, GenerationJob>();
  private readonly cancelled = new Set<string>();
  private readonly jobsDir: string;

  constructor(
    dataRoot: string,
    private readonly packs: PackStore,
    private readonly adapterFor: () => GenerationAdapter,
  ) {
    this.jobsDir = appPaths(dataRoot).jobsDir;
    ensureDir(this.jobsDir);
  }

  list(): GenerationJob[] {
    return [...this.jobs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  get(id: string): GenerationJob {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    return job;
  }

  cancel(id: string): GenerationJob {
    const job = this.get(id);
    if (job.status === "running" || job.status === "queued") {
      this.cancelled.add(id);
      this.patch(id, { status: "cancelling", progress: "Cancel requested…" });
    }
    return this.get(id);
  }

  start(request: GenerateRequest): GenerationJob {
    if (!request.theme?.trim()) {
      throw new Error("Enter a theme or brief before generating.");
    }
    const preset = requirePreset(request.presetId);
    const job: GenerationJob = {
      id: randomUUID(),
      status: "queued",
      progress: "Queued",
      request: {
        ...request,
        ideaCount: Math.min(10, Math.max(1, Number(request.ideaCount) || 4)),
        theme: request.theme.trim(),
        advancedPrompt: request.advancedPrompt?.trim() || undefined,
        presetId: preset.id,
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.jobs.set(job.id, job);
    void this.run(job.id);
    return job;
  }

  private patch(id: string, patch: Partial<GenerationJob>): void {
    const current = this.get(id);
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.jobs.set(id, next);
    fs.writeFileSync(path.join(this.jobsDir, `${id}.json`), JSON.stringify(next, null, 2));
  }

  private assertNotCancelled(id: string): void {
    if (this.cancelled.has(id)) {
      this.patch(id, { status: "cancelled", progress: "Cancelled by seller." });
      throw new CancelledError();
    }
  }

  private async run(id: string): Promise<void> {
    try {
      this.patch(id, { status: "running", progress: "Generating listing copy…" });
      this.assertNotCancelled(id);
      const job = this.get(id);
      const generated = await this.adapterFor().generateCopy(job.request);
      this.assertNotCancelled(id);
      this.patch(id, { progress: "Rendering promo frames…" });
      const briefs =
        generated.briefs.length > 0
          ? generated.briefs
          : briefsFromTheme(job.request.theme, job.request.ideaCount);
      const copy = {
        ...generated.copy,
        tags: sanitizeTags(generated.copy.tags),
      };
      const pack = this.packs.create({
        presetId: job.request.presetId,
        theme: job.request.theme,
        listingType: requirePreset(job.request.presetId).listingType,
        aspectRatio: job.request.aspectRatio,
        copy,
        images: briefs.map((brief) => ({
          filename: listingImageFilename(brief.filename),
          alt: brief.alt,
          source: "generated" as const,
        })),
      });
      for (const brief of briefs) {
        this.assertNotCancelled(id);
        const pngName = listingImageFilename(brief.filename);
        fs.writeFileSync(
          this.packs.imageAbsPath(pack.id, brief.filename),
          renderPromoSvg(brief, job.request.aspectRatio),
        );
        fs.writeFileSync(
          this.packs.imageAbsPath(pack.id, pngName),
          renderPromoPng(brief, job.request.aspectRatio),
        );
      }
      this.patch(id, {
        status: "complete",
        progress: "Pack ready.",
        packId: pack.id,
      });
    } catch (error) {
      if (error instanceof CancelledError) return;
      this.patch(id, {
        status: "error",
        progress: "Failed",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  openOutputFolder(packId: string): string {
    return this.packs.packDir(packId);
  }
}

class CancelledError extends Error {
  constructor() {
    super("cancelled");
  }
}

export type { ListingPackManifest };
