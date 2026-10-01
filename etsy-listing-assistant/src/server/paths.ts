import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function defaultDataRoot(override?: string): string {
  return override ?? path.join(os.homedir(), ".etsy-listing-assistant");
}

export function appPaths(root: string) {
  return {
    root,
    keyFile: path.join(root, ".master.key"),
    vaultFile: path.join(root, "credentials.enc"),
    settingsFile: path.join(root, "settings.json"),
    templatesFile: path.join(root, "templates.json"),
    cacheDir: path.join(root, "cache"),
    sectionsCache: path.join(root, "cache", "shop-sections.json"),
    taxonomyCache: path.join(root, "cache", "taxonomy.json"),
    recentTaxonomyFile: path.join(root, "cache", "recent-taxonomy.json"),
    packsDir: path.join(root, "packs"),
    jobsDir: path.join(root, "jobs"),
    publishLogFile: path.join(root, "publish-log.json"),
  };
}

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
}
