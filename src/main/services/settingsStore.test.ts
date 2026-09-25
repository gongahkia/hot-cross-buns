import { describe, expect, it } from "vitest";
import type { PersistedAppSettings } from "@shared/settings";
import { SettingsStore, SettingsStoreError, type SettingsPersistence } from "./settingsStore";

class MemorySettingsPersistence implements SettingsPersistence {
  value: unknown | null = null;
  writes: PersistedAppSettings[] = [];

  async read(): Promise<unknown | null> {
    return this.value;
  }

  async write(settings: PersistedAppSettings): Promise<void> {
    this.writes.push(settings);
    this.value = settings;
  }
}

describe("SettingsStore", () => {
  it("creates strict defaults on first load", async () => {
    const persistence = new MemorySettingsPersistence();
    const store = new SettingsStore(persistence);

    await expect(store.load()).resolves.toEqual({ colorScheme: "system", startPage: "today" });
    expect(persistence.writes).toEqual([
      { schemaVersion: 1, colorScheme: "system", startPage: "today" }
    ]);
  });

  it("saves and reloads user-editable appearance and start-page preferences", async () => {
    const persistence = new MemorySettingsPersistence();
    const store = new SettingsStore(persistence);

    await expect(store.save({ colorScheme: "light", startPage: "tasks" })).resolves.toEqual({
      colorScheme: "light",
      startPage: "tasks"
    });
    await expect(store.load()).resolves.toEqual({ colorScheme: "light", startPage: "tasks" });
  });

  it("rejects malformed on-disk settings instead of silently accepting unknown data", async () => {
    const persistence = new MemorySettingsPersistence();
    persistence.value = { schemaVersion: 1, colorScheme: "nope", startPage: "today" };

    await expect(new SettingsStore(persistence).load()).rejects.toBeInstanceOf(SettingsStoreError);
  });
});
