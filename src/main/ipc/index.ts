import { ipcMain } from "electron";
import { createDiagnosticsIpcHandlers } from "./diagnostics";
import { createIpcMetrics, registerIpcDispatcher } from "./registry";
import { createStubIpcHandlers } from "./stubs";

export function registerHcbIpc(): void {
  const metrics = createIpcMetrics();

  registerIpcDispatcher(
    ipcMain,
    [...createDiagnosticsIpcHandlers(metrics), ...createStubIpcHandlers()],
    {
      metrics
    }
  );
}
