import fs from "node:fs";
import path from "node:path";
import { assertNeverActivates } from "../shared/validation.js";
import type { DraftPublishResult, ListingType, ShopSection, TaxonomyHit } from "../shared/types.js";
import type { EtsyAppCredentials, EtsyTokens } from "./credential-store.js";
import {
  parseUserIdFromAccessToken,
  refreshAccessToken,
} from "./etsy-oauth.js";
import { CreatePacer, retryAfterMs, systemClock, type Clock } from "./rate-limit.js";

export const ETSY_API_BASE = "https://openapi.etsy.com/v3";

export interface EtsyListingSnapshot {
  listingId: number;
  title: string;
  listingType: ListingType;
  whoMade: string;
  whenMade: string;
  taxonomyId?: number;
  shopSectionId?: number;
  shippingProfileId?: number;
  readinessStateId?: number;
  returnPolicyId?: number;
  isSupply: boolean;
  processingMin?: number;
  processingMax?: number;
}

export interface CreateDraftInput {
  title: string;
  description: string;
  tags: string[];
  price: number;
  quantity: number;
  taxonomyId: number;
  listingType: ListingType;
  whoMade: string;
  whenMade: string;
  isSupply: boolean;
  shopSectionId?: number;
  shippingProfileId?: number;
  readinessStateId?: number;
  returnPolicyId?: number;
  processingMin?: number;
  processingMax?: number;
  imagePaths: string[];
  digitalFilePaths: string[];
}

export interface EtsyClientDeps {
  fetchImpl?: typeof fetch;
  clock?: Clock;
  minCreateIntervalMs?: number;
  getApp: () => EtsyAppCredentials;
  saveTokens: (tokens: EtsyTokens) => void;
}

export class EtsyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
    readonly rateLimited: boolean,
  ) {
    super(message);
    this.name = "EtsyApiError";
  }
}

export class EtsyClient {
  private readonly fetchImpl: typeof fetch;
  private readonly clock: Clock;
  private readonly pacer: CreatePacer;

  constructor(private readonly deps: EtsyClientDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.clock = deps.clock ?? systemClock;
    this.pacer = new CreatePacer(deps.minCreateIntervalMs ?? 1200, this.clock);
  }

  apiKeyHeader(app = this.deps.getApp()): string {
    return `${app.keystring}:${app.sharedSecret}`;
  }

  private async authorizedHeaders(extra?: HeadersInit): Promise<Headers> {
    const tokens = await this.ensureFreshTokens();
    const headers = new Headers(extra);
    headers.set("x-api-key", this.apiKeyHeader());
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
    return headers;
  }

  async ensureFreshTokens(): Promise<EtsyTokens> {
    const app = this.deps.getApp();
    if (!app.tokens) {
      throw new Error("Etsy is not connected. Complete OAuth in Setup.");
    }
    const skewMs = 60_000;
    if (app.tokens.expiresAt - skewMs > this.clock.now()) {
      return app.tokens;
    }
    const refreshed = await refreshAccessToken({
      fetchImpl: this.fetchImpl,
      keystring: app.keystring,
      refreshToken: app.tokens.refreshToken,
    });
    const next: EtsyTokens = {
      ...app.tokens,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token,
      expiresAt: this.clock.now() + refreshed.expires_in * 1000,
      scope: refreshed.scope ?? app.tokens.scope,
      userId: parseUserIdFromAccessToken(refreshed.access_token),
    };
    this.deps.saveTokens(next);
    return next;
  }

