import { isAbsolute, posix, win32 } from "node:path";

export const userDataDirectoryEnvKey = "HCB_USER_DATA_DIR";
export const packagedUserDataDirectoryOverrideEnvKey = "HCB_ALLOW_PACKAGED_USER_DATA_DIR";

export function resolveUserDataDirectoryOverride(env: NodeJS.ProcessEnv, isPackaged: boolean): string | null {
  const userDataDirectory = env[userDataDirectoryEnvKey]?.trim();

  if (!userDataDirectory || !isAbsoluteOnAnySupportedHost(userDataDirectory)) {
    return null;
  }

  if (!isPackaged || env[packagedUserDataDirectoryOverrideEnvKey] === "1") {
    return userDataDirectory;
  }

  return null;
}

function isAbsoluteOnAnySupportedHost(value: string): boolean {
  return isAbsolute(value) || posix.isAbsolute(value) || win32.isAbsolute(value);
}
