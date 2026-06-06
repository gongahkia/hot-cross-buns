import { BrowserWindow, ipcMain } from "electron";
import { IPC_CHANNELS } from "@shared/ipc/contracts";
import type { ServiceContainer } from "../services/serviceContainer";
import { createCoreIpcHandlers } from "./coreHandlers";
import { createDiagnosticsIpcHandlers } from "./diagnostics";
import { createIpcMetrics, registerIpcDispatcher } from "./registry";
import { appLogger } from "../diagnostics/appLogger";

export interface HcbIpcLifecycleHooks {
  onShellVisible?: () => void;
}

export function registerHcbIpc(
  services: ServiceContainer,
  lifecycleHooks: HcbIpcLifecycleHooks = {}
): void {
  const metrics = createIpcMetrics();

  registerIpcDispatcher(
    ipcMain,
    [
      ...createDiagnosticsIpcHandlers(metrics, services.performance, services, lifecycleHooks),
      ...createCoreIpcHandlers(services.domain, services.performance)
    ],
    {
      metrics,
      performanceTimings: services.performance,
      logger: {
        debug: (event) => {
          if (event.outcome === "success") {
            appLogger.debug("ipc request completed", "ipc", event);
            return;
          }

          appLogger.warn("ipc request failed", "ipc", event);
        }
      }
    }
  );

  services.domain.sync.subscribeStatus?.((status) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.syncStatus, status);
    }
  });
}
