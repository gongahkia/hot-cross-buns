import { CoreStoreError } from '@shared/core/CoreStore';
import type { GoogleSyncOAuth } from '@shared/google/types';

export interface BrowserGoogleSession {
  accessToken: string;
  expiresAt: number;
  subject: string;
  scopes: string[];
}

/** One worker's memory only. Never put this object in a snapshot or broadcast it. */
export class BrowserGoogleSessions implements GoogleSyncOAuth {
  private readonly sessions = new Map<string, BrowserGoogleSession>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}

  set(accountId: string, session: BrowserGoogleSession): void {
    if (!accountId || !session.subject || typeof session.accessToken !== 'string' || !session.accessToken ||
        !Number.isFinite(session.expiresAt) || session.expiresAt <= Date.now() || !Array.isArray(session.scopes)) {
      throw new CoreStoreError('Google returned an invalid or expired session. Connect again.');
    }
    this.sessions.set(accountId, { ...session, scopes: [...session.scopes] });
    for (const listener of this.listeners) listener();
  }

  delete(accountId: string): void { this.sessions.delete(accountId); }
  clear(): void { this.sessions.clear(); }
  has(accountId: string, expectedSubject?: string): boolean {
    const session = this.sessions.get(accountId);
    return Boolean(session && session.expiresAt > Date.now() + 10_000 && (!expectedSubject || session.subject === expectedSubject));
  }
  /** Only nonsensitive metadata may reach status DTOs. */
  metadata(accountId: string): { expiresAt: number; subject: string; scopes: string[] } | undefined {
    const session = this.sessions.get(accountId);
    return session ? { expiresAt: session.expiresAt, subject: session.subject, scopes: [...session.scopes] } : undefined;
  }
  onConnectionChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  async googleFetch(accountId: string, input: string | URL, init: RequestInit = {}): Promise<Response> {
    const target = new URL(input);
    const hosts = new Set(['www.googleapis.com', 'tasks.googleapis.com', 'gmail.googleapis.com']);
    if (target.protocol !== 'https:' || !hosts.has(target.hostname) || target.port || target.username || target.password) {
      throw new CoreStoreError('Refused to send Google authorization to an unexpected destination.');
    }
    const session = this.sessions.get(accountId);
    if (!session || !this.has(accountId)) {
      this.sessions.delete(accountId);
      throw new CoreStoreError('Your Google session has expired. Reconnect Google to continue; local changes remain saved.');
    }
    const headers = new Headers(init.headers);
    headers.set('authorization', `Bearer ${session.accessToken}`);
    // The browser calculates this forbidden header from the supplied byte body.
    headers.delete('content-length');
    const controller = new AbortController();
    const abort = () => controller.abort(init.signal?.reason);
    if (init.signal?.aborted) abort();
    else init.signal?.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(() => controller.abort(new Error('Google request timed out. Reconnect or retry when your network is available.')), 30_000);
    const cleanup = () => {
      clearTimeout(timeout);
      init.signal?.removeEventListener('abort', abort);
    };
    let response: Response;
    try {
      response = await this.fetcher(target, { ...init, headers, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' });
    } catch (error) { cleanup(); throw error; }
    if (response.status === 401) this.sessions.delete(accountId);
    // Never silently refresh and resend a mutation; reconnect needs a user gesture.
    if (!response.body) { cleanup(); return response; }
    if (init.method?.toUpperCase() === 'HEAD' || [204, 205, 304].includes(response.status)) {
      // Some transports expose an empty stream for bodyless statuses. Response
      // reconstruction must still use null (an empty stream/ArrayBuffer fails).
      cleanup();
      void response.body.cancel().catch(() => {});
      return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    // Keep the deadline through body consumption as well as response headers.
    // Otherwise a stalled JSON body could retain the worker writer lock forever.
    const reader = response.body.getReader();
    const body = new ReadableStream<Uint8Array>({
      async pull(stream) {
        try {
          const item = await reader.read();
          if (item.done) { cleanup(); stream.close(); }
          else stream.enqueue(item.value);
        } catch (error) { cleanup(); stream.error(error); }
      },
      cancel(reason) { cleanup(); return reader.cancel(reason); },
    });
    return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
}
