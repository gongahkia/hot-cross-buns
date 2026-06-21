import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import { dirname } from "node:path";
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

export type LinuxSafeStorageBackendName =
  | "basic_text"
  | "gnome_libsecret"
  | "kwallet"
  | "kwallet5"
  | "kwallet6"
  | "unknown";

export interface LinuxSafeStorageBackend {
  decryptString(encrypted: Buffer): string;
  encryptString(plainText: string): Buffer;
  getSelectedStorageBackend(): LinuxSafeStorageBackendName;
  isEncryptionAvailable(): boolean;
  setUsePlainTextEncryption?: (usePlainText: boolean) => void;
}

export interface WindowsSafeStorageBackend {
  decryptString(encrypted: Buffer): string;
  encryptString(plainText: string): Buffer;
  isEncryptionAvailable(): boolean;
}

interface LinuxSecretServiceStoreOptions {
  backend: LinuxSafeStorageBackend;
  storageFile: string;
  now?: () => Date;
  platform?: NodeJS.Platform | string;
}

interface LinuxSecretStoreFile {
  version: 1;
  values: Record<string, LinuxSecretStoreEntry>;
}

interface LinuxSecretStoreEntry {
  ciphertextBase64: string;
  updatedAt: string;
}

interface WindowsSafeStorageStoreOptions {
  backend: WindowsSafeStorageBackend;
  storageFile: string;
  now?: () => Date;
  platform?: NodeJS.Platform | string;
}

interface WindowsSecretStoreFile {
  version: 1;
  values: Record<string, WindowsSecretStoreEntry>;
}

interface WindowsSecretStoreEntry {
  ciphertextBase64: string;
  updatedAt: string;
}

const linuxSecretStoreVersion = 1;
const linuxSecretSmokePlaintext = "hot-cross-buns-2-linux-secret-service-smoke";
const windowsSecretStoreVersion = 1;
const windowsSecretSmokePlaintext = "hot-cross-buns-2-windows-safe-storage-smoke";

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

export class LinuxSecretServiceStore implements SecretStore {
  private readonly now: () => Date;
  private readonly platform: NodeJS.Platform | string;

  constructor(private readonly options: LinuxSecretServiceStoreOptions) {
    this.now = options.now ?? (() => new Date());
    this.platform = options.platform ?? process.platform;
    options.backend.setUsePlainTextEncryption?.(false);
  }

  status(): NativeOperationResult {
    return linuxSecretServiceStatus(this.options.backend, this.platform);
  }

  async read(key: SecretStoreKey): Promise<string | null> {
    this.requireReady();
    const file = await this.readStoreFile();
    const entry = file.values[hashedSecretKey(key)];

    if (!entry) {
      return null;
    }

    try {
      return this.options.backend.decryptString(Buffer.from(entry.ciphertextBase64, "base64"));
    } catch {
      throw new Error("Could not decrypt a secret from Linux Secret Service storage.");
    }
  }

  async write(key: SecretStoreKey, secret: string): Promise<void> {
    this.requireReady();
    const file = await this.readStoreFile();

    try {
      file.values[hashedSecretKey(key)] = {
        ciphertextBase64: this.options.backend.encryptString(secret).toString("base64"),
        updatedAt: this.now().toISOString()
      };
    } catch {
      throw new Error("Could not encrypt a secret with Linux Secret Service storage.");
    }

    await this.writeStoreFile(file);
  }

  async delete(key: SecretStoreKey): Promise<void> {
    this.requireReady();
    const file = await this.readStoreFile();
    delete file.values[hashedSecretKey(key)];
    await this.writeStoreFile(file);
  }

  private requireReady(): void {
    const status = this.status();

    if (!status.ok) {
      throw new Error(status.message ?? "Linux Secret Service storage is unavailable.");
    }
  }

  private async readStoreFile(): Promise<LinuxSecretStoreFile> {
    let raw: string;

    try {
      raw = await fs.readFile(this.options.storageFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return emptyLinuxSecretStoreFile();
      }

      throw new Error("Could not read Linux Secret Service storage.");
    }

    try {
      return parseLinuxSecretStoreFile(JSON.parse(raw));
    } catch {
      throw new Error("Linux Secret Service storage metadata is corrupted.");
    }
  }

