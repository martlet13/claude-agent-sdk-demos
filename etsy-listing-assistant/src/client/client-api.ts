import type {
  DraftPublishResult,
  GenerateRequest,
  ListingCopy,
  ListingPackManifest,
  NichePreset,
  PublishTemplate,
  SetupStatus,
  ShopSection,
  TaxonomyHit,
  ValidationResult,
} from "../shared/types";

export interface AppStatus extends SetupStatus {
  claudeConfigured: boolean;
  etsyConfigured: boolean;
  etsyAppSaved?: boolean;
  etsyShopName?: string;
  presets: NichePreset[];
  sections: ShopSection[];
  recentTaxonomy: TaxonomyHit[];
  defaultRedirectUri: string;
  risks: { claude: string; etsy: string };
}

export interface GenerationJob {
  id: string;
  status: string;
  progress: string;
  log?: string[];
  error?: string;
  packId?: string;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(init?.headers ?? {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data as T;
}

export const api = {
  status: () => request<AppStatus>("/api/status"),
  saveClaude: (apiKey: string) =>
    request("/api/setup/claude", { method: "POST", body: JSON.stringify({ apiKey }) }),
  saveEtsyApp: (body: { keystring: string; sharedSecret: string; redirectUri?: string }) =>
    request("/api/setup/etsy-app", { method: "POST", body: JSON.stringify(body) }),
  startOauth: (redirectUri?: string) =>
    request<{ authorizeUrl: string; redirectUri: string }>("/api/etsy/oauth/start", {
      method: "POST",
      body: JSON.stringify({ redirectUri }),
    }),
  disconnectEtsy: () => request("/api/setup/etsy-disconnect", { method: "POST" }),
  generate: (body: GenerateRequest, references?: File[]) => {
    if (references && references.length > 0) {
      const form = new FormData();
      form.set("theme", body.theme);
      form.set("ideaCount", String(body.ideaCount));
      form.set("aspectRatio", body.aspectRatio);
      form.set("presetId", body.presetId);
      if (body.advancedPrompt) form.set("advancedPrompt", body.advancedPrompt);
      for (const file of references) form.append("references", file);
      return request<GenerationJob>("/api/generate", { method: "POST", body: form });
    }
    return request<GenerationJob>("/api/generate", { method: "POST", body: JSON.stringify(body) });
  },
  job: (id: string) => request<GenerationJob>(`/api/jobs/${id}`),
  cancelJob: (id: string) => request<GenerationJob>(`/api/jobs/${id}/cancel`, { method: "POST" }),
  packs: () => request<ListingPackManifest[]>("/api/packs"),
  pack: (id: string) =>
    request<{ pack: ListingPackManifest; validation: ValidationResult; folder: string }>(
      `/api/packs/${id}`,
    ),
  saveCopy: (id: string, copy: ListingCopy) =>
    request<ListingPackManifest>(`/api/packs/${id}/copy`, {
      method: "PATCH",
      body: JSON.stringify(copy),
    }),
  saveImages: (id: string, images: Array<{ id: string; included?: boolean; order?: number }>) =>
    request<ListingPackManifest>(`/api/packs/${id}/images`, {
      method: "PATCH",
      body: JSON.stringify({ images }),
    }),
  saveCommerce: (id: string, body: Partial<ListingPackManifest>) =>
    request<ListingPackManifest>(`/api/packs/${id}/commerce`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  importImage: async (id: string, file: File) => {
    const body = new FormData();
    body.set("image", file);
    return request<ListingPackManifest>(`/api/packs/${id}/images`, { method: "POST", body });
  },
  importFile: async (id: string, file: File) => {
    const body = new FormData();
    body.set("file", file);
    return request<ListingPackManifest>(`/api/packs/${id}/files`, { method: "POST", body });
  },
  templates: () => request<PublishTemplate[]>("/api/templates"),
  cloneTemplate: (listingId: number, name?: string) =>
    request<PublishTemplate>("/api/templates", {
      method: "POST",
      body: JSON.stringify({ listingId, name }),
    }),
  renameTemplate: (id: string, name: string) =>
    request<PublishTemplate>(`/api/templates/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteTemplate: (id: string) =>
    request(`/api/templates/${id}`, { method: "DELETE" }),
  refreshSections: () =>
    request<ShopSection[]>("/api/etsy/sections/refresh", { method: "POST" }),
  searchTaxonomy: (q: string) =>
    request<TaxonomyHit[]>(`/api/etsy/taxonomy?q=${encodeURIComponent(q)}`),
  rememberTaxonomy: (hit: TaxonomyHit) =>
    request<TaxonomyHit[]>("/api/etsy/taxonomy/recent", {
      method: "POST",
      body: JSON.stringify(hit),
    }),
  openPackFolder: (id: string) =>
    request<{ folder: string }>(`/api/packs/${id}/open`, { method: "POST" }),
  publish: (body: {
    packId: string;
    templateId: string;
    shopSectionId?: number;
    taxonomyId: number;
    price: number;
    quantity: number;
    listingType: "physical" | "download";
  }) => request<DraftPublishResult>("/api/publish", { method: "POST", body: JSON.stringify(body) }),
};

export function imageUrl(packId: string, filename: string): string {
  return `/media/packs/${packId}/images/${encodeURIComponent(filename)}`;
}
