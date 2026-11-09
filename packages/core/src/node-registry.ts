import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/**
 * The built registry from the site's `@goodfellow-cms/registry` package, which the
 * admin panel installs from in development. The site may only have it through
 * `@goodfellow-cms/admin`, so it's looked for there too.
 */
export function localRegistryDir(root: string): string | undefined {
  const fromRoot = createRequire(join(root, "package.json"));
  // Not named `require`, which bundlers' CommonJS transforms take for Node's own and fail on (vinext's, in the
  // company example).
  for (const from of [() => fromRoot, () => createRequire(fromRoot.resolve("@goodfellow-cms/admin/package.json"))]) {
    try {
      return join(dirname(from().resolve("@goodfellow-cms/registry/package.json")), "r");
    } catch {
      // Not found from here.
    }
  }
  return undefined;
}
