import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decryptJson, encryptJson, loadOrCreateMasterKey } from "../src/server/crypto-store.js";
import { CredentialStore } from "../src/server/credential-store.js";
import { tempRoot } from "./helpers.js";

describe("credential vault", () => {
  it("encrypts and decrypts JSON", () => {
    const key = Buffer.alloc(32, 7);
    const payload = encryptJson(key, { hello: "world" });
    expect(payload.includes(Buffer.from("hello"))).toBe(false);
    expect(decryptJson(key, payload)).toEqual({ hello: "world" });
  });

  it("persists a master key and never writes plaintext secrets", () => {
    const root = tempRoot();
    const store = new CredentialStore(root);
    store.update(() => ({
      claude: { apiKey: "local-claude-test-key" },
      etsy: {
        keystring: "keystring",
        sharedSecret: "local-shared-secret",
        redirectUri: "http://127.0.0.1:8787/api/etsy/oauth/callback",
      },
    }));
    const vaultBytes = fs.readFileSync(path.join(root, "credentials.enc"));
    expect(vaultBytes.toString("utf8")).not.toContain("local-claude-test-key");
    expect(vaultBytes.toString("utf8")).not.toContain("local-shared-secret");
    expect(store.read().claude?.apiKey).toBe("local-claude-test-key");
    expect(store.publicStatus()).toEqual(
      expect.objectContaining({ claudeConfigured: true, etsyConfigured: false, etsyAppSaved: true }),
    );
    const sameKey = loadOrCreateMasterKey(path.join(root, ".master.key"));
    expect(sameKey).toHaveLength(32);
  });
});
