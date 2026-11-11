import { describe, expect, it, vi } from 'vitest';
import { ApiError } from './ApiError';
import { HttpClient } from './HttpClient';

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('HttpClient', () => {
  it('sends the bearer token and JSON body', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const client = new HttpClient({ baseUrl: 'https://api.test/api/v1', getToken: () => 'abc', fetchFn });

    await expect(client.post('/devices/x/commands', { command_type: 'ping' })).resolves.toEqual({ ok: true });

    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/api/v1/devices/x/commands');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer abc');
    expect(JSON.parse(init.body)).toEqual({ command_type: 'ping' });
  });

  it('builds query strings and skips empty values', () => {
    const client = new HttpClient({ baseUrl: 'https://api.test', getToken: () => null });
    expect(client.buildUrl('/alerts', { scope: 'open', severity: undefined, limit: 50, source: '' })).toBe(
      'https://api.test/alerts?scope=open&limit=50',
    );
  });

  it('maps API errors to ApiError with the server message', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(409, { message: 'Device STA-01 is already registered' }));
    const client = new HttpClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchFn });
    const error = (await client.get('/devices').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.message).toBe('Device STA-01 is already registered');
  });

  it('reports an expired session exactly when an authenticated call gets 401', async () => {
    const onUnauthorized = vi.fn();
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(401, { message: 'Session expired' }));
    const withToken = new HttpClient({ baseUrl: 'https://api.test', getToken: () => 't', fetchFn, onUnauthorized });
    const anonymous = new HttpClient({ baseUrl: 'https://api.test', getToken: () => null, fetchFn, onUnauthorized });

    await withToken.get('/auth/me').catch(() => undefined);
    await anonymous.post('/auth/login', {}).catch(() => undefined);
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('turns network failures into status 0', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const client = new HttpClient({ baseUrl: 'https://api.test', getToken: () => null, fetchFn });
    const error = (await client.get('/health').catch((e: unknown) => e)) as ApiError;
    expect(error).toBeInstanceOf(ApiError);
    expect(error.isNetwork).toBe(true);
  });
});
