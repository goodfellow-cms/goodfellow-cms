import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Alias, createServer, type ViteDevServer } from "vite";
import type { ClientModules } from "./islands.js";
import { slashes } from "./islands.js";

/**
 * Islands with Preact. Where every Client Component of a site says it works
 * with Preact (`worksWithPreact`), `goodfellow build` runs them with
 * `preact/compat` in place of React: in the browser, with these aliases in
 * the islands' bundle, and where pages are built, with a server of its own
 * that renders each island with Preact, so `useId()` gives the same ids on
 * both sides. Pages themselves are still rendered by React.
 */

/** One of this package's Preact modules (`src/preact/`), built beside this file, or as TypeScript in its tests. */
function own(name: string): string {
  const built = fileURLToPath(new URL(`./preact/${name}.js`, import.meta.url));
  return slashes(existsSync(built) ? built : built.replace(/\.js$/, ".ts"));
}

/** A module of Preact's, as `import` resolves it, from this package's own copy. */
function preact(specifier: string): string {
  return slashes(fileURLToPath(import.meta.resolve(specifier)));
}

/** What React's modules are where islands run with Preact. */
export function preactAliases(): Alias[] {
  return [
    { find: /^react$/, replacement: own("react") },
    { find: /^react-dom\/client$/, replacement: own("react-dom-client") },
    { find: /^react-dom$/, replacement: preact("preact/compat") },
    { find: /^react\/jsx-runtime$/, replacement: preact("preact/compat/jsx-runtime") },
    { find: /^react\/jsx-dev-runtime$/, replacement: preact("preact/compat/jsx-dev-runtime") },
  ];
}

/** Packages whose `react` must be Preact, since they use React or are Preact: those that depend on these. */
const REACT_PACKAGES = ["react", "react-dom", "preact"];

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/** A package's folder, as it's found from `from`, or `undefined` if it isn't installed. */
function packageDir(name: string, from: string): string | undefined {
  try {
    return dirname(createRequire(join(from, "package.json")).resolve(`${name}/package.json`));
  } catch {
    return undefined;
  }
}

/**
 * The packages that use React, of the site's and of those it uses in turn,
 * with Preact's own: where islands are rendered with Preact, Vite loads these
 * itself, so their `react` is Preact. Node loads the rest, as it does where
 * pages are rendered, since some, such as CommonJS ones, can't go through Vite.
 */
export function reactPackages(root: string): string[] {
  const found = new Set(["preact", "preact-render-to-string", "@goodfellow-cms/react"]);
  const seen = new Set<string>();
  const queue: Array<{ name: string; from: string }> = [];
  const visit = (pkg: PackageJson, dir: string) => {
    for (const name of Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })) {
      queue.push({ name, from: dir });
    }
  };
  try {
    visit(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), root);
  } catch {
    // A site without a package.json uses nothing but its own files.
  }
  while (queue.length > 0) {
    const { name, from } = queue.shift() as { name: string; from: string };
    const dir = packageDir(name, from);
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    let pkg: PackageJson;
    try {
      pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
    } catch {
      continue;
    }
    const names = Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies });
    if (!REACT_PACKAGES.includes(name) && names.some((dependency) => REACT_PACKAGES.includes(dependency))) {
      found.add(name);
    }
    // React itself, and what only React uses, never load here.
    if (!REACT_PACKAGES.includes(name)) visit(pkg, dir);
  }
  return [...found].sort();
}

/** The renderer `setIslandRenderer()` takes, as `@goodfellow-cms/react/island` declares it. */
type IslandRenderer = (island: {
  module: string;
  name: string;
  props: unknown;
  site: unknown;
  prefix: string;
  slots: { marker: string; tag: string };
}) => Promise<string>;

/**
 * Has the server that renders pages (`pages`) render islands with Preact, from
 * a server of its own that loads the site's Client Components with React as
 * `preact/compat`. Returns what stops it, which puts React's renderer back.
 */
export async function preactIslands(
  root: string,
  modules: ClientModules,
  pages: ViteDevServer,
): Promise<() => Promise<void>> {
  const server = await createServer({
    root,
    configFile: false,
    envDir: false,
    cacheDir: `${root}/node_modules/.vite-preact`,
    logLevel: "warn",
    appType: "custom",
    server: { middlewareMode: true, hmr: false, ws: false, watch: null },
    resolve: { alias: [{ find: /^@\//, replacement: `${slashes(root)}/` }, ...preactAliases()] },
    ssr: { noExternal: reactPackages(root) },
  });
  const { renderIsland } = (await server.ssrLoadModule(own("render"))) as {
    renderIsland(component: unknown, props: unknown, site: unknown, prefix: string, slots: unknown): Promise<string>;
  };
  const islands = (await pages.ssrLoadModule("@goodfellow-cms/react/island")) as {
    setIslandRenderer(render: IslandRenderer | undefined): void;
  };
  islands.setIslandRenderer(async ({ module, name, props, site, prefix, slots }) => {
    const file = modules.get(module);
    if (!file) throw new Error(`No Client Component module named ${module}.`);
    const loaded = (await server.ssrLoadModule(file)) as Record<string, unknown>;
    return renderIsland(loaded[name], props, site, prefix, slots);
  });
  return async () => {
    islands.setIslandRenderer(undefined);
    await server.close();
  };
}
