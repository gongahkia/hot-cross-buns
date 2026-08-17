import type { ConnectionProfile, GoogleIdentity } from "@/types";

interface ManagedSessionResponse {
  readonly authenticated: boolean;
  readonly user?: GoogleIdentity & { readonly scopes: readonly string[] };
}

interface ManagedHealthResponse {
  readonly service?: string;
}

function configuredOrigin(): string | undefined {
  const configured = import.meta.env.VITE_HCB_BACKEND_URL?.trim();
  if (!configured) return undefined;
  try {
    const url = new URL(configured);
    return url.protocol === "https:" || url.protocol === "http:" ? url.origin : undefined;
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

export async function managedServiceAvailable(backendOrigin: string): Promise<boolean> {
  const response = await fetch(`${new URL(backendOrigin).origin}/api/health`, { credentials: "include" });
  if (!response.ok) return false;
  const body = await response.json() as ManagedHealthResponse;
  return body.service === "available";
}
