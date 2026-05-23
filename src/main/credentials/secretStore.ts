import { execFile } from "node:child_process";
import type { NativeOperationResult } from "../native/types";

export interface SecretStoreKey {
  service: string;
  account: string;
}

export interface SecretStore {
  read(key: SecretStoreKey): Promise<string | null>;
  write(key: SecretStoreKey, secret: string): Promise<void>;
  delete(key: SecretStoreKey): Promise<void>;
  status(): NativeOperationResult;
}

export class MacOsKeychainSecretStore implements SecretStore {
  status(): NativeOperationResult {
    if (process.platform !== "darwin") {
      return {
        ok: false,
        state: "unsupported",
        message: "macOS Keychain storage is unavailable on this platform."
      };
    }

    return {
      ok: true,
      state: "ready",
      message: "macOS Keychain storage is available for main-process secrets."
    };
  }

  async read(key: SecretStoreKey): Promise<string | null> {
    this.requireMac();

    try {
      const result = await runSecurity([
        "find-generic-password",
        "-a",
        key.account,
        "-s",
        key.service,
        "-w"
      ]);

      return result.stdout.replace(/\n$/, "");
    } catch (error) {
      if (isSecurityNotFound(error)) {
        return null;
      }

      throw secretStoreError("Could not read a secret from macOS Keychain.", error);
    }
  }

  async write(key: SecretStoreKey, secret: string): Promise<void> {
    this.requireMac();

    try {
      await runSecurity([
        "add-generic-password",
        "-U",
        "-a",
        key.account,
        "-s",
        key.service,
        "-w",
        secret
      ]);
    } catch (error) {
      throw secretStoreError("Could not write a secret to macOS Keychain.", error);
    }
  }

  async delete(key: SecretStoreKey): Promise<void> {
    this.requireMac();

    try {
      await runSecurity([
        "delete-generic-password",
        "-a",
        key.account,
        "-s",
        key.service
      ]);
    } catch (error) {
      if (isSecurityNotFound(error)) {
        return;
      }

      throw secretStoreError("Could not delete a secret from macOS Keychain.", error);
    }
  }

  private requireMac(): void {
    if (process.platform !== "darwin") {
      throw new Error("macOS Keychain storage is unavailable on this platform.");
    }
  }
}

export class UnsupportedSecretStore implements SecretStore {
  constructor(private readonly message = "OS credential storage is unavailable.") {}

  async read(_key: SecretStoreKey): Promise<string | null> {
    throw new Error(this.message);
  }

  async write(_key: SecretStoreKey, _secret: string): Promise<void> {
    throw new Error(this.message);
  }

  async delete(_key: SecretStoreKey): Promise<void> {
    throw new Error(this.message);
  }

  status(): NativeOperationResult {
    return {
      ok: false,
      state: "unsupported",
      message: this.message
    };
  }
}

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async read(key: SecretStoreKey): Promise<string | null> {
    return this.values.get(secretKey(key)) ?? null;
  }

  async write(key: SecretStoreKey, secret: string): Promise<void> {
    this.values.set(secretKey(key), secret);
  }

  async delete(key: SecretStoreKey): Promise<void> {
    this.values.delete(secretKey(key));
  }

  status(): NativeOperationResult {
    return {
      ok: true,
      state: "ready",
      message: "In-memory secret storage is available for tests."
    };
  }
}

function secretKey(key: SecretStoreKey): string {
  return `${key.service}\n${key.account}`;
}

function runSecurity(args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      "/usr/bin/security",
      [...args],
      {
        encoding: "utf8",
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stderr }));
          return;
        }

        resolve({ stdout, stderr });
      }
    );
  });
}

function isSecurityNotFound(error: unknown): boolean {
  const candidate = error as { code?: number | string; stderr?: string; message?: string };
  const message = `${candidate.stderr ?? ""}\n${candidate.message ?? ""}`.toLowerCase();

  return candidate.code === 44 || message.includes("could not be found");
}

function secretStoreError(message: string, error: unknown): Error {
  const cause = error instanceof Error ? error.message : "Unknown Keychain error";

  return new Error(`${message} ${cause}`);
}
