import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppContext } from "./app-context.js";
import { createHttpApp } from "./http-app.js";
import { defaultDataRoot } from "./paths.js";
import { maybeOpenBrowser } from "./open-browser.js";
import { briefsFromTheme } from "./promo-art.js";
import type { GenerationAdapter } from "./generation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 8787);
const publicOrigin = process.env.PUBLIC_ORIGIN || `http://127.0.0.1:${PORT}`;
const dataRoot = defaultDataRoot(process.env.ETSY_ASSISTANT_HOME);
const offline = process.env.ETSY_ASSISTANT_OFFLINE === "1";
const mockEtsy = process.env.ETSY_ASSISTANT_MOCK_ETSY === "1";

const offlineAdapter: GenerationAdapter = {
  async generateCopy(request) {
    return {
      copy: {
        title: `${request.theme} printable wall art`.slice(0, 140),
        description: `A listing about ${request.theme}. Review this copy, then create a draft on your shop.`,
        tags: ["wall art", "print", "home decor", "digital"],
        materials: ["paper", "ink"],
      },
      briefs: briefsFromTheme(request.theme, request.ideaCount),
      rawText: "{}",
    };
  },
};

const mockEtsyFetch: typeof fetch = async (input, init) => {
  const url = String(input);
  const method = init?.method ?? "GET";
  if (url.endsWith("/listings") && method === "POST") {
    const body = String(init?.body ?? "");
    if (body.includes("state=active") || /(?:^|&)state=active(?:&|$)/.test(body)) {
      return new Response("refusing active listings in mock mode", { status: 400 });
    }
    return new Response(JSON.stringify({ listing_id: 424242, shop_id: 7, state: "draft" }), {
      status: 200,
    });
  }
  if (url.includes("/inventory") && method === "PUT") {
    return new Response(JSON.stringify({ products: [] }), { status: 200 });
  }
  if (url.includes("/inventory")) {
    return new Response(
      JSON.stringify({
        products: [
          {
            sku: "",
            property_values: [{ property_id: 200, property_name: "Color", values: ["Sage"] }],
            offerings: [{ price: { amount: 2400, divisor: 100 }, quantity: 1, is_enabled: true }],
          },
          {
            sku: "",
            property_values: [{ property_id: 200, property_name: "Color", values: ["Terracotta"] }],
            offerings: [{ price: { amount: 2400, divisor: 100 }, quantity: 1, is_enabled: true }],
          },
        ],
        price_on_property: [],
        quantity_on_property: [],
        sku_on_property: [],
      }),
      { status: 200 },
    );
  }
  if (url.includes("/images") || url.includes("/files")) {
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  if (url.includes("/sections")) {
    return new Response(JSON.stringify({ results: [{ shop_section_id: 1, title: "Prints" }] }), {
      status: 200,
    });
  }
  if (url.includes("/seller-taxonomy")) {
    return new Response(
      JSON.stringify({ results: [{ id: 2078, name: "Prints", path: "Art & Collectibles / Prints" }] }),
      { status: 200 },
    );
  }
  if (url.includes("/listings/")) {
    return new Response(
      JSON.stringify({
        listing_id: 111,
        title: "Sample shop listing",
        type: "physical",
        who_made: "i_did",
        when_made: "made_to_order",
        taxonomy_id: 2078,
        shipping_profile_id: 9,
      }),
      { status: 200 },
    );
  }
  return new Response(`not mocked: ${method} ${url}`, { status: 404 });
};

const ctx = createAppContext({
  dataRoot,
  publicOrigin,
  generationAdapter: offline ? offlineAdapter : undefined,
  fetchImpl: mockEtsy ? mockEtsyFetch : undefined,
});

if (offline && mockEtsy && !ctx.credentials.publicStatus().etsyConfigured) {
  ctx.credentials.update(() => ({
    claude: { apiKey: "offline-preview-key" },
    etsy: {
      keystring: "preview-keystring",
      sharedSecret: "preview-secret",
      redirectUri: `${publicOrigin}/api/etsy/oauth/callback`,
      tokens: {
        accessToken: "7.preview",
        refreshToken: "7.refresh",
        expiresAt: Date.now() + 86_400_000,
        scope: "listings_r listings_w shops_r",
        userId: 7,
        shopId: 7,
        shopName: "Preview Shop",
      },
    },
  }));
  if (ctx.templates.list().length === 0) {
    ctx.templates.add({
      id: "preview-prints",
      name: "Preview prints",
      sourceListingId: 111,
      listingType: "physical",
      whoMade: "i_did",
      whenMade: "made_to_order",
      taxonomyId: 2078,
      shippingProfileId: 9,
      isSupply: false,
      inventory: {
        products: [
          {
            propertyValues: [{ propertyId: 200, propertyName: "Color", values: ["Sage"] }],
            offerings: [{ price: 24, quantity: 1, isEnabled: true }],
          },
          {
            propertyValues: [{ propertyId: 200, propertyName: "Color", values: ["Terracotta"] }],
            offerings: [{ price: 24, quantity: 1, isEnabled: true }],
          },
        ],
        priceOnProperty: [],
        quantityOnProperty: [],
        skuOnProperty: [],
      },
      createdAt: new Date().toISOString(),
    });
  }
}

const app = createHttpApp(ctx);

const distDir = path.join(__dirname, "../../dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/media")) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, "index.html"));
  });
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Etsy Listing Assistant listening on ${publicOrigin}`);
  console.log(`Local data directory: ${dataRoot}`);
  if (offline) console.log("Offline generation is on (no Claude API calls).");
  if (mockEtsy) console.log("Etsy HTTP is mocked locally — drafts are not created on a real shop.");
  if (fs.existsSync(distDir)) {
    maybeOpenBrowser(publicOrigin);
  }
});
