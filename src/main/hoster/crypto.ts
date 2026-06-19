import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  type CipherGCM,
  type DecipherGCM,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual
} from "node:crypto";
import type { LocalHosterManifest, LocalHosterSignalEnvelope } from "@shared/ipc/contracts";

const packageAlgorithm = "AES-256-GCM";
const signalAlgorithm = "X25519-HKDF-SHA256-AES-256-GCM";
const keyWrapAlgorithm = "scrypt-AES-256-GCM";
const keyWrapCost = 16384;
const keyWrapBlockSize = 8;
const keyWrapParallelization = 1;

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

export type LocalHosterKeyWrap = NonNullable<LocalHosterManifest["keyWrap"]>;
type SignableHosterManifest = Omit<LocalHosterManifest, "manifestSignature">;

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
  const cipher = createCipheriv(packageAlgorithm, keyFromBase64(keyBase64), iv) as CipherGCM;
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
  ) as DecipherGCM;
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
  const cipher = createCipheriv(packageAlgorithm, key, iv) as CipherGCM;
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
  const decipher = createDecipheriv(packageAlgorithm, key, Buffer.from(envelope.ivBase64, "base64")) as DecipherGCM;
  decipher.setAuthTag(Buffer.from(envelope.tagBase64, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertextBase64, "base64")),
    decipher.final()
  ]);

  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function wrapHosterPackageKey(
  packageKeyBase64: string,
  passphrase: string,
  aad = "hcbhost-keywrap-v1"
): LocalHosterKeyWrap {
  const packageKey = keyFromBase64(packageKeyBase64);
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const wrappingKey = derivePassphraseKey(passphrase, salt);
  const cipher = createCipheriv(packageAlgorithm, wrappingKey, iv) as CipherGCM;
  cipher.setAAD(Buffer.from(aad, "utf8"));
  const wrapped = Buffer.concat([cipher.update(packageKey), cipher.final()]);

  return {
    algorithm: keyWrapAlgorithm,
    kdf: "scrypt",
    saltBase64: salt.toString("base64"),
    ivBase64: iv.toString("base64"),
    tagBase64: cipher.getAuthTag().toString("base64"),
    wrappedKeyBase64: wrapped.toString("base64"),
    keyLength: 32,
    cost: keyWrapCost,
    blockSize: keyWrapBlockSize,
    parallelization: keyWrapParallelization
  };
}

export function unwrapHosterPackageKey(
  keyWrap: LocalHosterKeyWrap,
  passphrase: string,
  aad = "hcbhost-keywrap-v1"
): string {
  if (
    keyWrap.algorithm !== keyWrapAlgorithm ||
    keyWrap.kdf !== "scrypt" ||
    keyWrap.keyLength !== 32 ||
    keyWrap.cost !== keyWrapCost ||
    keyWrap.blockSize !== keyWrapBlockSize ||
    keyWrap.parallelization !== keyWrapParallelization
  ) {
    throw new Error("Unsupported hoster key wrap.");
  }
  const salt = Buffer.from(keyWrap.saltBase64, "base64");
  const wrappingKey = derivePassphraseKey(passphrase, salt);
  const decipher = createDecipheriv(packageAlgorithm, wrappingKey, Buffer.from(keyWrap.ivBase64, "base64")) as DecipherGCM;
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(Buffer.from(keyWrap.tagBase64, "base64"));
  const packageKey = Buffer.concat([
    decipher.update(Buffer.from(keyWrap.wrappedKeyBase64, "base64")),
    decipher.final()
  ]);
  if (packageKey.byteLength !== 32) {
    throw new Error("Invalid wrapped hoster package key.");
  }

  return packageKey.toString("base64");
}

export function signHosterManifest(
  manifest: SignableHosterManifest,
  packageKeyBase64: string,
  aad = manifest.hosterId
): LocalHosterManifest {
  return {
    ...manifest,
    manifestSignature: {
      algorithm: "HMAC-SHA256",
      signedFields: "manifest-without-manifestSignature",
      valueBase64Url: hosterManifestSignature(manifest, packageKeyBase64, aad)
    }
  };
}

export function verifyHosterManifestSignature(
  manifest: LocalHosterManifest,
  packageKeyBase64: string,
  aad = manifest.hosterId
): boolean {
  if (!manifest.manifestSignature) {
    return true;
  }
  const expected = hosterManifestSignature(unsignedHosterManifest(manifest), packageKeyBase64, aad);
  const actual = manifest.manifestSignature.valueBase64Url;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const actualBuffer = Buffer.from(actual, "utf8");
  return expectedBuffer.byteLength === actualBuffer.byteLength && timingSafeEqual(expectedBuffer, actualBuffer);
}

export function sha256Hex(value: Buffer | string): string {
  return createHash("sha256").update(value).digest("hex");
}

function hosterManifestSignature(
  manifest: SignableHosterManifest,
  packageKeyBase64: string,
  aad: string
): string {
  return createHmac("sha256", keyFromBase64(packageKeyBase64))
    .update(aad, "utf8")
    .update("\0")
    .update(canonicalJson(manifest), "utf8")
    .digest("base64url");
}

function unsignedHosterManifest(manifest: LocalHosterManifest): SignableHosterManifest {
  const { manifestSignature: _signature, ...unsigned } = manifest;
  return unsigned;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(",")}}`;
}

function keyFromBase64(value: string): Buffer {
  const key = Buffer.from(value, "base64");
  if (key.byteLength !== 32) {
    throw new Error("Hoster encryption key must be 32 bytes.");
  }
  return key;
}

function derivePassphraseKey(passphrase: string, salt: Buffer): Buffer {
  return scryptSync(passphrase, salt, 32, {
    N: keyWrapCost,
    r: keyWrapBlockSize,
    p: keyWrapParallelization,
    maxmem: 32 * 1024 * 1024
  });
}
