import fs from "node:fs";
import { randomUUID } from "node:crypto";
import type { PublishLogEntry } from "../shared/types.js";
import { appPaths, ensureDir } from "./paths.js";

const MAX_ENTRIES = 100;

export class PublishLogStore {
  private readonly file: string;

  constructor(dataRoot: string) {
    const paths = appPaths(dataRoot);
    ensureDir(paths.root);
    this.file = paths.publishLogFile;
  }

  list(): PublishLogEntry[] {
    if (!fs.existsSync(this.file)) return [];
    const parsed = JSON.parse(fs.readFileSync(this.file, "utf8")) as PublishLogEntry[];
    return parsed.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  add(entry: Omit<PublishLogEntry, "id" | "createdAt"> & { id?: string; createdAt?: string }): PublishLogEntry {
    const record: PublishLogEntry = {
      ...entry,
      id: entry.id ?? randomUUID(),
      createdAt: entry.createdAt ?? new Date().toISOString(),
      warnings: entry.warnings ?? [],
      imagesUploaded: entry.imagesUploaded ?? 0,
      imageCount: entry.imageCount ?? 0,
      filesUploaded: entry.filesUploaded ?? 0,
      fileCount: entry.fileCount ?? 0,
      variationsApplied: Boolean(entry.variationsApplied),
    };
    const next = [record, ...this.list().filter((item) => item.id !== record.id)].slice(0, MAX_ENTRIES);
    fs.writeFileSync(this.file, JSON.stringify(next, null, 2));
    return record;
  }
}
