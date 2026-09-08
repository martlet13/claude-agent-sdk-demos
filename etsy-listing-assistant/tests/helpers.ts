import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import { createAppContext, type AppContext } from "../src/server/app-context.js";
import type { GenerationAdapter } from "../src/server/generation.js";
import { briefsFromTheme } from "../src/server/promo-art.js";
import type { GenerateRequest, ListingCopy } from "../src/shared/types.js";

export function tempRoot(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "etsy-assistant-"));
}

export function fixtureAdapter(copy?: Partial<ListingCopy>): GenerationAdapter {
  return {
    async generateCopy(request: GenerateRequest) {
      return {
        copy: {
          title: copy?.title ?? `${request.theme} printable wall art`.slice(0, 140),
          description:
            copy?.description ??
            `A listing about ${request.theme}. Honest materials and size notes go here.`,
          tags: copy?.tags ?? ["wall art", "print", "home decor", "digital"],
        },
        briefs: briefsFromTheme(request.theme, request.ideaCount),
        rawText: "{}",
      };
    },
  };
}

export function testContext(input?: {
  fetchImpl?: typeof fetch;
  adapter?: GenerationAdapter;
}): { ctx: AppContext; root: string } {
  const root = tempRoot();
  const ctx = createAppContext({
    dataRoot: root,
    publicOrigin: "http://127.0.0.1:8787",
    generationAdapter: input?.adapter ?? fixtureAdapter(),
    fetchImpl: input?.fetchImpl,
  });
  return { ctx, root };
}
