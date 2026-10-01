import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EtsyClient, type CreateDraftInput } from "../src/server/etsy-client.js";
import type { EtsyAppCredentials, EtsyTokens } from "../src/server/credential-store.js";
import { tempRoot } from "./helpers.js";

function tokens(overrides: Partial<EtsyTokens> = {}): EtsyTokens {
  return {
    accessToken: "11.access",
    refreshToken: "11.refresh",
    expiresAt: Date.now() + 60 * 60_000,
    scope: "listings_w shops_r",
    userId: 11,
    shopId: 99,
    shopName: "Local Shop",
    ...overrides,
  };
}

function draftInput(root: string): CreateDraftInput {
  const image = path.join(root, "promo.svg");
  fs.writeFileSync(image, "<svg xmlns='http://www.w3.org/2000/svg'></svg>");
  return {
    title: "Sage Print",
    description: "A quiet botanical print.",
    tags: ["wall art", "sage"],
    price: 24,
    quantity: 1,
    taxonomyId: 891,
    listingType: "physical",
    whoMade: "i_did",
    whenMade: "made_to_order",
    isSupply: false,
    shopSectionId: 3,
    shippingProfileId: 555,
    imagePaths: [image],
    digitalFilePaths: [],
  };
}

describe("EtsyClient.createDraft", () => {
  it("creates a draft without sending state=active and uploads images", async () => {
    const posted: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      posted.push(`${method} ${url}`);
      if (method === "POST" && url.endsWith("/listings")) {
        const headers = new Headers(init?.headers);
        expect(headers.get("x-api-key")).toBe("k");
        expect(headers.get("authorization")).toMatch(/Bearer 11\.access/i);
        const body = String(init?.body);
        expect(body).not.toContain("state=");
        expect(body).not.toContain("active");
        expect(body).toContain("title=Sage+Print");
        expect(body).toContain("type=physical");
        expect(body).toContain("should_auto_renew=false");
        return new Response(JSON.stringify({ listing_id: 1234, shop_id: 99 }), { status: 200 });
      }
      if (url.includes("/images")) {
        expect(init?.body).toBeInstanceOf(FormData);
        return new Response(JSON.stringify({ listing_image_id: 1 }), { status: 200 });
      }
      return new Response("nope", { status: 404 });
    };

    let saved: EtsyTokens | undefined;
    const app: EtsyAppCredentials = {
      keystring: "k",
      sharedSecret: "s",
      redirectUri: "http://127.0.0.1/callback",
      tokens: tokens(),
    };
    const client = new EtsyClient({
      fetchImpl,
      getApp: () => app,
      saveTokens: (next) => {
        saved = next;
        app.tokens = next;
      },
      minCreateIntervalMs: 0,
    });
    const result = await client.createDraft(draftInput(tempRoot()));
    expect(result).toMatchObject({ listingId: 1234, shopId: 99, state: "draft" });
    expect(result.sellerManagerUrl).toContain("1234");
    expect(result.imagesUploaded).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(posted.some((line) => line.includes("/images"))).toBe(true);
    expect(saved).toBeUndefined();
  });

  it("keeps the draft listing id when a later image upload fails", async () => {
    const app: EtsyAppCredentials = {
      keystring: "k",
      sharedSecret: "s",
      redirectUri: "http://127.0.0.1/callback",
      tokens: tokens(),
    };
    const client = new EtsyClient({
      fetchImpl: async (input, init) => {
        const url = String(input);
        if ((init?.method ?? "GET") === "POST" && url.endsWith("/listings")) {
          return new Response(JSON.stringify({ listing_id: 77, shop_id: 99 }), { status: 200 });
        }
        if (url.includes("/images")) {
          return new Response("storage full", { status: 500 });
        }
        return new Response("nope", { status: 404 });
      },
      getApp: () => app,
      saveTokens: () => undefined,
      minCreateIntervalMs: 0,
    });
    const result = await client.createDraft(draftInput(tempRoot()));
    expect(result.listingId).toBe(77);
    expect(result.state).toBe("draft");
    expect(result.imagesUploaded).toBe(0);
    expect(result.warnings[0]).toMatch(/did not upload/i);
  });

  it("copies cloned variations onto the new draft and never sends state=active", async () => {
    const bodies: string[] = [];
    const app: EtsyAppCredentials = {
      keystring: "k",
      sharedSecret: "s",
      redirectUri: "http://127.0.0.1/callback",
      tokens: tokens(),
    };
    const client = new EtsyClient({
      fetchImpl: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "POST" && url.endsWith("/listings")) {
          bodies.push(String(init?.body));
          return new Response(JSON.stringify({ listing_id: 88, shop_id: 99 }), { status: 200 });
        }
        if (url.includes("/images")) {
          return new Response(JSON.stringify({ listing_image_id: 1 }), { status: 200 });
        }
        if (method === "PUT" && url.includes("/inventory")) {
          bodies.push(String(init?.body));
          expect(new Headers(init?.headers).get("content-type")).toMatch(/json/i);
          return new Response(JSON.stringify({ products: [] }), { status: 200 });
        }
        return new Response("nope", { status: 404 });
      },
      getApp: () => app,
      saveTokens: () => undefined,
      minCreateIntervalMs: 0,
    });
    const input = {
      ...draftInput(tempRoot()),
      materials: ["paper", "ink"],
      applyVariations: true,
      inventory: {
        products: [
          {
            propertyValues: [{ propertyId: 200, propertyName: "Color", values: ["Sage"] }],
            offerings: [{ price: 18, quantity: 1, isEnabled: true }],
          },
        ],
        priceOnProperty: [],
        quantityOnProperty: [],
        skuOnProperty: [],
      },
    };
    const result = await client.createDraft(input);
    expect(result.variationsApplied).toBe(true);
    expect(bodies[0]).toContain("materials=paper%2Cink");
    expect(bodies[0]).not.toContain("state=");
    expect(bodies[1]).toContain('"property_name":"Color"');
    expect(bodies[1]).toContain('"price":24');
  });

  it("refreshes expired tokens before calling the API", async () => {
    const app: EtsyAppCredentials = {
      keystring: "k",
      sharedSecret: "s",
      redirectUri: "http://127.0.0.1/callback",
      tokens: tokens({ expiresAt: Date.now() - 1000 }),
    };
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        return new Response(
          JSON.stringify({
            access_token: "11.fresh",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "11.newrefresh",
            scope: "listings_w",
          }),
          { status: 200 },
        );
      }
      if (url.includes("/sections")) {
        return new Response(JSON.stringify({ results: [{ shop_section_id: 8, title: "Prints" }] }), {
          status: 200,
        });
      }
      return new Response("nope", { status: 404 });
    };
    const client = new EtsyClient({
      fetchImpl,
      getApp: () => app,
      saveTokens: (next) => {
        app.tokens = next;
      },
    });
    const sections = await client.listSections();
    expect(sections).toEqual([{ shopSectionId: 8, title: "Prints" }]);
    expect(app.tokens?.accessToken).toBe("11.fresh");
  });

  it("surfaces rate-limit errors clearly", async () => {
    const app: EtsyAppCredentials = {
      keystring: "k",
      sharedSecret: "s",
      redirectUri: "http://127.0.0.1/callback",
      tokens: tokens(),
    };
    const client = new EtsyClient({
      fetchImpl: async () =>
        new Response("slow down", { status: 429, headers: { "retry-after": "3" } }),
      getApp: () => app,
      saveTokens: () => undefined,
    });
    await expect(client.listSections()).rejects.toThrow(/rate-limited/i);
  });
});
