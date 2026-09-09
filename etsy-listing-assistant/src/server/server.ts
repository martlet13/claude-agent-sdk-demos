import "dotenv/config";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppContext } from "./app-context.js";
import { createHttpApp } from "./http-app.js";
import { defaultDataRoot } from "./paths.js";
import { briefsFromTheme } from "./promo-art.js";
import type { GenerationAdapter } from "./generation.js";
import { openBrowserWindow, shouldAutoOpen } from "./open-browser.js";

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
      createdAt: new Date().toISOString(),
    });
  }
}

const app = createHttpApp(ctx);

const distDir = path.join(__dirname, "../../dist");
const servesUi = fs.existsSync(distDir);
if (servesUi) {
  app.use(express.static(distDir));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/media")) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, "index.html"));
  });
} else {
  // No built UI: answer with instructions instead of a bare 404 so a seller who
  // ran `npm start` without `npm run build` sees what to do next.
  app.get("/", (_req, res) => {
    res
      .status(200)
      .type("html")
      .send(`<!doctype html>
<html><body style="font-family: Georgia, serif; padding: 48px; background: #f6efe4; color: #1c1917; max-width: 640px;">
  <h1>Etsy Listing Assistant</h1>
  <p>The local API is running on ${publicOrigin}, but the UI has not been built yet.</p>
  <p>In the <code>etsy-listing-assistant</code> folder run one of:</p>
  <pre style="background:#fff;padding:12px;border-radius:8px;">npm run dev        # hot-reload UI on http://127.0.0.1:5173
npm run build &amp;&amp; npm start   # single process on ${publicOrigin}</pre>
  <p>Both commands open the UI in a new browser window on this computer.</p>
</body></html>`);
  });
}

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Etsy Listing Assistant listening on ${publicOrigin}`);
  console.log(`Local data directory: ${dataRoot}`);
  if (offline) console.log("Offline generation is on (no Claude API calls).");
  if (mockEtsy) console.log("Etsy HTTP is mocked locally — drafts are not created on a real shop.");
  const uiUrl = process.env.ETSY_ASSISTANT_UI_URL || (servesUi ? publicOrigin : "");
  if (uiUrl && shouldAutoOpen()) {
    const launch = openBrowserWindow(uiUrl);
    console.log(
      `Opened ${uiUrl} in ${launch.newWindow ? "a new browser window" : "your default browser"}. Set ETSY_ASSISTANT_NO_OPEN=1 to skip.`,
    );
  } else if (uiUrl) {
    console.log(`Open ${uiUrl} in your browser.`);
  } else {
    console.log("UI is not built. Run `npm run dev` for hot reload or `npm run build` before `npm start`.");
  }
});
