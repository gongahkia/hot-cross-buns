import { describe, expect, it } from "vitest";

import { CredentialCipher } from "../src/credentialCipher.js";
import type { EncryptionKeyRing } from "../src/config.js";

function ring(activeId: string, values: Readonly<Record<string, Buffer>>): EncryptionKeyRing {
  return { activeId, keys: new Map(Object.entries(values)) };
}

describe("CredentialCipher", () => {
  const oldKey = Buffer.alloc(32, 1);
  const primaryKey = Buffer.alloc(32, 2);
  const associatedData = "hot-cross-buns/google-refresh-token/subject-1";

  it("round-trips a credential without exposing the plaintext", () => {
    const cipher = new CredentialCipher(ring("primary", { primary: primaryKey }));
    const encrypted = cipher.encrypt("refresh-token", associatedData);

    expect(encrypted).toMatch(/^v1\.primary\./);
    expect(encrypted).not.toContain("refresh-token");
    expect(cipher.decrypt(encrypted, associatedData)).toBe("refresh-token");
  });

  it("rejects ciphertext moved to a different Google subject", () => {
    const cipher = new CredentialCipher(ring("primary", { primary: primaryKey }));
    const encrypted = cipher.encrypt("refresh-token", associatedData);

    expect(() => cipher.decrypt(encrypted, "hot-cross-buns/google-refresh-token/subject-2")).toThrow("could not be authenticated");
  });

  it("keeps prior ciphertext readable during key rotation", () => {
    const oldCipher = new CredentialCipher(ring("old", { old: oldKey }));
    const encrypted = oldCipher.encrypt("refresh-token", associatedData);
    const rotatedCipher = new CredentialCipher(ring("primary", { old: oldKey, primary: primaryKey }));

    expect(rotatedCipher.decrypt(encrypted, associatedData)).toBe("refresh-token");
    expect(rotatedCipher.encrypt("next-refresh-token", associatedData)).toMatch(/^v1\.primary\./);
  });
});
