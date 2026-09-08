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

    const opened = await fetch(`${origin}/api/packs/${job.packId}/open`, { method: "POST" }).then(
      (res) => res.json(),
    );
    expect(opened.folder).toContain(job.packId);
  });
});
