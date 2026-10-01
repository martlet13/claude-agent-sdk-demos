import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { InventorySnapshot, PublishTemplate } from "../shared/types.js";
import type { EtsyListingSnapshot } from "./etsy-client.js";
import { appPaths, ensureDir } from "./paths.js";

export function templateFromListing(
  listing: EtsyListingSnapshot,
  name?: string,
  inventory?: InventorySnapshot,
): PublishTemplate {
  return {
    id: randomUUID(),
    name: name?.trim() || listing.title.slice(0, 80) || `Listing ${listing.listingId}`,
    sourceListingId: listing.listingId,
    listingType: listing.listingType,
    whoMade: listing.whoMade as PublishTemplate["whoMade"],
    whenMade: listing.whenMade as PublishTemplate["whenMade"],
    taxonomyId: listing.taxonomyId,
    shopSectionId: listing.shopSectionId,
    shippingProfileId: listing.shippingProfileId,
    readinessStateId: listing.readinessStateId,
    returnPolicyId: listing.returnPolicyId,
    isSupply: listing.isSupply,
    processingMin: listing.processingMin,
    processingMax: listing.processingMax,
    inventory,
    createdAt: new Date().toISOString(),
  };
}

export class TemplateStore {
  private readonly file: string;

  constructor(dataRoot: string) {
    const paths = appPaths(dataRoot);
    ensureDir(paths.root);
    this.file = paths.templatesFile;
  }

  list(): PublishTemplate[] {
    if (!fs.existsSync(this.file)) return [];
    return JSON.parse(fs.readFileSync(this.file, "utf8")) as PublishTemplate[];
  }

  save(templates: PublishTemplate[]): void {
    fs.writeFileSync(this.file, JSON.stringify(templates, null, 2));
  }

  get(id: string): PublishTemplate {
    const found = this.list().find((template) => template.id === id);
    if (!found) throw new Error(`Template not found: ${id}`);
    return found;
  }

  add(template: PublishTemplate): PublishTemplate {
    const templates = this.list();
    templates.push(template);
    this.save(templates);
    return template;
  }

  rename(id: string, name: string): PublishTemplate {
    const templates = this.list();
    const template = templates.find((item) => item.id === id);
    if (!template) throw new Error(`Template not found: ${id}`);
    template.name = name.trim();
    this.save(templates);
    return template;
  }

  delete(id: string): void {
    this.save(this.list().filter((template) => template.id !== id));
  }
}
