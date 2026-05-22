import { ipcMain } from "electron";
import type { ServiceContainer } from "../services/serviceContainer";
import { createCoreIpcHandlers } from "./coreHandlers";
import { createDiagnosticsIpcHandlers } from "./diagnostics";
import { createIpcMetrics, registerIpcDispatcher } from "./registry";

export function registerHcbIpc(services: ServiceContainer): void {
  const metrics = createIpcMetrics();

  registerIpcDispatcher(
    ipcMain,
    [...createDiagnosticsIpcHandlers(metrics), ...createCoreIpcHandlers(services.domain)],
    {
      metrics
    }
  );
}
