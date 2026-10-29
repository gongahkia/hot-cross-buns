import { conflictError, ok, validationError, type HcbResult } from "../shared/result";

export const googleClientIdStorageKey = "hcb.google.webClientId";
const validClientId = (value: unknown): value is string => typeof value === "string" && value.length <= 500 && /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/.test(value);

/** Public, origin-specific application configuration, separate from workspace
 * backups and Google credentials. Access tokens remain in worker memory only. */
export function createBrowserGoogleClientConfiguration(defaultClientId?: string, storage: () => Storage = () => window.localStorage) {
  return {
    read(): string | null {
      try {
        const saved = storage().getItem(googleClientIdStorageKey);
        if (validClientId(saved)) return saved;
      } catch { /* A deployment default still works when browser storage is blocked. */ }
      return defaultClientId?.trim() || null;
    },
    save(input: Record<string, unknown>): HcbResult<string> {
      if (input.clientSecret !== undefined && input.clientSecret !== "") return validationError("Use only the Web application client ID. Browser sign-in does not use a client secret.");
      const clientId = typeof input.clientId === "string" ? input.clientId.trim() : "";
      if (!validClientId(clientId)) return validationError("Enter a Google Web application client ID ending in .apps.googleusercontent.com.");
      try { storage().setItem(googleClientIdStorageKey, clientId); }
      catch { return conflictError("The client ID could not be saved. Allow site storage in this browser, then try again. Your previous configuration is unchanged."); }
      return ok(clientId);
    }
  };
}
