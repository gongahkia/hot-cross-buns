import { ipcMain } from "electron";
import {
  settingsDataInfoRequestSchema,
  settingsGetRequestSchema,
  settingsSaveRequestSchema,
  type SettingsDataInfo
} from "@shared/settings";
import { IPC_CHANNELS } from "@shared/ipc";
import { internalError, ok, validationError } from "@shared/result";
import { SettingsStore } from "../services/settingsStore";

export function registerSettingsIpc(settings: SettingsStore, dataInfo: SettingsDataInfo): void {
  ipcMain.handle(IPC_CHANNELS.settings.get, async (_event, payload: unknown) => {
    if (!settingsGetRequestSchema.safeParse(payload).success) {
      return validationError("Invalid settings request");
    }

    return execute(() => settings.load());
  });

  ipcMain.handle(IPC_CHANNELS.settings.save, async (_event, payload: unknown) => {
    const request = settingsSaveRequestSchema.safeParse(payload);
    if (!request.success) {
      return validationError("Invalid settings update");
    }

    return execute(() => settings.save(request.data));
  });

  ipcMain.handle(IPC_CHANNELS.settings.dataInfo, async (_event, payload: unknown) => {
    if (!settingsDataInfoRequestSchema.safeParse(payload).success) {
      return validationError("Invalid settings data-info request");
    }

    return ok(dataInfo);
  });
}

async function execute<T>(operation: () => Promise<T>) {
  try {
    return ok(await operation());
  } catch {
    return internalError("The local settings could not be read or saved");
  }
}
