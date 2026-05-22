import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";
import type { HcbApi } from "./src/shared/preloadApi";
import { ok } from "./src/shared/result";

const hcbApi: HcbApi = {
  diagnostics: {
    health: vi.fn(async () =>
      ok({
        status: "ok" as const,
        version: "0.0.0-test",
        environment: "test" as const,
        timestamp: new Date("2026-05-22T00:00:00.000Z").toISOString(),
        uptimeMs: 1,
        startup: {
          processStartedMs: 0
        }
      })
    ),
    markShellVisible: vi.fn(async () =>
      ok({
        processStartedMs: 0,
        shellVisibleMs: 1
      })
    )
  }
};

Object.defineProperty(window, "hcb", {
  configurable: true,
  value: hcbApi
});
