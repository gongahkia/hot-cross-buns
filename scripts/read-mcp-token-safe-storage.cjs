const { createHash } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");

const mcpTokenService = "Hot Cross Buns MCP";
const mcpTokenAccount = "loopback-bearer-token";

async function main() {
  const [, , platform, storageFile] = process.argv;

  if ((platform !== "linux" && platform !== "win32") || !storageFile) {
    throw new Error("Usage: read-mcp-token-safe-storage.cjs <linux|win32> <secret-store-file>");
  }

  if (!existsSync(storageFile)) {
    throw new Error("MCP bearer token storage file does not exist.");
  }

  const { app, safeStorage } = require("electron");
  app.setName("Hot Cross Buns");
  await app.whenReady();

  if (platform === "linux") {
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

  const file = JSON.parse(readFileSync(storageFile, "utf8"));
  const entry = file?.values?.[hashedSecretKey(mcpTokenService, mcpTokenAccount)];

  if (!entry || typeof entry.ciphertextBase64 !== "string") {
    throw new Error("MCP bearer token is not configured in safe storage.");
  }

  const token = safeStorage.decryptString(Buffer.from(entry.ciphertextBase64, "base64"));

  if (!token.trim()) {
    throw new Error("MCP bearer token decrypted to an empty value.");
  }

  process.stdout.write(token);
}

function hashedSecretKey(service, account) {
  return createHash("sha256").update(service).update("\0").update(account).digest("hex");
}

void main()
  .then(() => {
    const { app } = require("electron");
    app.quit();
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);

    try {
      const { app } = require("electron");
      app.exit(1);
    } catch {
      process.exitCode = 1;
    }
  });
