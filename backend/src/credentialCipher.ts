import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import type { EncryptionKeyRing } from "./config.js";

const version = "v1";
const algorithm = "aes-256-gcm";

function encode(value: Buffer): string {
  return value.toString("base64url");
}

function decode(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export class CredentialCipher {
  constructor(private readonly ring: EncryptionKeyRing) {}

  encrypt(plaintext: string, associatedData: string): string {
    const key = this.ring.keys.get(this.ring.activeId);
    if (!key) throw new Error("The active encryption key is unavailable");
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv(algorithm, key, initializationVector);
    cipher.setAAD(Buffer.from(associatedData, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authenticationTag = cipher.getAuthTag();
    return [version, this.ring.activeId, encode(initializationVector), encode(authenticationTag), encode(ciphertext)].join(".");
  }

  decrypt(serialized: string, associatedData: string): string {
    const [storedVersion, keyId, initializationVector, authenticationTag, ciphertext, ...extra] = serialized.split(".");
    if (storedVersion !== version || !keyId || !initializationVector || !authenticationTag || !ciphertext || extra.length > 0) {
      throw new Error("Stored credential has an unsupported format");
    }
    const key = this.ring.keys.get(keyId);
    if (!key) throw new Error("Stored credential uses an unavailable encryption key");
    try {
      const decipher = createDecipheriv(algorithm, key, decode(initializationVector));
      decipher.setAAD(Buffer.from(associatedData, "utf8"));
      decipher.setAuthTag(decode(authenticationTag));
      return Buffer.concat([decipher.update(decode(ciphertext)), decipher.final()]).toString("utf8");
    } catch {
      throw new Error("Stored credential could not be authenticated");
    }
  }
}
