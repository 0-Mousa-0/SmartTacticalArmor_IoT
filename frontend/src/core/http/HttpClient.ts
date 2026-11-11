import { ApiError } from './ApiError';

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface HttpClientOptions {
  baseUrl: string;
  getToken: () => string | null;
  /** Called when an authenticated request is rejected with 401 (expired session). */
  onUnauthorized?: () => void;
  timeoutMs?: number;
  fetchFn?: typeof fetch;
}

/**
 * The only place that knows how to talk HTTP to the Flask API: base URL,
 * JSON encoding, Bearer token, timeouts and error mapping. Repositories in
 * each feature's data layer depend on this, never on `fetch` directly.
 */
export class HttpClient {
  private readonly options: HttpClientOptions;
  private readonly fetchFn: typeof fetch;

  constructor(options: HttpClientOptions) {
    this.options = options;
    this.fetchFn = options.fetchFn ?? globalThis.fetch.bind(globalThis);
  }

  get<T>(path: string, query?: QueryParams): Promise<T> {
    return this.request<T>('GET', path, undefined, query);
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }

  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }

  delete<T>(path: string): Promise<T> {
    return this.request<T>('DELETE', path);
  }

  buildUrl(path: string, query?: QueryParams): string {
    const url = `${this.options.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    if (!query) return url;
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
    });
    const search = params.toString();
    return search ? `${url}?${search}` : url;
  }

  private async request<T>(method: string, path: string, body?: unknown, query?: QueryParams): Promise<T> {
    const token = this.options.getToken();
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 20_000);
    let response: Response;
    try {
      response = await this.fetchFn(this.buildUrl(path, query), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      throw new ApiError(0, error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'network');
    } finally {
      clearTimeout(timer);
    }

    const payload = await HttpClient.parse(response);
    if (!response.ok) {
      if (response.status === 401 && token) this.options.onUnauthorized?.();
      throw new ApiError(response.status, HttpClient.messageOf(payload) ?? (response.statusText || `HTTP ${response.status}`));
    }
    return payload as T;
  }

  private static async parse(response: Response): Promise<unknown> {
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!text) return undefined;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private static messageOf(payload: unknown): string | null {
    if (payload && typeof payload === 'object' && 'message' in payload) {
      const message = (payload as { message: unknown }).message;
      if (typeof message === 'string') return message;
    }
    return null;
  }
}
