import type { ConnectionProfile, GoogleIdentity } from "@/types";

interface ManagedSessionResponse {
  readonly authenticated: boolean;
  readonly user?: GoogleIdentity & { readonly scopes: readonly string[] };
}

function configuredOrigin(): string | undefined {
  const configured = import.meta.env.VITE_HCB_BACKEND_URL?.trim();
  if (!configured) return undefined;
  try {
    return new URL(configured).origin;
  } catch {
    return undefined;
  }
}

export function managedConnectionProfile(): ConnectionProfile | undefined {
  const backendOrigin = configuredOrigin();
  return backendOrigin ? { mode: "managed", backendOrigin } : undefined;
}

export async function readManagedSession(backendOrigin: string): Promise<(GoogleIdentity & { readonly scopes: readonly string[] }) | undefined> {
  const response = await fetch(`${backendOrigin}/api/session`, { credentials: "include" });
  if (!response.ok) return undefined;
  const body = await response.json() as ManagedSessionResponse;
  return body.authenticated ? body.user : undefined;
}

export function beginManagedAuthorization(backendOrigin: string, scope: "core" | "drive" = "core"): void {
  window.location.assign(`${backendOrigin}/api/auth/google/start?scope=${scope}`);
}

export async function disconnectManagedConnection(backendOrigin: string): Promise<void> {
  const response = await fetch(`${backendOrigin}/api/auth/google/disconnect`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
  if (!response.ok && response.status !== 401) throw new Error("The managed Google connection could not be disconnected");
}
