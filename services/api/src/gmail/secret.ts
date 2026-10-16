import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export function sealCredential(plaintext: string, keyMaterial: string): string {
  const key = createHash("sha256").update(keyMaterial).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString("base64url");
}

export function unsealCredential(sealed: string, keyMaterial: string): string {
  const packed = Buffer.from(sealed, "base64url");
  if (packed.length < 12 + 16 + 1) {
    throw new Error("credential seal is invalid");
  }
  const key = createHash("sha256").update(keyMaterial).digest();
  const iv = packed.subarray(0, 12);
  const tag = packed.subarray(12, 28);
  const ciphertext = packed.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
