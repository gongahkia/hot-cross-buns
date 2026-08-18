import type { ConnectionProfile, GoogleIdentity } from "@/types";

interface ManagedSessionResponse {
  readonly authenticated: boolean;
  readonly user?: GoogleIdentity & { readonly scopes: readonly string[] };
}

interface ManagedHealthResponse {
  readonly service?: string;
}

export function managedConnectionProfile(): ConnectionProfile | undefined {
  return import.meta.env.VITE_HCB_SELF_HOSTED_RELIABILITY_ENABLED === "true" ? { mode: "managed" } : undefined;
}

export async function readManagedSession(): Promise<(GoogleIdentity & { readonly scopes: readonly string[] }) | undefined> {
  const response = await fetch("/api/session", { credentials: "include" });
  if (!response.ok) return undefined;
  const body = await response.json() as ManagedSessionResponse;
  return body.authenticated ? body.user : undefined;
}

export function beginManagedAuthorization(scope: "core" | "drive" = "core"): void {
  window.location.assign(`/api/auth/google/start?scope=${scope}`);
}

export async function disconnectManagedConnection(): Promise<void> {
  const response = await fetch("/api/auth/google/disconnect", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" } });
  if (!response.ok && response.status !== 401) throw new Error("The self-hosted Google connection could not be disconnected");
}

export async function managedServiceAvailable(): Promise<boolean> {
  const response = await fetch("/api/health", { credentials: "include" });
  if (!response.ok) return false;
  const body = await response.json() as ManagedHealthResponse;
  return body.service === "available";
}
