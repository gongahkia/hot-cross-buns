import { createServer, type Server } from "node:http";
import { redactErrorMessage } from "@shared/redaction";
import { DesktopGoogleOAuthService, type GoogleOAuthAuthorizationRequestDto } from "./oauth";
import type { GoogleCredentialAdapter } from "./credentials";
import type { GoogleOAuthClientConfigStore } from "./runtimeConfig";
import type { GoogleOAuthAccountStatusStore, GoogleOAuthAuthorizationCodeTransport } from "./oauth";
import type { GoogleAccountConnectionStatusDto } from "./types";

export interface GoogleOAuthLoopbackControllerOptions {
  configStore: GoogleOAuthClientConfigStore;
  credentialAdapter: GoogleCredentialAdapter;
  authorizationTransport: GoogleOAuthAuthorizationCodeTransport;
  accountStatusStore: GoogleOAuthAccountStatusStore;
  openExternalUrl: (url: string) => Promise<{ ok: boolean; message?: string }>;
  onConnected?: (status: GoogleAccountConnectionStatusDto) => void | Promise<void>;
}

export interface GoogleOAuthBeginResult extends GoogleOAuthAuthorizationRequestDto {
  openedExternalBrowser: boolean;
  redirectUri: string;
}

const CALLBACK_PATH = "/oauth/google/callback";

export class GoogleOAuthLoopbackController {
  private server: Server | undefined;
  private oauthService: DesktopGoogleOAuthService | undefined;

  constructor(private readonly options: GoogleOAuthLoopbackControllerOptions) {}

  async beginAuthorization(): Promise<GoogleOAuthBeginResult> {
    await this.stop();

    const { server, redirectUri } = await startLoopbackServer((url) => this.handleCallback(url));
    const clientConfig = await this.options.configStore.oauthConfig(redirectUri);

    if (clientConfig === null) {
      server.close();
      throw new Error("Configure a Google Desktop OAuth client ID before connecting.");
    }

    this.server = server;
    this.oauthService = new DesktopGoogleOAuthService({
      clientConfig,
      credentialAdapter: this.options.credentialAdapter,
      authorizationCodeTransport: this.options.authorizationTransport,
      accountStatusStore: this.options.accountStatusStore
    });

    const authorization = this.oauthService.beginAuthorization();
    const opened = await this.options.openExternalUrl(authorization.authorizationUrl);

    if (!opened.ok) {
      await this.stop();
      throw new Error(opened.message ?? "Could not open the Google authorization URL.");
    }

    return {
      ...authorization,
      openedExternalBrowser: true,
      redirectUri
    };
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = undefined;
    this.oauthService = undefined;

    if (!server) {
      return;
    }

    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  private async handleCallback(url: URL): Promise<{ statusCode: number; body: string }> {
    const service = this.oauthService;

    if (!service) {
      return callbackPage(410, "Google authorization is no longer active.");
    }

    const error = url.searchParams.get("error");
    if (error) {
      void this.stop();
      return callbackPage(400, `Google authorization was cancelled: ${redactErrorMessage(error)}`);
    }

    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");

    if (!code || !state) {
      return callbackPage(400, "Google authorization callback was missing required fields.");
    }

    try {
      const status = await service.completeAuthorization({ code, state });
      void this.stop();
      await this.options.onConnected?.(status);
      return callbackPage(200, "Google authorization completed. You can return to Hot Cross Buns 2.");
    } catch (thrown) {
      void this.stop();
      const message = thrown instanceof Error ? thrown.message : "Google authorization failed.";

      return callbackPage(500, redactErrorMessage(message));
    }
  }
}

function startLoopbackServer(
  onCallback: (url: URL) => Promise<{ statusCode: number; body: string }>
): Promise<{ server: Server; redirectUri: string }> {
  const server = createServer((request, response) => {
    const address = server.address();
    const port = address && typeof address === "object" ? address.port : 0;
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${port}`);

    if (request.method !== "GET" || url.pathname !== CALLBACK_PATH) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not Found");
      return;
    }

    void onCallback(url).then(
      (result) => {
        response.writeHead(result.statusCode, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(result.body);
      },
      () => {
        response.writeHead(500, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(renderHtml("Google authorization failed."));
      }
    );
  });

  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();

      if (!address || typeof address !== "object") {
        reject(new Error("Google OAuth loopback did not bind to a TCP port."));
        return;
      }

      resolve({
        server,
        redirectUri: `http://127.0.0.1:${address.port}${CALLBACK_PATH}`
      });
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen({ host: "127.0.0.1", port: 0 });
  });
}

function callbackPage(statusCode: number, message: string): { statusCode: number; body: string } {
  return {
    statusCode,
    body: renderHtml(message)
  };
}

function renderHtml(message: string): string {
  return `<!doctype html><meta charset="utf-8"><title>Hot Cross Buns 2</title><body><main style="font-family:system-ui,sans-serif;max-width:36rem;margin:4rem auto;line-height:1.5"><h1>Hot Cross Buns 2</h1><p>${escapeHtml(message)}</p></main></body>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}
