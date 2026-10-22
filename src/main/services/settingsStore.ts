import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  defaultAppSettings,
  persistedAppSettingsSchema,
  type AppSettings,
  type PersistedAppSettings
} from "@shared/settings";

export interface SettingsPersistence {
  read(): Promise<unknown | null>;
  write(settings: PersistedAppSettings): Promise<void>;
}

export class FileSettingsPersistence implements SettingsPersistence {
  constructor(private readonly path: string) {}

  async read(): Promise<unknown | null> {
    try {
      return JSON.parse(await readFile(this.path, "utf8")) as unknown;
    } catch (error: unknown) {
      if (isMissingFile(error)) {
        return null;
      }

      throw error;
    }
  }

  async write(settings: PersistedAppSettings): Promise<void> {
    const parent = dirname(this.path);
    await mkdir(parent, { recursive: true, mode: 0o700 });

    const temporaryPath = join(parent, `.${randomUUID()}.tmp`);
    await writeFile(temporaryPath, `${JSON.stringify(settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(temporaryPath, this.path);
  }
}

export class SettingsStoreError extends Error {}

export class SettingsStore {
  constructor(private readonly persistence: SettingsPersistence) {}

  async load(): Promise<AppSettings> {
    const stored = await this.persistence.read();
    if (stored === null) {
      await this.persistence.write(toPersisted(defaultAppSettings));
      return defaultAppSettings;
    }

    const parsed = persistedAppSettingsSchema.safeParse(stored);
    if (!parsed.success) {
      throw new SettingsStoreError("Local settings are invalid; recovery is required");
    }

    return toAppSettings(parsed.data);
  }

  async save(settings: AppSettings): Promise<AppSettings> {
    const parsed = persistedAppSettingsSchema.safeParse(toPersisted(settings));
    if (!parsed.success) {
      throw new SettingsStoreError("Local settings are invalid");
    }

    await this.persistence.write(parsed.data);
    return toAppSettings(parsed.data);
  }
}

function toPersisted(settings: AppSettings): PersistedAppSettings {
  return {
    schemaVersion: 1,
    ...settings
  };
}

function toAppSettings(settings: PersistedAppSettings): AppSettings {
  return {
    colorScheme: settings.colorScheme,
    startPage: settings.startPage
  };
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
