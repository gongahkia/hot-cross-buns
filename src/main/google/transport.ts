export type GoogleHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface GoogleAccessTokenProvider {
  accessToken(accountId: string): Promise<string>;
}

export interface GoogleApiRequest {
  method?: GoogleHttpMethod;
  path: string;
  query?: Record<string, string | number | boolean | null | undefined>;
  body?: unknown;
  ifMatch?: string;
}

export interface GoogleApiResponseMetadata {
  status: number;
  serverDate?: string;
}

export interface GoogleApiTransport {
  getJson<T>(request: GoogleApiRequest): Promise<T>;
  getJsonWithMetadata<T>(request: GoogleApiRequest): Promise<{
    data: T;
    metadata: GoogleApiResponseMetadata;
  }>;
  send(request: GoogleApiRequest): Promise<void>;
}

export type GoogleApiErrorKind =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "precondition_failed"
  | "invalid_sync_token"
  | "rate_limited"
  | "server"
  | "invalid_payload"
  | "transport";

export class GoogleApiError extends Error {
  readonly kind: GoogleApiErrorKind;
  readonly status: number | undefined;
  readonly retryAfterMs: number | undefined;
  readonly responseBodyBytes: number | undefined;
  readonly quotaExceeded: boolean;

  constructor(options: {
    kind: GoogleApiErrorKind;
    message: string;
    status?: number;
    retryAfterMs?: number;
    responseBodyBytes?: number;
    quotaExceeded?: boolean;
  }) {
    super(options.message);
    this.name = "GoogleApiError";
    this.kind = options.kind;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.responseBodyBytes = options.responseBodyBytes;
    this.quotaExceeded = options.quotaExceeded ?? false;
  }

  static fromHttpStatus(status: number, body: string, retryAfterMs?: number): GoogleApiError {
    const responseBodyBytes = Buffer.byteLength(body);
    const quotaExceeded = isQuotaExceededBody(body);
    const kind = kindForStatus(status, quotaExceeded);

    return new GoogleApiError({
      kind,
      message: messageForStatus(status, kind),
      status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
      responseBodyBytes,
      quotaExceeded
    });
  }
}

export interface GoogleHttpApiTransportOptions {
  accountId: string;
  tokenProvider: GoogleAccessTokenProvider;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_GOOGLE_API_BASE_URL = "https://www.googleapis.com";

export class GoogleHttpApiTransport implements GoogleApiTransport {
  private readonly accountId: string;
  private readonly tokenProvider: GoogleAccessTokenProvider;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: GoogleHttpApiTransportOptions) {
    this.accountId = options.accountId;
    this.tokenProvider = options.tokenProvider;
    this.baseUrl = options.baseUrl ?? DEFAULT_GOOGLE_API_BASE_URL;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async getJson<T>(request: GoogleApiRequest): Promise<T> {
    return (await this.getJsonWithMetadata<T>(request)).data;
  }

  async getJsonWithMetadata<T>(request: GoogleApiRequest): Promise<{
    data: T;
    metadata: GoogleApiResponseMetadata;
  }> {
    const response = await this.perform(request);
    const data = (await decodeJson(response)) as T;

    return {
      data,
      metadata: {
        status: response.status,
        ...(response.headers.get("date") === null ? {} : { serverDate: response.headers.get("date") ?? undefined })
      }
    };
  }

  async send(request: GoogleApiRequest): Promise<void> {
    await this.perform(request);
  }

  private async perform(request: GoogleApiRequest): Promise<Response> {
    const accessToken = await this.tokenProvider.accessToken(this.accountId);
    const headers = new Headers({
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`
    });
    const init: RequestInit = {
      method: request.method ?? "GET",
      headers
    };

    if (request.ifMatch !== undefined && request.ifMatch.length > 0) {
      headers.set("If-Match", request.ifMatch);
    }

    if (request.body !== undefined) {
      headers.set("Content-Type", "application/json");
      init.body = JSON.stringify(request.body);
    }

    let response: Response;

    try {
      response = await this.fetchImpl(this.buildUrl(request), init);
    } catch {
      throw new GoogleApiError({
        kind: "transport",
        message: "Google request failed before a response was received"
      });
    }

    if (!response.ok) {
      const body = await safeResponseText(response);

      throw GoogleApiError.fromHttpStatus(
        response.status,
        body,
        retryAfterHeaderMs(response.headers.get("retry-after"))
      );
    }

    return response;
  }

  private buildUrl(request: GoogleApiRequest): string {
    const url = new URL(request.path, this.baseUrl);

    for (const [key, value] of Object.entries(request.query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, String(value));
      }
    }

    return url.toString();
  }
}

async function decodeJson(response: Response): Promise<unknown> {
  if (response.status === 204) {
    return undefined;
  }

  const text = await response.text();

  if (text.length === 0) {
    return undefined;
  }

  return JSON.parse(text);
}

async function safeResponseText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function retryAfterHeaderMs(value: string | null): number | undefined {
  if (value === null || value.trim().length === 0) {
    return undefined;
  }

  const seconds = Number(value);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }

  const retryAtMs = Date.parse(value);

  if (!Number.isFinite(retryAtMs)) {
    return undefined;
  }

  return Math.max(0, retryAtMs - Date.now());
}

function kindForStatus(status: number, quotaExceeded: boolean): GoogleApiErrorKind {
  if (status === 401) {
    return "unauthorized";
  }

  if (status === 403) {
    return "forbidden";
  }

  if (status === 404) {
    return "not_found";
  }

  if (status === 409) {
    return "conflict";
  }

  if (status === 410) {
    return "invalid_sync_token";
  }

  if (status === 412) {
    return "precondition_failed";
  }

  if (status === 429 || quotaExceeded) {
    return "rate_limited";
  }

  if (status >= 500 && status <= 599) {
    return "server";
  }

  if (status === 400) {
    return "invalid_payload";
  }

  return "transport";
}

function messageForStatus(status: number, kind: GoogleApiErrorKind): string {
  switch (kind) {
    case "unauthorized":
      return "Google account reauthentication is required";
    case "forbidden":
      return "Google denied access to the requested resource";
    case "not_found":
      return "Google resource was not found";
    case "conflict":
      return "Google resource changed before the operation completed";
    case "precondition_failed":
      return "Google resource precondition failed";
    case "invalid_sync_token":
      return "Google sync token is invalid and requires a full resync";
    case "rate_limited":
      return "Google rate limit was reached";
    case "server":
      return "Google service is temporarily unavailable";
    case "invalid_payload":
      return "Google rejected the request payload";
    case "transport":
      return `Google request failed with status ${status}`;
  }
}

function isQuotaExceededBody(body: string): boolean {
  const lower = body.toLowerCase();

  return (
    lower.includes("quotaexceeded") ||
    lower.includes("dailylimitexceeded") ||
    lower.includes("usage limits") ||
    lower.includes("quota exceeded") ||
    lower.includes("daily limit")
  );
}
