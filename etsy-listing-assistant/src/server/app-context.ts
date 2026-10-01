import { CredentialStore, type EtsyTokens } from "./credential-store.js";
import { ClaudeGenerationAdapter, type GenerationAdapter } from "./generation.js";
import { JobRunner } from "./jobs.js";
import { PackStore } from "./pack-builder.js";
import { PublishLogStore } from "./publish-log.js";
import { SettingsStore } from "./settings.js";
import { TemplateStore } from "./templates.js";
import { EtsyClient } from "./etsy-client.js";
import {
  buildAuthorizeUrl,
  createOauthState,
  createPkcePair,
  exchangeAuthorizationCode,
  parseUserIdFromAccessToken,
} from "./etsy-oauth.js";

export interface PendingOauth {
  state: string;
  verifier: string;
  redirectUri: string;
  createdAt: number;
}

export interface AppContext {
  dataRoot: string;
  publicOrigin: string;
  credentials: CredentialStore;
  packs: PackStore;
  templates: TemplateStore;
  settings: SettingsStore;
  publishLog: PublishLogStore;
  jobs: JobRunner;
  pendingOauth: PendingOauth | null;
  generationAdapter?: GenerationAdapter;
  fetchImpl: typeof fetch;
  now: () => number;
}

export function createAppContext(input: {
  dataRoot: string;
  publicOrigin: string;
  generationAdapter?: GenerationAdapter;
  fetchImpl?: typeof fetch;
}): AppContext {
  const credentials = new CredentialStore(input.dataRoot);
  const packs = new PackStore(input.dataRoot);
  const ctx: AppContext = {
    dataRoot: input.dataRoot,
    publicOrigin: input.publicOrigin,
    credentials,
    packs,
    templates: new TemplateStore(input.dataRoot),
    settings: new SettingsStore(input.dataRoot),
    publishLog: new PublishLogStore(input.dataRoot),
    jobs: undefined as unknown as JobRunner,
    pendingOauth: null,
    generationAdapter: input.generationAdapter,
    fetchImpl: input.fetchImpl ?? fetch,
    now: () => Date.now(),
  };
  ctx.jobs = new JobRunner(input.dataRoot, packs, () => resolveGenerationAdapter(ctx), {
    timeoutMs: Number(process.env.ETSY_ASSISTANT_GENERATION_TIMEOUT_MS || 120_000),
  });
  return ctx;
}

export function resolveGenerationAdapter(ctx: AppContext): GenerationAdapter {
  if (ctx.generationAdapter) return ctx.generationAdapter;
  const apiKey = ctx.credentials.read().claude?.apiKey;
  if (!apiKey) {
    throw new Error("Add your Claude API key in Setup before generating.");
  }
  return new ClaudeGenerationAdapter(apiKey);
}

export function createEtsyClient(ctx: AppContext): EtsyClient {
  return new EtsyClient({
    fetchImpl: ctx.fetchImpl,
    getApp: () => {
      const etsy = ctx.credentials.read().etsy;
      if (!etsy) throw new Error("Save your Etsy app key and shared secret in Setup first.");
      return etsy;
    },
    saveTokens: (tokens: EtsyTokens) => {
      ctx.credentials.update((vault) => {
        if (!vault.etsy) return vault;
        return { ...vault, etsy: { ...vault.etsy, tokens } };
      });
    },
  });
}

export function beginOauth(ctx: AppContext, redirectUri: string): { authorizeUrl: string; redirectUri: string } {
  const vault = ctx.credentials.read();
  if (!vault.etsy?.keystring) {
    throw new Error("Enter your Etsy keystring and shared secret first.");
  }
  const pkce = createPkcePair();
  const state = createOauthState();
  ctx.pendingOauth = {
    state,
    verifier: pkce.verifier,
    redirectUri,
    createdAt: ctx.now(),
  };
  ctx.credentials.update((current) => {
    if (!current.etsy) return current;
    return { ...current, etsy: { ...current.etsy, redirectUri } };
  });
  return {
    authorizeUrl: buildAuthorizeUrl({
      keystring: vault.etsy.keystring,
      redirectUri,
      state,
      challenge: pkce.challenge,
    }),
    redirectUri,
  };
}

export async function finishOauth(ctx: AppContext, code: string, state: string): Promise<void> {
  const pending = ctx.pendingOauth;
  if (!pending || pending.state !== state) {
    throw new Error("OAuth state mismatch. Start Connect to Etsy again.");
  }
  const vault = ctx.credentials.read();
  if (!vault.etsy) throw new Error("Etsy app credentials are missing.");
  const tokens = await exchangeAuthorizationCode({
    fetchImpl: ctx.fetchImpl,
    keystring: vault.etsy.keystring,
    redirectUri: pending.redirectUri,
    code,
    verifier: pending.verifier,
  });
  const userId = parseUserIdFromAccessToken(tokens.access_token);
  ctx.credentials.update((current) => ({
    ...current,
    etsy: {
      ...current.etsy!,
      tokens: {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: ctx.now() + tokens.expires_in * 1000,
        scope: tokens.scope ?? "",
        userId,
      },
    },
  }));
  ctx.pendingOauth = null;
  const client = createEtsyClient(ctx);
  await client.resolveShop();
}

export function defaultRedirectUri(publicOrigin: string): string {
  return `${publicOrigin.replace(/\/$/, "")}/api/etsy/oauth/callback`;
}
