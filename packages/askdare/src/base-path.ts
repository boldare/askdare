/**
 * Whether a chat route's `basePath` is a path on the app itself, like `/api/chat`: never another
 * origin, a relative path or anything that needs escaping (ADR-0011). The server, the React entry
 * and the CLI each bundle their own copy.
 */
export function isBasePath(value: string): boolean {
  return /^(\/[a-zA-Z0-9._~-]+)+$/.test(value);
}
