let backendBase: string | null = null;

/** Configure an absolute same-origin API base for desktop; browsers retain relative requests. */
export function configureBackendBase(base: string | null): void {
  if (base === null) { backendBase = null; return; }
  const parsed = new URL(base);
  const localDev = ['localhost', '127.0.0.1'].includes(parsed.hostname) && ['http:', 'https:'].includes(parsed.protocol);
  const desktopScheme = parsed.protocol === 'teamwork:' && parsed.host === 'app' && parsed.pathname.endsWith('/api/');
  if (!localDev && !desktopScheme) throw new Error('Invalid desktop backend API base');
  backendBase = base.endsWith('/') ? base : `${base}/`;
}

export function apiUrl(path: string): string {
  if (!backendBase) return path;
  return new URL(path.replace(/^\//, ''), backendBase).toString();
}

/** Shared fetch adapter: browser same-origin/proxy behavior, desktop same-origin API bridge. */
export const apiFetch: typeof fetch = (input, init) => {
  if (typeof input === 'string') return globalThis.fetch(apiUrl(input), init);
  if (input instanceof URL) return globalThis.fetch(apiUrl(input.toString()), init);
  return globalThis.fetch(apiUrl(input.url), init);
};