  async request<T>(
    method: string,
    pathname: string,
    init?: { body?: BodyInit; headers?: HeadersInit; form?: URLSearchParams },
  ): Promise<T> {
    const url = pathname.startsWith("http") ? pathname : `${ETSY_API_BASE}${pathname}`;
    const headers = await this.authorizedHeaders(init?.headers);
    if (init?.form && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/x-www-form-urlencoded");
    }
    const response = await this.fetchImpl(url, {
      method,
      headers,
      body: init?.form ?? init?.body,
    });
    if (response.status === 429) {
      const waitMs = retryAfterMs(response.headers);
      throw new EtsyApiError(
        `Etsy rate-limited this request. Wait about ${Math.ceil(waitMs / 1000)}s and try again.`,
        429,
        await response.text(),
        true,
      );
    }
    if (!response.ok) {
      const body = await response.text();
      throw new EtsyApiError(
        `Etsy API ${method} ${pathname} failed (${response.status}): ${body.slice(0, 400)}`,
        response.status,
        body,
        false,
      );
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async resolveShop(): Promise<{ shopId: number; shopName: string }> {
    const tokens = await this.ensureFreshTokens();
    if (tokens.shopId && tokens.shopName) {
      return { shopId: tokens.shopId, shopName: tokens.shopName };
    }
    const data = await this.request<{
      results?: Array<{ shop_id: number; shop_name: string }>;
      shop_id?: number;
      shop_name?: string;
    }>("GET", `/application/users/${tokens.userId}/shops`);
    const shop = data.results?.[0] ?? (data.shop_id ? data : undefined);
    if (!shop?.shop_id) {
      throw new Error("Could not find an Etsy shop for this account.");
    }
    const resolved = { shopId: shop.shop_id, shopName: shop.shop_name ?? "My shop" };
    this.deps.saveTokens({ ...tokens, ...resolved });
    return resolved;
  }

  async listSections(): Promise<ShopSection[]> {
    const { shopId } = await this.resolveShop();
    const data = await this.request<{
      results: Array<{ shop_section_id: number; title: string }>;
    }>("GET", `/application/shops/${shopId}/sections`);
    return (data.results ?? []).map((section) => ({
      shopSectionId: section.shop_section_id,
      title: section.title,
    }));
  }

  async getListing(listingId: number): Promise<EtsyListingSnapshot> {
    const { shopId } = await this.resolveShop();
    const listing = await this.request<{
      listing_id: number;
      title: string;
      listing_type?: string;
      type?: string;
      who_made?: string;
      when_made?: string;
      taxonomy_id?: number;
      shop_section_id?: number;
      shipping_profile_id?: number;
      readiness_state_id?: number;
      return_policy_id?: number;
      is_supply?: boolean;
      processing_min?: number;
      processing_max?: number;
    }>("GET", `/application/shops/${shopId}/listings/${listingId}`);
    const rawType = listing.listing_type ?? listing.type ?? "physical";
    return {
      listingId: listing.listing_id,
      title: listing.title,
      listingType: rawType === "download" ? "download" : "physical",
      whoMade: listing.who_made ?? "i_did",
      whenMade: listing.when_made ?? "made_to_order",
      taxonomyId: listing.taxonomy_id,
      shopSectionId: listing.shop_section_id,
      shippingProfileId: listing.shipping_profile_id,
      readinessStateId: listing.readiness_state_id,
      returnPolicyId: listing.return_policy_id,
      isSupply: Boolean(listing.is_supply),
      processingMin: listing.processing_min,
      processingMax: listing.processing_max,
    };
  }

  async searchTaxonomy(query: string, nodes: TaxonomyHit[]): Promise<TaxonomyHit[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return nodes.slice(0, 25);
    return nodes
      .filter(
        (node) =>
          node.name.toLowerCase().includes(needle) ||
          node.path.toLowerCase().includes(needle) ||
          String(node.id) === needle,
      )
      .slice(0, 25);
  }

  async fetchTaxonomyTree(): Promise<TaxonomyHit[]> {
    const data = await this.request<{
      results: Array<{ id: number; name: string; path?: string; full_path_taxonomy_ids?: number[] }>;
    }>("GET", "/application/seller-taxonomy/nodes");
    return (data.results ?? []).map((node) => ({
      id: node.id,
      name: node.name,
      path: node.path ?? node.name,
    }));
  }

  async createDraft(input: CreateDraftInput): Promise<DraftPublishResult> {
    await this.pacer.wait();
    const { shopId } = await this.resolveShop();
    const form = new URLSearchParams();
    form.set("quantity", String(input.quantity));
    form.set("title", input.title);
    form.set("description", input.description);
    form.set("price", input.price.toFixed(2));
    form.set("who_made", input.whoMade);
    form.set("when_made", input.whenMade);
    form.set("taxonomy_id", String(input.taxonomyId));
    form.set("type", input.listingType === "download" ? "download" : "physical");
    form.set("is_supply", input.isSupply ? "true" : "false");
    form.set("should_auto_renew", "false");
    if (input.tags.length) form.set("tags", input.tags.join(","));
    if (input.shopSectionId) form.set("shop_section_id", String(input.shopSectionId));
    if (input.shippingProfileId) form.set("shipping_profile_id", String(input.shippingProfileId));
    if (input.readinessStateId) form.set("readiness_state_id", String(input.readinessStateId));
    if (input.returnPolicyId) form.set("return_policy_id", String(input.returnPolicyId));
    if (input.processingMin) form.set("processing_min", String(input.processingMin));
    if (input.processingMax) form.set("processing_max", String(input.processingMax));

    const bodyObject = Object.fromEntries(form.entries());
    assertNeverActivates(bodyObject);
    if ("state" in bodyObject) {
      throw new Error("Draft create must not send a listing state field.");
    }

    const created = await this.request<{ listing_id: number; shop_id?: number; state?: string }>(
      "POST",
      `/application/shops/${shopId}/listings`,
      { form },
    );

    for (const [index, imagePath] of input.imagePaths.entries()) {
      await this.uploadListingImage(shopId, created.listing_id, imagePath, index + 1);
    }
    for (const filePath of input.digitalFilePaths) {
      await this.uploadListingFile(shopId, created.listing_id, filePath);
    }

    return {
      listingId: created.listing_id,
      shopId: created.shop_id ?? shopId,
      state: "draft",
      sellerManagerUrl: `https://www.etsy.com/your/shops/me/listing-editor/edit/${created.listing_id}`,
    };
  }

  async uploadListingImage(
    shopId: number,
    listingId: number,
    imagePath: string,
    rank: number,
  ): Promise<void> {
    const buffer = fs.readFileSync(imagePath);
    const filename = path.basename(imagePath);
    const form = new FormData();
    form.set("image", new Blob([buffer]), filename);
    form.set("rank", String(rank));
    form.set("overwrite", "true");
    await this.request(
      "POST",
      `/application/shops/${shopId}/listings/${listingId}/images`,
      { body: form },
    );
  }

  async uploadListingFile(shopId: number, listingId: number, filePath: string): Promise<void> {
    const buffer = fs.readFileSync(filePath);
    const filename = path.basename(filePath);
    const form = new FormData();
    form.set("file", new Blob([buffer]), filename);
    form.set("name", filename);
    await this.request(
      "POST",
      `/application/shops/${shopId}/listings/${listingId}/files`,
      { body: form },
    );
  }
}
