import type { safeStorage } from "electron";

type SafeStorage = Pick<typeof safeStorage, "isEncryptionAvailable">;

function status(storage: SafeStorage, platform: "win32" | "linux") {
  const ok = storage.isEncryptionAvailable();
  return {
    ok,
    state: ok ? "ready" as const : "error" as const,
    message: ok
      ? `${platform} credential encryption is available through Electron safeStorage.`
      : `${platform} credential encryption is unavailable; Google OAuth stays disabled.`
  };
}

export function windowsSafeStorageStatus(storage: SafeStorage, platform: "win32") { return status(storage, platform); }
export function linuxSecretServiceStatus(storage: SafeStorage, platform: "linux") { return status(storage, platform); }
