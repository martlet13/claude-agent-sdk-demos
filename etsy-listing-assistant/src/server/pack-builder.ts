import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  DigitalFile,
  GeneratedImage,
  ListingCopy,
  ListingPackManifest,
  ListingType,
  AspectRatio,
} from "../shared/types.js";
import { validateCopy, validatePackForDraft } from "../shared/validation.js";
import { appPaths, ensureDir } from "./paths.js";

export class PackStore {
  private readonly packsDir: string;

  constructor(dataRoot: string) {
    this.packsDir = appPaths(dataRoot).packsDir;
    ensureDir(this.packsDir);
  }

  packDir(id: string): string {
    return path.join(this.packsDir, id);
  }

  imagesDir(id: string): string {
    return path.join(this.packDir(id), "images");
  }

  filesDir(id: string): string {
    return path.join(this.packDir(id), "files");
  }

  manifestPath(id: string): string {
    return path.join(this.packDir(id), "manifest.json");
  }

  create(input: {
    presetId: string;
    theme: string;
    listingType: ListingType;
    aspectRatio: AspectRatio;
    copy: ListingCopy;
    images: Array<{ filename: string; alt: string; source: GeneratedImage["source"] }>;
    price?: number;
    quantity?: number;
  }): ListingPackManifest {
    const copyCheck = validateCopy(input.copy);
    if (!copyCheck.ok) {
      throw new Error(copyCheck.issues.map((issue) => issue.message).join(" "));
    }
    const id = randomUUID();
    ensureDir(this.imagesDir(id));
    ensureDir(this.filesDir(id));
    const images: GeneratedImage[] = input.images.map((image, index) => ({
      id: randomUUID(),
      filename: image.filename,
      alt: image.alt,
      included: true,
      order: index,
      source: image.source,
    }));
    const manifest: ListingPackManifest = {
      version: 1,
      id,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      presetId: input.presetId,
      theme: input.theme,
      listingType: input.listingType,
      aspectRatio: input.aspectRatio,
      copy: input.copy,
      images,
      digitalFiles: [],
      price: input.price ?? 19.0,
      quantity: input.quantity ?? 1,
    };
    this.write(manifest);
    return manifest;
  }

  list(): ListingPackManifest[] {
    if (!fs.existsSync(this.packsDir)) return [];
    return fs
      .readdirSync(this.packsDir)
      .filter((name) => fs.existsSync(this.manifestPath(name)))
      .map((name) => this.read(name))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  read(id: string): ListingPackManifest {
    const file = this.manifestPath(id);
    if (!fs.existsSync(file)) {
      throw new Error(`Listing pack not found: ${id}`);
    }
    return JSON.parse(fs.readFileSync(file, "utf8")) as ListingPackManifest;
  }

  write(manifest: ListingPackManifest): void {
    ensureDir(this.packDir(manifest.id));
    manifest.updatedAt = new Date().toISOString();
    fs.writeFileSync(this.manifestPath(manifest.id), JSON.stringify(manifest, null, 2));
  }

  updateCopy(id: string, copy: ListingCopy): ListingPackManifest {
    const check = validateCopy(copy);
    if (!check.ok) {
      throw new Error(check.issues.map((issue) => issue.message).join(" "));
    }
    const manifest = this.read(id);
    manifest.copy = copy;
    this.write(manifest);
    return manifest;
  }

  updateImages(
    id: string,
    updates: Array<{ id: string; included?: boolean; order?: number }>,
  ): ListingPackManifest {
    const manifest = this.read(id);
    const byId = new Map(updates.map((update) => [update.id, update]));
    manifest.images = manifest.images.map((image) => {
      const update = byId.get(image.id);
      if (!update) return image;
      return {
        ...image,
        included: update.included ?? image.included,
        order: update.order ?? image.order,
      };
    });
    this.write(manifest);
    return manifest;
  }

  addImportedImage(id: string, filename: string, alt: string): ListingPackManifest {
    const manifest = this.read(id);
    const nextOrder = manifest.images.reduce((max, image) => Math.max(max, image.order), -1) + 1;
    manifest.images.push({
      id: randomUUID(),
      filename,
      alt,
      included: true,
      order: nextOrder,
      source: "imported",
    });
    this.write(manifest);
    return manifest;
  }

  addDigitalFile(id: string, filename: string, originalName: string): ListingPackManifest {
    const manifest = this.read(id);
    const file: DigitalFile = { id: randomUUID(), filename, originalName };
    manifest.digitalFiles.push(file);
    this.write(manifest);
    return manifest;
  }

  duplicate(id: string): ListingPackManifest {
    const source = this.read(id);
    const newId = randomUUID();
    fs.cpSync(this.packDir(id), this.packDir(newId), { recursive: true });
    const next: ListingPackManifest = {
      ...source,
      id: newId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      images: source.images.map((image) => ({ ...image, id: randomUUID() })),
      digitalFiles: source.digitalFiles.map((file) => ({ ...file, id: randomUUID() })),
    };
    this.write(next);
    return next;
  }

  updateCommerce(
    id: string,
    patch: Partial<Pick<ListingPackManifest, "price" | "quantity" | "taxonomyId" | "shopSectionId" | "listingType">>,
  ): ListingPackManifest {
    const manifest = this.read(id);
    Object.assign(manifest, patch);
    this.write(manifest);
    return manifest;
  }

  imageAbsPath(packId: string, filename: string): string {
    const resolved = path.resolve(this.imagesDir(packId), filename);
    if (!resolved.startsWith(path.resolve(this.imagesDir(packId)))) {
      throw new Error("Invalid image path.");
    }
    return resolved;
  }

  fileAbsPath(packId: string, filename: string): string {
    const resolved = path.resolve(this.filesDir(packId), filename);
    if (!resolved.startsWith(path.resolve(this.filesDir(packId)))) {
      throw new Error("Invalid file path.");
    }
    return resolved;
  }

  includedImagePaths(pack: ListingPackManifest): string[] {
    return pack.images
      .filter((image) => image.included)
      .sort((a, b) => a.order - b.order)
      .map((image) => this.imageAbsPath(pack.id, image.filename));
  }

  digitalFilePaths(pack: ListingPackManifest): string[] {
    return pack.digitalFiles.map((file) => this.fileAbsPath(pack.id, file.filename));
  }

  validate(id: string) {
    return validatePackForDraft(this.read(id));
  }
}
