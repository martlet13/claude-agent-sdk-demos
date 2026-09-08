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
    expect(posted.some((line) => line.includes("/images"))).toBe(true);
    expect(saved).toBeUndefined();
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
