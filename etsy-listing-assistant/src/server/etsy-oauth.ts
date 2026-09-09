import crypto from "node:crypto";
import { ETSY_OAUTH_SCOPES } from "../shared/etsy-limits.js";

export const ETSY_AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
export const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

export interface PkcePair {
  verifier: string;
  challenge: string;
}

export function base64Url(buffer: Buffer): string {
  return buffer
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function createPkcePair(): PkcePair {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

export function createOauthState(): string {
  return base64Url(crypto.randomBytes(24));
}

export function buildAuthorizeUrl(input: {
  keystring: string;
  redirectUri: string;
  state: string;
  challenge: string;
  scopes?: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: input.keystring,
    redirect_uri: input.redirectUri,
    scope: input.scopes ?? ETSY_OAUTH_SCOPES,
    state: input.state,
    code_challenge: input.challenge,
    code_challenge_method: "S256",
  });
  return `${ETSY_AUTHORIZE_URL}?${params.toString()}`;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope?: string;
}

export function parseUserIdFromAccessToken(accessToken: string): number {
  const prefix = accessToken.split(".")[0];
  const userId = Number(prefix);
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error("Etsy access token did not include a numeric user id prefix.");
  }
  return userId;
}

export async function exchangeAuthorizationCode(input: {
  fetchImpl?: typeof fetch;
  keystring: string;
  redirectUri: string;
  code: string;
  verifier: string;
}): Promise<TokenResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: input.keystring,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.verifier,
  });
  const response = await fetchImpl(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Etsy token exchange failed (${response.status}): ${await safeText(response)}`);
  }
  return (await response.json()) as TokenResponse;
}

export async function refreshAccessToken(input: {
  fetchImpl?: typeof fetch;
  keystring: string;
  refreshToken: string;
}): Promise<TokenResponse> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: input.keystring,
    refresh_token: input.refreshToken,
  });
  const response = await fetchImpl(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`Etsy token refresh failed (${response.status}): ${await safeText(response)}`);
  }
  return (await response.json()) as TokenResponse;
}

async function safeText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}
