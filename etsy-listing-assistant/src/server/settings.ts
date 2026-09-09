import fs from "node:fs";
import type { ShopSection, TaxonomyHit } from "../shared/types.js";
import { appPaths, ensureDir } from "./paths.js";

export interface AppSettings {
  recentTaxonomy: TaxonomyHit[];
  lastRedirectUri?: string;
}

export class SettingsStore {
  private readonly paths: ReturnType<typeof appPaths>;

  constructor(dataRoot: string) {
    this.paths = appPaths(dataRoot);
    ensureDir(this.paths.root);
    ensureDir(this.paths.cacheDir);
  }

  read(): AppSettings {
    if (!fs.existsSync(this.paths.settingsFile)) {
      return { recentTaxonomy: [] };
    }
    return JSON.parse(fs.readFileSync(this.paths.settingsFile, "utf8")) as AppSettings;
  }

  write(settings: AppSettings): void {
    fs.writeFileSync(this.paths.settingsFile, JSON.stringify(settings, null, 2));
  }

  rememberTaxonomy(hit: TaxonomyHit): TaxonomyHit[] {
    const settings = this.read();
    const next = [hit, ...settings.recentTaxonomy.filter((item) => item.id !== hit.id)].slice(0, 12);
    this.write({ ...settings, recentTaxonomy: next });
    return next;
  }

  saveSections(sections: ShopSection[]): void {
    fs.writeFileSync(this.paths.sectionsCache, JSON.stringify(sections, null, 2));
  }

  loadSections(): ShopSection[] {
    if (!fs.existsSync(this.paths.sectionsCache)) return [];
    return JSON.parse(fs.readFileSync(this.paths.sectionsCache, "utf8")) as ShopSection[];
  }

  saveTaxonomy(nodes: TaxonomyHit[]): void {
    fs.writeFileSync(this.paths.taxonomyCache, JSON.stringify(nodes, null, 2));
  }

  loadTaxonomy(): TaxonomyHit[] {
    if (!fs.existsSync(this.paths.taxonomyCache)) return [];
    return JSON.parse(fs.readFileSync(this.paths.taxonomyCache, "utf8")) as TaxonomyHit[];
  }
}
