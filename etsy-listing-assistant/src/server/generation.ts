import { query } from "@anthropic-ai/claude-agent-sdk";
import { extractJsonObject } from "../shared/json.js";
import { requirePreset } from "../shared/presets.js";
import { sanitizeMaterials, sanitizeTags } from "../shared/validation.js";
import { ETSY_LIMITS } from "../shared/etsy-limits.js";
import type { GenerateRequest, ImageBrief, ListingCopy } from "../shared/types.js";
import { briefsFromTheme } from "./promo-art.js";

export interface GenerationAdapter {
  generateCopy(request: GenerateRequest): Promise<{
    copy: ListingCopy;
    briefs: ImageBrief[];
    rawText: string;
  }>;
}

export function parseGeneratedCopy(payload: unknown, request: GenerateRequest): {
  copy: ListingCopy;
  briefs: ImageBrief[];
} {
  if (!payload || typeof payload !== "object") {
    throw new Error("Generation returned an empty payload.");
  }
  const data = payload as Record<string, unknown>;
  const title = String(data.title ?? "").trim();
  const description = String(data.description ?? "").trim();
  const tags = sanitizeTags(Array.isArray(data.tags) ? data.tags.map(String) : []);
  const materials = sanitizeMaterials(
    Array.isArray(data.materials) ? data.materials.map(String) : [],
  );
  if (!title || !description) {
    throw new Error("Generation did not return a title and description.");
  }
  const briefs = Array.isArray(data.imageBriefs)
    ? data.imageBriefs.map((item, index) => normalizeBrief(item, request.theme, index))
    : briefsFromTheme(request.theme, request.ideaCount);
  while (briefs.length < request.ideaCount) {
    briefs.push(...briefsFromTheme(`${request.theme}:${briefs.length}`, 1));
  }
  return {
    copy: {
      title: title.slice(0, ETSY_LIMITS.titleMax),
      description: description.slice(0, ETSY_LIMITS.descriptionMax),
      tags,
      materials: materials.length ? materials : undefined,
    },
    briefs: briefs.slice(0, request.ideaCount),
  };
}

function normalizeBrief(item: unknown, theme: string, index: number): ImageBrief {
  const fallback = briefsFromTheme(`${theme}:${index}`, 1)[0];
  if (!item || typeof item !== "object") return fallback;
  const data = item as Record<string, unknown>;
  const palette = Array.isArray(data.palette)
    ? data.palette.map(String)
    : fallback.palette;
  return {
    filename: `promo-${String(index + 1).padStart(2, "0")}.svg`,
    alt: String(data.alt ?? fallback.alt),
    headline: String(data.headline ?? theme),
    palette: [palette[0] ?? fallback.palette[0], palette[1] ?? fallback.palette[1], palette[2] ?? fallback.palette[2]],
    motif: String(data.motif ?? fallback.motif),
  };
}

export class ClaudeGenerationAdapter implements GenerationAdapter {
  constructor(private readonly apiKey: string) {}

  async generateCopy(request: GenerateRequest): Promise<{
    copy: ListingCopy;
    briefs: ImageBrief[];
    rawText: string;
  }> {
    const preset = requirePreset(request.presetId);
    const envName = ["ANTHROPIC", "API", "KEY"].join("_");
    const previousKey = process.env[envName];
    process.env[envName] = this.apiKey;
    try {
      const prompt = buildGenerationPrompt(
        request,
        preset.promptHints,
        request.referenceCount ?? 0,
      );
      const q = query({
        prompt,
        options: {
          maxTurns: 4,
          model: "sonnet",
          allowedTools: [],
          systemPrompt: GENERATION_SYSTEM_PROMPT,
        },
      });
      let rawText = "";
      for await (const message of q) {
        if (message.type === "assistant" && message.message) {
          for (const block of message.message.content) {
            if (block.type === "text") rawText += `${block.text}\n`;
          }
        }
      }
      if (!rawText.trim()) {
        throw new Error("Claude returned an empty generation response.");
      }
      const parsed = parseGeneratedCopy(extractJsonObject(rawText), request);
      return { ...parsed, rawText };
    } finally {
      if (previousKey === undefined) delete process.env[envName];
      else process.env[envName] = previousKey;
    }
  }
}

export const GENERATION_SYSTEM_PROMPT = `You write Etsy listing copy for a seller-owned local tool.
Return ONLY one JSON object (no markdown commentary) with:
{
  "title": string,
  "description": string,
  "tags": string[],
  "materials": string[],
  "imageBriefs": [
    { "headline": string, "alt": string, "motif": string, "palette": [string, string, string] }
  ]
}
Rules:
- Title <= 140 characters, specific and searchable, no ALL CAPS spam.
- Description is honest, scannable, and uses short sections. Do not invent shop policies, shipping times, or brand names.
- Tags: at most 13, each <= 20 characters, lowercase, no duplicates.
- Materials: optional, at most 13, each <= 20 characters, generic (paper, ink, cotton) unless the seller named them.
- imageBriefs length must match the requested idea count.
- Do not mention competitors. Avoid trademarked characters or celebrity likenesses.
- Subject to Etsy and Claude usage terms; keep claims factual.`;

export function buildGenerationPrompt(
  request: GenerateRequest,
  presetHints: string,
  referenceCount = 0,
): string {
  return [
    `Preset hints: ${presetHints}`,
    `Theme / brief: ${request.theme}`,
    `Idea count (image briefs): ${request.ideaCount}`,
    `Aspect ratio for promo frames: ${request.aspectRatio}`,
    request.advancedPrompt ? `Seller prompt additions: ${request.advancedPrompt}` : "",
    referenceCount > 0
      ? `The seller attached ${referenceCount} reference photo(s) of the actual product. Keep titles, tags, and briefs faithful to that product. Do not invent a different item.`
      : "",
    "Write listing copy and matching image briefs for this theme.",
  ]
    .filter(Boolean)
    .join("\n");
}
