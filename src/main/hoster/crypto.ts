import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes
} from "node:crypto";
import type { LocalHosterSignalEnvelope } from "@shared/ipc/contracts";

const packageAlgorithm = "AES-256-GCM";
const signalAlgorithm = "X25519-HKDF-SHA256-AES-256-GCM";

export interface LocalHosterSecret {
  packageKeyBase64: string;
  privateKeyDerBase64: string;
  publicKeyDerBase64: string;
  keyFingerprint: string;
}

export interface LocalHosterEncryptedPayload {
  version: 1;
  algorithm: "AES-256-GCM";
  ivBase64: string;
  tagBase64: string;
  ciphertextBase64: string;
}

export function createLocalHosterSecret(): LocalHosterSecret {
  const pair = generateKeyPairSync("x25519");
  const publicKeyDer = pair.publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const privateKeyDer = pair.privateKey.export({ type: "pkcs8", format: "der" }) as Buffer;

  return {
    packageKeyBase64: randomBytes(32).toString("base64"),
    privateKeyDerBase64: privateKeyDer.toString("base64"),
    publicKeyDerBase64: publicKeyDer.toString("base64"),
    keyFingerprint: sha256Hex(publicKeyDer)
  };
}

export function encryptHosterPayload(
  value: unknown,
  keyBase64: string,
  aad = "hcbhost-v1"
): LocalHosterEncryptedPayload {
  const iv = randomBytes(12);
  const cipher = createCipheriv(packageAlgorithm, keyFromBase64(keyBase64), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    version: 1,
    algorithm: packageAlgorithm,
    ivBase64: iv.toString("base64"),
    tagBase64: cipher.getAuthTag().toString("base64"),
    ciphertextBase64: ciphertext.toString("base64")
  };
}

export function decryptHosterPayload<T>(
  encrypted: LocalHosterEncryptedPayload,
  keyBase64: string,
  aad = "hcbhost-v1"
): T {
  if (encrypted.version !== 1 || encrypted.algorithm !== packageAlgorithm) {
    throw new Error("Unsupported hoster payload encryption.");
  }
  const decipher = createDecipheriv(
    packageAlgorithm,
    keyFromBase64(keyBase64),
    Buffer.from(encrypted.ivBase64, "base64")
  );
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(encrypted.tagBase64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(encrypted.ciphertextBase64, "base64")),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function encryptSignalEnvelope(
  value: unknown,
  recipientPublicKeyDerBase64: string
): LocalHosterSignalEnvelope {
  const recipientPublicKey = createPublicKey({
    key: Buffer.from(recipientPublicKeyDerBase64, "base64"),
    type: "spki",
    format: "der"
  });
  const ephemeral = generateKeyPairSync("x25519");
  const shared = diffieHellman({
    privateKey: ephemeral.privateKey,
    publicKey: recipientPublicKey
  });
  const salt = randomBytes(16);
  const key = Buffer.from(hkdfSync("sha256", shared, salt, "hcb2-signal-v1", 32));
  const iv = randomBytes(12);
  const cipher = createCipheriv(packageAlgorithm, key, iv);
  const plaintext = Buffer.from(JSON.stringify(value), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return {
    version: 1,
    algorithm: signalAlgorithm,
    ephemeralPublicKeyBase64: (ephemeral.publicKey.export({ type: "spki", format: "der" }) as Buffer).toString("base64"),
    saltBase64: salt.toString("base64"),
    ivBase64: iv.toString("base64"),
    tagBase64: cipher.getAuthTag().toString("base64"),
    ciphertextBase64: ciphertext.toString("base64")
  };
}

export function decryptSignalEnvelope<T>(
  envelope: LocalHosterSignalEnvelope,
  recipientPrivateKeyDerBase64: string
): T {
  if (envelope.version !== 1 || envelope.algorithm !== signalAlgorithm) {
    throw new Error("Unsupported signal envelope.");
  }
  const privateKey = createPrivateKey({
    key: Buffer.from(recipientPrivateKeyDerBase64, "base64"),
    type: "pkcs8",
    format: "der"
  });
  const publicKey = createPublicKey({
    key: Buffer.from(envelope.ephemeralPublicKeyBase64, "base64"),
    type: "spki",
    format: "der"
  });
  const shared = diffieHellman({ privateKey, publicKey });
  const key = Buffer.from(
    hkdfSync("sha256", shared, Buffer.from(envelope.saltBase64, "base64"), "hcb2-signal-v1", 32)
  );
  const decipher = createDecipheriv(packageAlgorithm, key, Buffer.from(envelope.ivBase64, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.tagBase64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertextBase64, "base64")),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) {
    throw new Error("Hoster encryption key must be 32 bytes.");
  }
  return key;
}
