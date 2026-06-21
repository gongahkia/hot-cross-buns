import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

const helperFlag = "--hcb-read-mcp-token-safe-storage";
const mcpTokenService = "Hot Cross Buns MCP";
const mcpTokenAccount = "loopback-bearer-token";

interface SafeStorageLike {
  decryptString: (encrypted: Buffer) => string;
  getSelectedStorageBackend?: () => string;
  isEncryptionAvailable: () => boolean;
  setUsePlainTextEncryption?: (usePlainText: boolean) => void;
}

export interface SafeStorageTokenHelperRequest {
  platform: NodeJS.Platform | string;
  storageFile: string;
}

export function parseSafeStorageTokenHelperArgv(argv: string[]): SafeStorageTokenHelperRequest | null {
  const index = argv.indexOf(helperFlag);

  if (index < 0) {
    return null;
  }

  const platform = argv[index + 1];
  const storageFile = argv[index + 2];

  if ((platform !== "linux" && platform !== "win32") || !storageFile) {
    throw new Error(`Usage: ${helperFlag} <linux|win32> <secret-store-file>`);
  }

  return { platform, storageFile };
}

export async function readMcpTokenFromSafeStorageFile(
  request: SafeStorageTokenHelperRequest,
  safeStorage: SafeStorageLike
): Promise<string> {
  if (!existsSync(request.storageFile)) {
    throw new Error("MCP bearer token storage file does not exist.");
  }

  if (request.platform === "linux") {
    safeStorage.setUsePlainTextEncryption?.(false);
    const backend = safeStorage.getSelectedStorageBackend?.();

    if (backend === "basic_text") {
      throw new Error("Refusing Electron basic_text plaintext fallback.");
    }

    if (backend === "unknown") {
      throw new Error("Linux Secret Service backend is not selected yet.");
    }
  }

  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Electron safeStorage encryption is unavailable.");
  }

  const file = JSON.parse(readFileSync(request.storageFile, "utf8")) as {
    values?: Record<string, { ciphertextBase64?: unknown }>;
  };
  const entry = file.values?.[hashedSecretKey(mcpTokenService, mcpTokenAccount)];

  if (!entry || typeof entry.ciphertextBase64 !== "string") {
    throw new Error("MCP bearer token is not configured in safe storage.");
  }

  const token = safeStorage.decryptString(Buffer.from(entry.ciphertextBase64, "base64"));

  if (!token.trim()) {
    throw new Error("MCP bearer token decrypted to an empty value.");
  }

  return token;
}

function hashedSecretKey(service: string, account: string): string {
  return createHash("sha256").update(service).update("\0").update(account).digest("hex");
}
