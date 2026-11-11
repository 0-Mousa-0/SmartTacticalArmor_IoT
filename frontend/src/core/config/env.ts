/**
 * Runtime configuration, resolved once from Vite env variables.
 *
 * VITE_API_BASE_URL wins; otherwise VITE_API_HOST (just the API's host name)
 * becomes https://<host>/api/v1; otherwise the local development API.
 */
function resolveApiBaseUrl(): string {
  const explicit = import.meta.env.VITE_API_BASE_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const host = import.meta.env.VITE_API_HOST?.trim();
  if (host) {
    const origin = /^https?:\/\//.test(host) ? host : `https://${host}`;
    return `${origin.replace(/\/+$/, '')}/api/v1`;
  }
  return 'http://localhost:5000/api/v1';
}

export const env = {
  apiBaseUrl: resolveApiBaseUrl(),
  timeZone: 'Asia/Riyadh',
  mapCenter: [24.7136, 46.6753] as [number, number],
} as const;
