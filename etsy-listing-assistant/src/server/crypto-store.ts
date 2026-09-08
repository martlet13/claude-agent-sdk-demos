import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./paths.js";

const ALGO = "aes-256-gcm";

export function loadOrCreateMasterKey(keyFile: string): Buffer {
  if (fs.existsSync(keyFile)) {
    const existing = fs.readFileSync(keyFile);
    if (existing.length !== 32) {
      throw new Error("Credential master key file is corrupted.");
    }
    return existing;
  }
  ensureDir(path.dirname(keyFile));
  const key = crypto.randomBytes(32);
  fs.writeFileSync(keyFile, key, { mode: 0o600 });
  return key;
}

export function encryptJson(key: Buffer, value: unknown): Buffer {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]);
}

export function decryptJson<T>(key: Buffer, payload: Buffer): T {
  if (payload.length < 28) {
    throw new Error("Encrypted vault is too short.");
  }
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const ciphertext = payload.subarray(28);
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}
