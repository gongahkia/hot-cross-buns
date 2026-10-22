export type LiveGoogleTestMode = "read-only" | "mutating";

const modes = new Set<LiveGoogleTestMode>(["read-only", "mutating"]);

export function liveGoogleTestMode(env: NodeJS.ProcessEnv = process.env): LiveGoogleTestMode | null {
  const value = env.HCB_LIVE_GOOGLE_TEST_MODE?.trim();
  return value && modes.has(value as LiveGoogleTestMode) ? value as LiveGoogleTestMode : null;
}

export function isLiveGoogleTest(env: NodeJS.ProcessEnv = process.env): boolean {
  return liveGoogleTestMode(env) !== null;
}

export function isLiveGoogleReadOnlyTest(env: NodeJS.ProcessEnv = process.env): boolean {
  return liveGoogleTestMode(env) === "read-only";
}
