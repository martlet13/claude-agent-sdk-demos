export type ListingType = "physical" | "download";

export type AspectRatio = "1:1" | "4:5" | "3:4" | "16:9";

export type WhoMade = "i_did" | "someone_else" | "collective";

export type WhenMade =
  | "made_to_order"
  | "2020_2026"
  | "2010_2019"
  | "2005_2009"
  | "before_2005"
  | "2000_2004"
  | "1990s"
  | "1980s"
  | "1970s";

export interface ListingCopy {
  title: string;
  description: string;
  tags: string[];
  materials?: string[];
}

export interface ImageBrief {
  filename: string;
  alt: string;
  headline: string;
  palette: [string, string, string];
  motif: string;
}

export interface GeneratedImage {
  id: string;
  filename: string;
  alt: string;
  included: boolean;
  order: number;
  source: "generated" | "imported";
}

export interface DigitalFile {
  id: string;
  filename: string;
  originalName: string;
}

export interface NichePreset {
  id: string;
  name: string;
  listingType: ListingType;
  description: string;
  defaultAspectRatio: AspectRatio;
  promptHints: string;
  sampleThemes: string[];
}

export interface GenerateRequest {
  theme: string;
  ideaCount: number;
  aspectRatio: AspectRatio;
  presetId: string;
  advancedPrompt?: string;
  /** Count of seller-provided reference photos (not file paths). */
  referenceCount?: number;
}

export interface ListingPackManifest {
  version: 1;
  id: string;
  createdAt: string;
  updatedAt: string;
  presetId: string;
  theme: string;
  listingType: ListingType;
  aspectRatio: AspectRatio;
  copy: ListingCopy;
  images: GeneratedImage[];
  digitalFiles: DigitalFile[];
  price: number;
  quantity: number;
  taxonomyId?: number;
  shopSectionId?: number;
}

export interface PublishTemplate {
  id: string;
  name: string;
  sourceListingId: number;
  listingType: ListingType;
  whoMade: WhoMade;
  whenMade: WhenMade;
  taxonomyId?: number;
  shopSectionId?: number;
  shippingProfileId?: number;
  readinessStateId?: number;
  returnPolicyId?: number;
  isSupply: boolean;
  processingMin?: number;
  processingMax?: number;
  createdAt: string;
}

export interface ShopSection {
  shopSectionId: number;
  title: string;
}

export interface TaxonomyHit {
  id: number;
  name: string;
  path: string;
}

export interface PublishRequest {
  packId: string;
  templateId: string;
  shopSectionId?: number;
  taxonomyId: number;
  price: number;
  quantity: number;
  listingType: ListingType;
}

export interface DraftPublishResult {
  listingId: number;
  shopId: number;
  state: "draft";
  sellerManagerUrl: string;
}

export interface SetupStatus {
  claudeConfigured: boolean;
  etsyConfigured: boolean;
  etsyShopName?: string;
  templateCount: number;
  setupComplete: boolean;
}

export interface ValidationIssue {
  field: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  issues: ValidationIssue[];
}
