/**
 * Whether a chat route's `basePath` is a path on the app itself, like `/api/chat`: never another
 * origin, a relative path or anything that needs escaping (ADR-0011). The server, the React entry
 * and the CLI each bundle their own copy.
 */
export function isBasePath(value: string): boolean {
  return /^(\/[a-zA-Z0-9._~-]+)+$/.test(value);
}

/**
 * Whether a bot's `embedPath` is a page of the same app, like `/askdare/support` (ADR-0018): a
 * path as `isBasePath` accepts it, without `.` or `..` segments, so a redirect to it can't leave
 * the app or climb out of where it points.
 */
export function isEmbedPath(value: string): boolean {
  return isBasePath(value) && !value.split('/').some((segment) => /^\.{1,2}$/.test(segment));
}

/** Whether `path` is `basePath` itself or inside it. */
export function isInside(path: string, basePath: string): boolean {
  return path === basePath || path.startsWith(`${basePath}/`);
}
