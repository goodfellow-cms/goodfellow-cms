import { existsSync, readFileSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { type Alias, build, type ViteDevServer } from "vite";
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

/**
 * Packages islands never render, though they're imported on the way, which
 * are left to Node with React: Puck, which `@goodfellow-cms/react` imports
 * for pages and the editor, and would take seconds to load through Vite.
 */
const NEVER_ISLANDS = ["@puckeditor/core"];

interface PackageJson {
  name?: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

/**
 * A package's folder, found from `from` as Node finds it, in the nearest
 * `node_modules` folder that has it, or `undefined` if it isn't installed.
 * Not with `require.resolve()`, since many packages' `exports` leave their
 * `package.json` out.
 */
function packageDir(name: string, from: string): string | undefined {
  for (let dir = from; ; dir = dirname(dir)) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return realpathSync(candidate);
    if (dirname(dir) === dir) return undefined;
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
    if (NEVER_ISLANDS.includes(name)) continue;
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

/** The bundle of islands for rendering them with Preact, written where the site's packages are found from. */
const SERVER_BUNDLE_DIR = "node_modules/.goodfellow/preact-islands";

/** A bare import's package name: `@radix-ui/react-tabs/dist` → `@radix-ui/react-tabs`. */
function packageName(id: string): string | undefined {
  const match = /^((?:@[\w.-]+\/)?[\w.-]+)/.exec(id);
  return match && !id.startsWith(".") && !id.startsWith("/") ? match[1] : undefined;
}

/**
 * Has the server that renders pages (`pages`) render islands with Preact: the
 * site's Client Components are bundled for the server as they are for the
 * browser, with React as `preact/compat`, and each island is rendered from
 * that bundle. Packages that use React are bundled with them, so their
 * `react` is Preact; packages that don't, which the site can import itself,
 * are left to Node, as where pages are rendered. Returns what stops it, which
 * puts React's renderer back.
 */
export async function preactIslands(
  root: string,
  modules: ClientModules,
  pages: ViteDevServer,
): Promise<() => Promise<void>> {
  const usesReact = new Set(reactPackages(root));
  const outDir = join(root, SERVER_BUNDLE_DIR);
  const entry = "virtual:goodfellow/preact-islands";
  const loaders = [...modules].map(
    ([name, file]) => `  ${JSON.stringify(name)}: () => import(${JSON.stringify(slashes(file))}),`,
  );
  await build({
    root,
    configFile: false,
    envDir: false,
    logLevel: "warn",
    plugins: [
      {
        name: "goodfellow:preact-islands",
        enforce: "pre",
        resolveId: (id) => (id === entry ? `\0${entry}` : undefined),
        load: (id) =>
          id === `\0${entry}`
            ? `export { renderIsland } from ${JSON.stringify(own("render"))};\nexport const modules = {\n${loaders.join("\n")}\n};\n`
            : undefined,
      },
    ],
    resolve: { alias: [{ find: /^@\//, replacement: `${slashes(root)}/` }, ...preactAliases()] },
    ssr: { noExternal: true },
    build: {
      ssr: true,
      outDir,
      emptyOutDir: true,
      rolldownOptions: {
        input: { islands: entry },
        output: { entryFileNames: "islands.mjs" },
        // Packages that don't use React, and that Node finds from the bundle's folder: the site's own.
        external: (id) => {
          if (id.startsWith("node:")) return true;
          const name = packageName(id);
          // React's own modules are the aliases' Preact, which the bundle has.
          if (!name || REACT_PACKAGES.includes(name) || usesReact.has(name) || name.startsWith("preact")) return false;
          return NEVER_ISLANDS.includes(name) || packageDir(name, root) !== undefined;
        },
        onLog(level, log, handler) {
          if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
          handler(level, log);
        },
      },
    },
  });
  const bundle = (await import(pathToFileURL(join(outDir, "islands.mjs")).href)) as {
    renderIsland(component: unknown, props: unknown, site: unknown, prefix: string, slots: unknown): Promise<string>;
    modules: Record<string, () => Promise<Record<string, unknown>>>;
  };
  const islands = (await pages.ssrLoadModule("@goodfellow-cms/react/island")) as {
    setIslandRenderer(render: IslandRenderer | undefined): void;
  };
  islands.setIslandRenderer(async ({ module, name, props, site, prefix, slots }) => {
    const load = bundle.modules[module];
    if (!load) throw new Error(`No Client Component module named ${module}.`);
    return bundle.renderIsland((await load())[name], props, site, prefix, slots);
  });
  return async () => {
    islands.setIslandRenderer(undefined);
    await rm(outDir, { recursive: true, force: true });
  };
}
