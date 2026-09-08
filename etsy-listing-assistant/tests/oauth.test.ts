import { describe, expect, it } from "vitest";
import {
  buildAuthorizeUrl,
  createPkcePair,
  parseUserIdFromAccessToken,
} from "../src/server/etsy-oauth.js";
import { beginOauth, finishOauth } from "../src/server/app-context.js";
import { testContext } from "./helpers.js";

describe("Etsy OAuth helpers", () => {
  it("builds a PKCE authorize URL with draft-related scopes", () => {
    const pkce = createPkcePair();
    expect(pkce.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(pkce.challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const url = buildAuthorizeUrl({
      keystring: "abc123",
      redirectUri: "http://127.0.0.1:8787/api/etsy/oauth/callback",
      state: "state-1",
      challenge: pkce.challenge,
    });
    expect(url).toContain("https://www.etsy.com/oauth/connect");
    expect(url).toContain("listings_w");
    expect(url).toContain("shops_r");
    expect(url).toContain("code_challenge_method=S256");
  });

  it("reads the user id prefix from an access token", () => {
    expect(parseUserIdFromAccessToken("998877.tokenvalue")).toBe(998877);
    expect(() => parseUserIdFromAccessToken("not-a-token")).toThrow();
  });

  it("exchanges an authorization code and stores tokens locally", async () => {
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/oauth/token")) {
        const body = String(init?.body);
        expect(body).toContain("grant_type=authorization_code");
        expect(body).toContain("code=auth-code");
        return new Response(
          JSON.stringify({
            access_token: "4242.access",
            token_type: "Bearer",
            expires_in: 3600,
            refresh_token: "4242.refresh",
            scope: "listings_r listings_w shops_r",
          }),
          { status: 200 },
        );
      }
      if (url.includes("/users/4242/shops")) {
        return new Response(
          JSON.stringify({ results: [{ shop_id: 77, shop_name: "Harbor Prints" }] }),
          { status: 200 },
        );
      }
      return new Response("unexpected", { status: 500 });
    };
    const { ctx } = testContext({ fetchImpl });
    ctx.credentials.update(() => ({
      etsy: {
        keystring: "key",
        sharedSecret: "secret",
        redirectUri: "http://127.0.0.1:8787/api/etsy/oauth/callback",
      },
    }));
    const started = beginOauth(ctx, "http://127.0.0.1:8787/api/etsy/oauth/callback");
    expect(started.authorizeUrl).toContain("client_id=key");
    const state = ctx.pendingOauth!.state;
    await finishOauth(ctx, "auth-code", state);
    const tokens = ctx.credentials.read().etsy?.tokens;
    expect(tokens?.userId).toBe(4242);
    expect(tokens?.shopName).toBe("Harbor Prints");
    expect(ctx.credentials.publicStatus().etsyConfigured).toBe(true);
  });
});
