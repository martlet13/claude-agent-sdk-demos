import fs from "node:fs";
import { decryptJson, encryptJson, loadOrCreateMasterKey } from "./crypto-store.js";
import { appPaths, ensureDir } from "./paths.js";

export interface ClaudeCredentials {
  apiKey: string;
}

export interface EtsyTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  scope: string;
  userId: number;
  shopId?: number;
  shopName?: string;
}

export interface EtsyAppCredentials {
  keystring: string;
  sharedSecret: string;
  redirectUri: string;
  tokens?: EtsyTokens;
}

export interface VaultData {
  claude?: ClaudeCredentials;
  etsy?: EtsyAppCredentials;
}

export class CredentialStore {
  private readonly paths: ReturnType<typeof appPaths>;
  private readonly key: Buffer;

  constructor(dataRoot: string) {
    this.paths = appPaths(dataRoot);
    ensureDir(this.paths.root);
    this.key = loadOrCreateMasterKey(this.paths.keyFile);
  }

  read(): VaultData {
    if (!fs.existsSync(this.paths.vaultFile)) return {};
    return decryptJson<VaultData>(this.key, fs.readFileSync(this.paths.vaultFile));
  }

  write(data: VaultData): void {
    const payload = encryptJson(this.key, data);
    fs.writeFileSync(this.paths.vaultFile, payload, { mode: 0o600 });
  }

  update(mutator: (current: VaultData) => VaultData): VaultData {
    const next = mutator(this.read());
    this.write(next);
    return next;
  }

  publicStatus() {
    const vault = this.read();
    return {
      claudeConfigured: Boolean(vault.claude?.apiKey),
      etsyConfigured: Boolean(vault.etsy?.keystring && vault.etsy.tokens?.accessToken),
      etsyAppSaved: Boolean(vault.etsy?.keystring && vault.etsy.sharedSecret),
      etsyShopName: vault.etsy?.tokens?.shopName,
      etsyShopId: vault.etsy?.tokens?.shopId,
      redirectUri: vault.etsy?.redirectUri,
    };
  }
}
