import {
  healthCheckRequestSchema,
  healthCheckResultSchema,
  shellVisibleRequestSchema,
  shellVisibleResultSchema
} from "@shared/diagnostics";
import { IPC_CHANNELS } from "@shared/ipc";
import type { HcbApi } from "@shared/preloadApi";
import type { HcbResult } from "@shared/result";
import { ipcError, validationError } from "@shared/result";

export interface IpcBridge {
  invoke: (channel: string, payload: unknown) => Promise<unknown>;
}

function validationResult<T>(message: string): HcbResult<T> {
  return validationError(message) as HcbResult<T>;
}

function ipcFailure<T>(message: string): HcbResult<T> {
  return ipcError(message) as HcbResult<T>;
}

export function createHcbApi(ipc: IpcBridge): HcbApi {
  return {
    diagnostics: {
      health: async () => {
        const request = healthCheckRequestSchema.safeParse({});
        if (!request.success) {
          return validationResult("Invalid health check request");
        }

        try {
          const rawResult = await ipc.invoke(IPC_CHANNELS.diagnostics.health, request.data);
          const parsedResult = healthCheckResultSchema.safeParse(rawResult);

          if (!parsedResult.success) {
            return validationResult("Invalid health check response");
          }

          return parsedResult.data;
        } catch {
          return ipcFailure("Diagnostics health check failed");
        }
      },
      markShellVisible: async () => {
        const request = shellVisibleRequestSchema.safeParse({
          rendererNowMs: performance.now()
        });

        if (!request.success) {
          return validationResult("Invalid shell visibility request");
        }

        try {
          const rawResult = await ipc.invoke(
            IPC_CHANNELS.diagnostics.markShellVisible,
            request.data
          );
          const parsedResult = shellVisibleResultSchema.safeParse(rawResult);

          if (!parsedResult.success) {
            return validationResult("Invalid shell visibility response");
          }

          return parsedResult.data;
        } catch {
          return ipcFailure("Shell visibility timing failed");
        }
      }
    }
  };
}