  private async writeStoreFile(file: LinuxSecretStoreFile): Promise<void> {
    const directory = dirname(this.options.storageFile);
    const temporaryFile = `${this.options.storageFile}.${process.pid}.${Date.now()}.tmp`;

    try {
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      await fs.writeFile(temporaryFile, `${JSON.stringify(file, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600
      });
      await fs.rename(temporaryFile, this.options.storageFile);
      await fs.chmod(this.options.storageFile, 0o600);
    } catch {
      await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
      throw new Error("Could not write Linux Secret Service storage.");
    }
  }
}

export class WindowsSafeStorageSecretStore implements SecretStore {
  private readonly now: () => Date;
  private readonly platform: NodeJS.Platform | string;

  constructor(private readonly options: WindowsSafeStorageStoreOptions) {
    this.now = options.now ?? (() => new Date());
    this.platform = options.platform ?? process.platform;
  }

  status(): NativeOperationResult {
    return windowsSafeStorageStatus(this.options.backend, this.platform);
  }

  async read(key: SecretStoreKey): Promise<string | null> {
    this.requireReady();
    const file = await this.readStoreFile();
    const entry = file.values[hashedSecretKey(key)];

    if (!entry) {
      return null;
    }

    try {
      return this.options.backend.decryptString(Buffer.from(entry.ciphertextBase64, "base64"));
    } catch {
      throw new Error("Could not decrypt a secret from Windows safe storage.");
    }
  }

  async write(key: SecretStoreKey, secret: string): Promise<void> {
    this.requireReady();
    const file = await this.readStoreFile();

    try {
      file.values[hashedSecretKey(key)] = {
        ciphertextBase64: this.options.backend.encryptString(secret).toString("base64"),
        updatedAt: this.now().toISOString()
      };
    } catch {
      throw new Error("Could not encrypt a secret with Windows safe storage.");
    }

    await this.writeStoreFile(file);
  }

  async delete(key: SecretStoreKey): Promise<void> {
    this.requireReady();
    const file = await this.readStoreFile();
    delete file.values[hashedSecretKey(key)];
    await this.writeStoreFile(file);
  }

  private requireReady(): void {
    const status = this.status();

    if (!status.ok) {
      throw new Error(status.message ?? "Windows safe storage is unavailable.");
    }
  }

  private async readStoreFile(): Promise<WindowsSecretStoreFile> {
    let raw: string;

    try {
      raw = await fs.readFile(this.options.storageFile, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return emptyWindowsSecretStoreFile();
      }

      throw new Error("Could not read Windows safe storage metadata.");
    }

    try {
      return parseWindowsSecretStoreFile(JSON.parse(raw));
    } catch {
      throw new Error("Windows safe storage metadata is corrupted.");
    }
  }

  private async writeStoreFile(file: WindowsSecretStoreFile): Promise<void> {
    const directory = dirname(this.options.storageFile);
    const temporaryFile = `${this.options.storageFile}.${process.pid}.${Date.now()}.tmp`;

    try {
      await fs.mkdir(directory, { recursive: true });
      await fs.writeFile(temporaryFile, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      await fs.rename(temporaryFile, this.options.storageFile);
    } catch {
      await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
      throw new Error("Could not write Windows safe storage metadata.");
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

export function linuxSecretServiceStatus(
  backend: LinuxSafeStorageBackend | undefined,
  platform: NodeJS.Platform | string = process.platform
): NativeOperationResult {
  if (platform !== "linux") {
    return {
      ok: false,
      state: "unsupported",
      message: "Linux Secret Service storage is unavailable on this platform."
    };
  }

  if (!backend) {
    return {
      ok: false,
      state: "unsupported",
      message: "Electron safeStorage is unavailable; Linux Secret Service storage cannot be used."
    };
  }

  let selectedBackend: LinuxSafeStorageBackendName;

  try {
    selectedBackend = backend.getSelectedStorageBackend();
  } catch {
    return {
      ok: false,
      state: "error",
      message: "Linux Secret Service backend status could not be read."
    };
  }

  if (selectedBackend === "unknown") {
    return {
      ok: false,
      state: "pending",
      message: "Linux Secret Service backend is not selected yet; retry after Electron app readiness."
    };
  }

  if (selectedBackend === "basic_text") {
    return {
      ok: false,
      state: "unsupported",
      message: "Linux Secret Service storage is unavailable; refusing Electron basic_text plaintext fallback."
    };
  }

  if (!backend.isEncryptionAvailable()) {
    return {
      ok: false,
      state: "error",
      message: `Linux Secret Service backend ${selectedBackend} is selected but encryption is unavailable or locked.`
    };
  }

  try {
    const encrypted = backend.encryptString(linuxSecretSmokePlaintext);
    const decrypted = backend.decryptString(encrypted);

    if (decrypted !== linuxSecretSmokePlaintext) {
      throw new Error("Linux Secret Service smoke check returned mismatched plaintext.");
    }
  } catch {
    return {
      ok: false,
      state: "error",
      message: `Linux Secret Service backend ${selectedBackend} failed an encryption smoke check.`
    };
  }

  return {
    ok: true,
    state: "ready",
    message: `Linux Secret Service backend ${selectedBackend} is available for main-process secrets.`
  };
}

export function windowsSafeStorageStatus(
  backend: WindowsSafeStorageBackend | undefined,
  platform: NodeJS.Platform | string = process.platform
): NativeOperationResult {
  if (platform !== "win32") {
    return {
      ok: false,
      state: "unsupported",
      message: "Windows safe storage is unavailable on this platform."
    };
  }

  if (!backend) {
    return {
      ok: false,
      state: "unsupported",
      message: "Electron safeStorage is unavailable; Windows credential storage cannot be used."
    };
  }

  if (!backend.isEncryptionAvailable()) {
    return {
      ok: false,
      state: "error",
      message: "Windows safe storage encryption is unavailable or locked."
    };
  }

  try {
    const encrypted = backend.encryptString(windowsSecretSmokePlaintext);
    const decrypted = backend.decryptString(encrypted);

    if (decrypted !== windowsSecretSmokePlaintext) {
      throw new Error("Windows safe storage smoke check returned mismatched plaintext.");
    }
  } catch {
    return {
      ok: false,
      state: "error",
      message: "Windows safe storage failed an encryption smoke check."
    };
  }

  return {
    ok: true,
    state: "ready",
    message: "Windows safe storage is available for main-process secrets."
  };
}

function emptyLinuxSecretStoreFile(): LinuxSecretStoreFile {
  return {
    version: linuxSecretStoreVersion,
    values: {}
  };
}

function emptyWindowsSecretStoreFile(): WindowsSecretStoreFile {
  return {
    version: windowsSecretStoreVersion,
    values: {}
  };
}

function parseLinuxSecretStoreFile(value: unknown): LinuxSecretStoreFile {
  const candidate = value as {
    version?: unknown;
    values?: unknown;
  };

  if (candidate.version !== linuxSecretStoreVersion || !candidate.values || typeof candidate.values !== "object") {
    throw new Error("Unsupported Linux secret store metadata.");
  }

  const values: Record<string, LinuxSecretStoreEntry> = {};

  for (const [key, entryValue] of Object.entries(candidate.values)) {
    if (!/^[a-f0-9]{64}$/.test(key)) {
      throw new Error("Invalid Linux secret store key.");
    }

    const entry = entryValue as {
      ciphertextBase64?: unknown;
      updatedAt?: unknown;
    };

    if (
      typeof entry.ciphertextBase64 !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.ciphertextBase64) ||
      typeof entry.updatedAt !== "string"
    ) {
      throw new Error("Invalid Linux secret store entry.");
    }

    values[key] = {
      ciphertextBase64: entry.ciphertextBase64,
      updatedAt: entry.updatedAt
    };
  }

  return {
    version: linuxSecretStoreVersion,
    values
  };
}

function parseWindowsSecretStoreFile(value: unknown): WindowsSecretStoreFile {
  const candidate = value as {
    version?: unknown;
    values?: unknown;
  };

  if (candidate.version !== windowsSecretStoreVersion || !candidate.values || typeof candidate.values !== "object") {
    throw new Error("Unsupported Windows safe storage metadata.");
  }

  const values: Record<string, WindowsSecretStoreEntry> = {};

  for (const [key, entryValue] of Object.entries(candidate.values)) {
    if (!/^[a-f0-9]{64}$/.test(key)) {
      throw new Error("Invalid Windows safe storage key.");
    }

    const entry = entryValue as {
      ciphertextBase64?: unknown;
      updatedAt?: unknown;
    };

    if (
      typeof entry.ciphertextBase64 !== "string" ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(entry.ciphertextBase64) ||
      typeof entry.updatedAt !== "string"
    ) {
      throw new Error("Invalid Windows safe storage entry.");
    }

    values[key] = {
      ciphertextBase64: entry.ciphertextBase64,
      updatedAt: entry.updatedAt
    };
  }

  return {
    version: windowsSecretStoreVersion,
    values
  };
}

function hashedSecretKey(key: SecretStoreKey): string {
  return createHash("sha256")
    .update(key.service)
    .update("\0")
    .update(key.account)
    .digest("hex");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
