import { app } from "electron";
import type { DiagnosticsHealthResponse } from "@shared/ipc/contracts";

declare const __HCB_BUILD_COMMIT__: string | undefined;
declare const __HCB_BUILD_DATE__: string | undefined;
declare const __HCB_PACKAGE_TOOL__: string | undefined;

type AppEnvironment = DiagnosticsHealthResponse["environment"];

function definedBuildValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
}

function buildValue(
  globalValue: string | undefined,
  environmentValue: string | undefined
): string | undefined {
  return definedBuildValue(globalValue) ?? definedBuildValue(environmentValue);
}

function buildDate(): string | undefined {
  const value = buildValue(
    typeof __HCB_BUILD_DATE__ === "undefined" ? undefined : __HCB_BUILD_DATE__,
    process.env.HCB_BUILD_DATE
  );

  if (!value) {
    return undefined;
  }

  return Number.isNaN(Date.parse(value)) ? undefined : new Date(value).toISOString();
}

export function appBuildMetadata(environment: AppEnvironment): DiagnosticsHealthResponse["build"] {
  const commit = buildValue(
    typeof __HCB_BUILD_COMMIT__ === "undefined" ? undefined : __HCB_BUILD_COMMIT__,
    process.env.HCB_BUILD_COMMIT
  );
  const packageTool = buildValue(
    typeof __HCB_PACKAGE_TOOL__ === "undefined" ? undefined : __HCB_PACKAGE_TOOL__,
    process.env.HCB_PACKAGE_TOOL
  );
  const date = buildDate();

  return {
    appName: app.getName(),
    version: app.getVersion(),
    environment,
    ...(process.versions.electron === undefined
      ? {}
      : { electronVersion: process.versions.electron }),
    nodeVersion: process.versions.node,
    packaged: app.isPackaged,
    ...(commit === undefined ? {} : { commit }),
    ...(date === undefined ? {} : { buildDate: date }),
    ...(packageTool === undefined ? {} : { packageTool })
  };
}
