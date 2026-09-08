import { ETSY_LIMITS } from "./etsy-limits.js";
import type {
  ListingCopy,
  ListingPackManifest,
  ListingType,
  PublishRequest,
  ValidationIssue,
  ValidationResult,
} from "./types.js";

const TAG_PATTERN = /^[a-z0-9][a-z0-9 -]{0,18}[a-z0-9]$|^[a-z0-9]$/;

export function normalizeTag(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[_.,/]+/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, ETSY_LIMITS.tagMaxLength)
    .trim();
}

export function sanitizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const tag of tags) {
    const normalized = normalizeTag(tag);
    if (!normalized || seen.has(normalized)) continue;
    if (normalized.length > ETSY_LIMITS.tagMaxLength) continue;
    if (!TAG_PATTERN.test(normalized) && normalized.length > 1) {
      const compact = normalized.replace(/[^a-z0-9 -]/g, "").trim();
      if (!compact || seen.has(compact)) continue;
      seen.add(compact);
      result.push(compact);
    } else {
      seen.add(normalized);
      result.push(normalized);
    }
    if (result.length >= ETSY_LIMITS.tagMaxCount) break;
  }
  return result;
}

function issue(field: string, message: string): ValidationIssue {
  return { field, message };
}

export function validateCopy(copy: ListingCopy): ValidationResult {
  const issues: ValidationIssue[] = [];
  const title = copy.title?.trim() ?? "";
  const description = copy.description?.trim() ?? "";
  const tags = copy.tags ?? [];

  if (!title) issues.push(issue("title", "Title is required."));
  if (title.length > ETSY_LIMITS.titleMax) {
    issues.push(
      issue("title", `Title must be ${ETSY_LIMITS.titleMax} characters or fewer.`),
    );
  }
  if (!description) issues.push(issue("description", "Description is required."));
  if (description.length > ETSY_LIMITS.descriptionMax) {
    issues.push(
      issue(
        "description",
        `Description must be ${ETSY_LIMITS.descriptionMax} characters or fewer.`,
      ),
    );
  }
  if (tags.length === 0) {
    issues.push(issue("tags", "At least one tag is required."));
  }
  if (tags.length > ETSY_LIMITS.tagMaxCount) {
    issues.push(
      issue("tags", `Etsy allows at most ${ETSY_LIMITS.tagMaxCount} tags.`),
    );
  }
  tags.forEach((tag, index) => {
    if (tag.length > ETSY_LIMITS.tagMaxLength) {
      issues.push(
        issue(
          `tags.${index}`,
          `Tag "${tag}" exceeds ${ETSY_LIMITS.tagMaxLength} characters.`,
        ),
      );
    }
  });

  return { ok: issues.length === 0, issues };
}

export function validatePackForDraft(
  pack: ListingPackManifest,
  extras?: { listingType?: ListingType; requireDigitalFile?: boolean },
): ValidationResult {
  const issues = [...validateCopy(pack.copy).issues];
  const listingType = extras?.listingType ?? pack.listingType;
  const included = pack.images
    .filter((image) => image.included)
    .sort((a, b) => a.order - b.order);

  if (included.length < ETSY_LIMITS.imageMinCount) {
    issues.push(
      issue(
        "images",
        "A draft pack needs at least one included image so the listing can later be activated in Seller Manager.",
      ),
    );
  }
  if (included.length > ETSY_LIMITS.imageMaxCount) {
    issues.push(
      issue(
        "images",
        `Etsy allows at most ${ETSY_LIMITS.imageMaxCount} listing images.`,
      ),
    );
  }
  if (pack.price < ETSY_LIMITS.priceMin) {
    issues.push(
      issue("price", `Price must be at least $${ETSY_LIMITS.priceMin.toFixed(2)}.`),
    );
  }
  if (!Number.isInteger(pack.quantity) || pack.quantity < ETSY_LIMITS.quantityMin) {
    issues.push(issue("quantity", "Quantity must be a whole number of at least 1."));
  }

  if (listingType === "download" || extras?.requireDigitalFile) {
    if (pack.digitalFiles.length === 0) {
      issues.push(
        issue(
          "digitalFiles",
          "Digital listings need at least one downloadable file in the pack.",
        ),
      );
    }
  }

  return { ok: issues.length === 0, issues };
}

export function validatePublishRequest(
  request: PublishRequest,
  pack: ListingPackManifest,
): ValidationResult {
  const issues = [
    ...validatePackForDraft(pack, {
      listingType: request.listingType,
      requireDigitalFile: request.listingType === "download",
    }).issues,
  ];
  if (!request.templateId) {
    issues.push(issue("templateId", "Select a publish template cloned from your shop."));
  }
  if (!Number.isInteger(request.taxonomyId) || request.taxonomyId <= 0) {
    issues.push(issue("taxonomyId", "Select an Etsy taxonomy category."));
  }
  if (request.price < ETSY_LIMITS.priceMin) {
    issues.push(
      issue("price", `Price must be at least $${ETSY_LIMITS.priceMin.toFixed(2)}.`),
    );
  }
  return { ok: issues.length === 0, issues };
}

export function assertNeverActivates(body: Record<string, unknown>): void {
  const state = body.state;
  if (state !== undefined && state !== "draft") {
    throw new Error(
      `Refusing to send listing state "${String(state)}". This app creates drafts only.`,
    );
  }
}
