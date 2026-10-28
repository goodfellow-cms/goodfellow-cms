/**
 * The address a plugin's frame asks its server module at, or `undefined` where
 * `path` would leave the plugin's own addresses: `..` in any spelling (browsers
 * read `%2e%2e` as `..`), encoded slashes, backslashes, and other origins.
 */
export function pluginServerAddress(
  base: string,
  id: string,
  path: string,
  relativeTo: string = location.href,
): string | undefined {
  if (/%2e|%2f|%5c|\\/i.test(path) || /^[a-z][a-z\d+.-]*:/i.test(path)) return undefined;
  const segments = path.split(/[?#]/, 1)[0]?.split("/") ?? [];
  if (segments.some((segment) => segment === "." || segment === "..")) return undefined;
  const prefix = new URL(`${base.replace(/\/+$/, "")}/${encodeURIComponent(id)}/`, relativeTo);
  const url = new URL(path.replace(/^\/+/, ""), prefix);
  return url.origin === prefix.origin && url.pathname.startsWith(prefix.pathname) ? url.href : undefined;
}
