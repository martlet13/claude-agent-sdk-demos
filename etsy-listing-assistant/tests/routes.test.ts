import { afterEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createHttpApp } from "../src/server/http-app.js";
import { testContext } from "./helpers.js";
import type { EtsyTokens } from "../src/server/credential-store.js";

async function listen(ctx: ReturnType<typeof testContext>["ctx"]): Promise<{
  server: Server;
  origin: string;
}> {
  const app = createHttpApp(ctx);
  const server = await new Promise<Server>((resolve) => {
    const started = app.listen(0, "127.0.0.1", () => resolve(started));
  });
  const { port } = server.address() as AddressInfo;
  return { server, origin: `http://127.0.0.1:${port}` };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))));
});

describe("HTTP routes", () => {
  it("reports incomplete setup until Claude, Etsy, and a template exist", async () => {
    const { ctx } = testContext();
    const { server, origin } = await listen(ctx);
    servers.push(server);
    const status = await fetch(`${origin}/api/status`).then((res) => res.json());
    expect(status.setupComplete).toBe(false);
    expect(status.presets).toHaveLength(3);
    expect(status.risks.etsy).toMatch(/drafts only/i);
  });

  it("runs generate → pack → draft publish against a mocked Etsy API", async () => {
    const postedBodies: string[] = [];
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/listings") && init?.method === "POST") {
        postedBodies.push(String(init.body));
        return new Response(JSON.stringify({ listing_id: 9001, shop_id: 44 }), { status: 200 });
      }
      if (url.includes("/images")) {
        return new Response(JSON.stringify({ listing_image_id: 1 }), { status: 200 });
      }
      return new Response("unexpected " + url, { status: 404 });
    };
    const { ctx } = testContext({ fetchImpl });
    ctx.credentials.update(() => ({
      claude: { apiKey: "local-claude-test-key" },
      etsy: {
        keystring: "k",
        sharedSecret: "s",
        redirectUri: "http://127.0.0.1:8787/api/etsy/oauth/callback",
        tokens: {
          accessToken: "44.access",
          refreshToken: "44.refresh",
          expiresAt: Date.now() + 3_600_000,
          scope: "listings_w shops_r",
          userId: 44,
          shopId: 44,
          shopName: "Demo Shop",
        } satisfies EtsyTokens,
      },
    }));
    ctx.templates.add({
      id: "tmpl-1",
      name: "Prints",
      sourceListingId: 111,
      listingType: "physical",
      whoMade: "i_did",
      whenMade: "made_to_order",
      taxonomyId: 222,
      shippingProfileId: 333,
      isSupply: false,
      createdAt: new Date().toISOString(),
    });

    const { server, origin } = await listen(ctx);
    servers.push(server);

    const started = await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: "terracotta sun over dunes",
        ideaCount: 2,
        aspectRatio: "4:5",
        presetId: "wall-art",
      }),
    }).then((res) => res.json());

    let job = started;
    for (let i = 0; i < 40 && job.status !== "complete"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      job = await fetch(`${origin}/api/jobs/${started.id}`).then((res) => res.json());
    }
    expect(job.status).toBe("complete");

    const published = await fetch(`${origin}/api/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: job.packId,
        templateId: "tmpl-1",
        taxonomyId: 222,
        price: 28,
        quantity: 1,
        listingType: "physical",
      }),
    }).then(async (res) => ({ status: res.status, body: await res.json() }));

    expect(published.status).toBe(200);
    expect(published.body).toMatchObject({ listingId: 9001, state: "draft" });
    expect(published.body.sellerManagerUrl).toContain("9001");
    expect(postedBodies[0]).not.toContain("active");
    expect(postedBodies[0]).toContain("should_auto_renew=false");
    expect(published.body.imagesUploaded).toBeGreaterThan(0);
    expect(published.body.warnings).toEqual([]);

    const log = await fetch(`${origin}/api/publish-log`).then((res) => res.json());
    expect(log[0]).toMatchObject({ listingId: 9001, state: "draft", packId: job.packId });

    const opened = await fetch(`${origin}/api/packs/${job.packId}/open`, { method: "POST" }).then(
      (res) => res.json(),
    );
    expect(opened.folder).toContain(job.packId);
  });

  it("lets sellers generate with only a Claude key, then search cached taxonomy without a live token", async () => {
    const { ctx } = testContext();
    ctx.credentials.update(() => ({
      claude: { apiKey: "local-claude-test-key" },
    }));
    ctx.settings.saveTaxonomy([
      { id: 2078, name: "Prints", path: "Art & Collectibles / Prints" },
    ]);
    const { server, origin } = await listen(ctx);
    servers.push(server);

    const started = await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: "sage botanicals",
        ideaCount: 1,
        aspectRatio: "1:1",
        presetId: "wall-art",
      }),
    }).then((res) => res.json());
    expect(started.status === "queued" || started.status === "running" || started.status === "complete").toBe(true);

    const hits = await fetch(`${origin}/api/etsy/taxonomy?q=prints`).then((res) => res.json());
    expect(hits).toEqual([{ id: 2078, name: "Prints", path: "Art & Collectibles / Prints" }]);
  });

  it("clears Etsy tokens on disconnect while keeping the seller’s app credentials", async () => {
    const { ctx } = testContext();
    ctx.credentials.update(() => ({
      etsy: {
        keystring: "k",
        sharedSecret: "s",
        redirectUri: "http://127.0.0.1:8787/api/etsy/oauth/callback",
        tokens: {
          accessToken: "44.access",
          refreshToken: "44.refresh",
          expiresAt: Date.now() + 3_600_000,
          scope: "listings_w shops_r",
          userId: 44,
          shopId: 44,
          shopName: "Demo Shop",
        },
      },
    }));
    const { server, origin } = await listen(ctx);
    servers.push(server);
    const before = await fetch(`${origin}/api/status`).then((res) => res.json());
    expect(before.etsyConfigured).toBe(true);
    expect(before.etsyAppSaved).toBe(true);
    await fetch(`${origin}/api/setup/etsy-disconnect`, { method: "POST" });
    const after = await fetch(`${origin}/api/status`).then((res) => res.json());
    expect(after.etsyConfigured).toBe(false);
    expect(after.etsyAppSaved).toBe(true);
  });

  it("clones variations from a shop listing, duplicates a pack, and records failed publishes", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.includes("/inventory") && method === "GET") {
        return new Response(
          JSON.stringify({
            products: [
              {
                property_values: [{ property_id: 200, property_name: "Color", values: ["Sage"] }],
                offerings: [{ price: { amount: 1800, divisor: 100 }, quantity: 1, is_enabled: true }],
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.includes("/listings/") && method === "GET") {
        return new Response(
          JSON.stringify({
            listing_id: 111,
            title: "Sage print",
            type: "physical",
            who_made: "i_did",
            when_made: "made_to_order",
            taxonomy_id: 222,
            shipping_profile_id: 333,
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/listings") && method === "POST") {
        return new Response("boom", { status: 500 });
      }
      return new Response("unexpected " + url, { status: 404 });
    };
    const { ctx } = testContext({ fetchImpl });
    ctx.credentials.update(() => ({
      claude: { apiKey: "local-claude-test-key" },
      etsy: {
        keystring: "k",
        sharedSecret: "s",
        redirectUri: "http://127.0.0.1:8787/api/etsy/oauth/callback",
        tokens: {
          accessToken: "44.access",
          refreshToken: "44.refresh",
          expiresAt: Date.now() + 3_600_000,
          scope: "listings_w shops_r",
          userId: 44,
          shopId: 44,
          shopName: "Demo Shop",
        },
      },
    }));
    const { server, origin } = await listen(ctx);
    servers.push(server);

    const cloned = await fetch(`${origin}/api/templates`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId: 111, name: "Sage template" }),
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
    expect(cloned.status).toBe(201);
    expect(cloned.body.inventory.products[0].propertyValues[0].values).toEqual(["Sage"]);

    const started = await fetch(`${origin}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        theme: "sage botanicals",
        ideaCount: 1,
        aspectRatio: "1:1",
        presetId: "wall-art",
      }),
    }).then((res) => res.json());
    let job = started;
    for (let i = 0; i < 40 && job.status !== "complete"; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
      job = await fetch(`${origin}/api/jobs/${started.id}`).then((res) => res.json());
    }
    expect(job.status).toBe("complete");

    const duplicated = await fetch(`${origin}/api/packs/${job.packId}/duplicate`, { method: "POST" }).then(
      (res) => res.json(),
    );
    expect(duplicated.id).not.toBe(job.packId);

    const published = await fetch(`${origin}/api/publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: duplicated.id,
        templateId: cloned.body.id,
        taxonomyId: 222,
        price: 28,
        quantity: 1,
        listingType: "physical",
        applyVariations: true,
      }),
    }).then(async (res) => ({ status: res.status, body: await res.json() }));
    expect(published.status).toBe(400);
    expect(published.body.error).toMatch(/failed/i);

    const log = await fetch(`${origin}/api/publish-log`).then((res) => res.json());
    expect(log[0].state).toBe("failed");
    expect(log[0].packId).toBe(duplicated.id);
  });
});
