import type { BrowserAccessToken } from "@/auth/googleIdentity";

export class TokenSession {
  private token: BrowserAccessToken | undefined;

  set(token: BrowserAccessToken): void {
    this.token = token;
  }

  clear(): void {
    this.token = undefined;
  }

  current(): BrowserAccessToken | undefined {
    return this.token;
  }

  accessToken(): string | undefined {
    if (!this.token || this.token.expiresAt <= Date.now()) {
      return undefined;
    }
    return this.token.value;
  }

  hasScope(scope: string): boolean {
    return this.token?.scopes.includes(scope) ?? false;
  }
}
