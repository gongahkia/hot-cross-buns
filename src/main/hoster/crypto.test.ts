import { describe, expect, it } from "vitest";
import {
  createLocalHosterSecret,
  decryptHosterPayload,
  decryptSignalEnvelope,
  encryptHosterPayload,
  encryptSignalEnvelope,
  unwrapHosterPackageKey,
  wrapHosterPackageKey,
  type LocalHosterEncryptedPayload
} from "./crypto";

describe("local hoster crypto negative paths", () => {
  it("rejects malformed signal envelopes before returning plaintext", () => {
    const secret = createLocalHosterSecret();
    const valid = encryptSignalEnvelope({ ok: true }, secret.publicKeyDerBase64);
    const malformed = [
      null,
      {},
      { ...valid, version: 2 },
      { ...valid, algorithm: "AES-256-GCM" },
      { ...valid, ephemeralPublicKeyBase64: "not-base64" },
      { ...valid, saltBase64: "bad" },
      { ...valid, ivBase64: "bad" },
      { ...valid, tagBase64: "bad" },
      { ...valid, ciphertextBase64: `${valid.ciphertextBase64.slice(0, -4)}AAAA` }
    ];

    for (const envelope of malformed) {
      expect(() => decryptSignalEnvelope(envelope as typeof valid, secret.privateKeyDerBase64)).toThrow();
    }
  });

  it("rejects malformed hoster payloads and key wraps", () => {
    const secret = createLocalHosterSecret();
    const encrypted = encryptHosterPayload({ ok: true }, secret.packageKeyBase64, "hoster:test");
    const malformedPayloads: unknown[] = [
      null,
      {},
      { ...encrypted, version: 2 },
      { ...encrypted, algorithm: "AES-128-GCM" },
      { ...encrypted, ivBase64: "bad" },
      { ...encrypted, tagBase64: "bad" },
      { ...encrypted, ciphertextBase64: `${encrypted.ciphertextBase64.slice(0, -4)}AAAA` }
    ];

    for (const payload of malformedPayloads) {
      expect(() => decryptHosterPayload(payload as LocalHosterEncryptedPayload, secret.packageKeyBase64, "hoster:test")).toThrow();
    }

    const wrapped = wrapHosterPackageKey(secret.packageKeyBase64, "correct horse battery", "hoster:test");
    expect(() => unwrapHosterPackageKey({ ...wrapped, algorithm: "AES-256-GCM" } as unknown as Parameters<typeof unwrapHosterPackageKey>[0], "correct horse battery", "hoster:test")).toThrow();
    expect(() => unwrapHosterPackageKey({ ...wrapped, wrappedKeyBase64: `${wrapped.wrappedKeyBase64.slice(0, -4)}AAAA` }, "correct horse battery", "hoster:test")).toThrow();
  });
});
