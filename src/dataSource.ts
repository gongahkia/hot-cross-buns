export type DataMethod = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export type DataRequest = {
  path: string;
  method?: DataMethod;
  body?: unknown;
  signal?: AbortSignal;
  timezone?: string;
};

export interface DataSource {
  request<T>(request: DataRequest): Promise<T>;
  url?(path: string): string | null;
}

export class DataSourceError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'DataSourceError';
  }
}

const configuredBase = String(import.meta.env.VITE_API_BASE_URL ?? '').trim().replace(/\/$/, '');

export class HttpDataSource implements DataSource {
  constructor(private readonly baseUrl: string) {}

  url(path: string) {
    return new URL(`${this.baseUrl}${path}`, window.location.origin).toString();
  }

  async request<T>({ path, method = 'GET', body, signal, timezone }: DataRequest): Promise<T> {
    const url = new URL(this.url(path));
    if (timezone) url.searchParams.set('timezone', timezone);
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        credentials: 'include',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') throw error;
      throw new DataSourceError('Couldn’t connect to the configured data source.', 0);
    }
    if (!response.ok) {
      const value: unknown = await response.json().catch(() => null);
      const detail = typeof value === 'object' && value !== null && 'detail' in value
        ? (value as { detail?: unknown }).detail : null;
      throw new DataSourceError(
        typeof detail === 'string' ? detail : 'The data source rejected that request.',
        response.status,
      );
    }
    return response.status === 204 ? undefined as T : await response.json() as T;
  }
}

class MissingDataSource implements DataSource {
  async request<T>(): Promise<T> {
    throw new DataSourceError(
      'No data source is connected. Set VITE_API_BASE_URL or configure one in src/dataSource.ts.',
      503,
    );
  }

  url() { return null; }
}

let activeDataSource: DataSource = configuredBase
  ? new HttpDataSource(configuredBase)
  : new MissingDataSource();
let connected = configuredBase.length > 0;

export function configureDataSource(source: DataSource) {
  activeDataSource = source;
  connected = true;
}

export function requestData<T>(request: DataRequest) {
  return activeDataSource.request<T>(request);
}

export function dataSourceUrl(path: string) {
  return activeDataSource.url?.(path) ?? null;
}

export function isDataSourceConfigured() {
  return connected;
}
