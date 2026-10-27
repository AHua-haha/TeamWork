export interface DesktopConfig { backendOrigin: string }

export function parseDesktopConfig(value: unknown): DesktopConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Desktop configuration must be a JSON object with a backendOrigin property.');
  const backendOrigin = (value as { backendOrigin?: unknown }).backendOrigin;
  if (typeof backendOrigin !== 'string' || !backendOrigin.trim()) throw new Error('Desktop configuration requires a non-empty backendOrigin string.');
  let parsed: URL;
  try { parsed = new URL(backendOrigin); } catch { throw new Error('backendOrigin must be an absolute HTTP or HTTPS origin.'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== backendOrigin || parsed.username || parsed.password) {
    throw new Error('backendOrigin must be a plain HTTP or HTTPS origin without credentials, path, query, or fragment.');
  }
  return { backendOrigin };
}
