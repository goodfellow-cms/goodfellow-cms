import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, extname, join, relative } from "node:path";
import { type Plugin, parseAst } from "vite";

/**
 * A string as a JavaScript literal, for building modules. Module names and
 * paths come from the site's files, so `<`, `>` and line separators are
 * escaped too, and the code can't be read as anything else wherever it ends up.
 */
function jsString(value: string): string {
  return JSON.stringify(value).replace(
    /[<>\u2028\u2029]/g,
    (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/** The browser's entry for pages with Client Components: it loads each one a page uses and runs it. */
export const ISLANDS_ENTRY = "virtual:goodfellow/islands";
const RESOLVED_ISLANDS_ENTRY = `\0${ISLANDS_ENTRY}`;

/** The dev server's address for the islands entry. */
export const ISLANDS_DEV_URL = `/@id/__x00__${ISLANDS_ENTRY}`;

/** What server-rendered modules import instead of a Client Component's module: its exports, as islands. */
const ISLAND_PREFIX = "\0goodfellow-island:";

/** The site's `"use client"` modules, by the name pages refer to them by, with their files. */
export type ClientModules = Map<string, string>;

/** Packages that render pages, whose own `"use client"` modules are never islands. */
const RENDERERS = ["@goodfellow-cms/react", "@puckeditor/core", "react", "react-dom"];

/** Goodfellow's own packages that use `@goodfellow-cms/react` without being block packs. */
const NOT_BLOCK_PACKS = new Set([
  "@goodfellow-cms/react",
  "@goodfellow-cms/admin",
  "@goodfellow-cms/next",
  "goodfellow",
]);

const SCRIPT = /\.[cm]?[jt]sx?$/;

/** A path with forward slashes, as Vite writes module ids on Windows too (`C:/site/blocks/a.tsx`). */
export function slashes(path: string): string {
  return path.replaceAll("\\", "/");
}

/** A path to compare: forward slashes, and a Windows drive letter in lowercase, since tools differ in both. */
function comparable(path: string): string {
  return slashes(path).replace(/^[A-Za-z]:/, (drive) => drive.toLowerCase());
}

/** Whether a file is inside a folder, whichever slashes either path uses. */
export function insideDir(file: string, dir: string): boolean {
  return comparable(file).startsWith(`${comparable(dir).replace(/\/$/, "")}/`);
}

/** Whether a file is in an installed package, whichever slashes it uses. */
export function inNodeModules(file: string): boolean {
  return slashes(file).split("/").includes("node_modules");
}

function packageDir(root: string, name: string): string | undefined {
  try {
    const require = createRequire(join(root, "package.json"));
    return realpathSync(dirname(require.resolve(`${name}/package.json`)));
  } catch {
    return undefined;
  }
}

function readJson(file: string): Record<string, Record<string, string> | undefined> {
  return JSON.parse(readFileSync(file, "utf8"));
}

/**
 * The site's block packs: its packages that build on `@goodfellow-cms/react`.
 * Vite loads them itself rather than leaving them to Node, so their Client
 * Components become islands like the site's own.
 */
export function blockPackages(root: string): string[] {
  let pkg: ReturnType<typeof readJson>;
  try {
    pkg = readJson(join(root, "package.json"));
  } catch {
    return [];
  }
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  return names.filter((name) => {
    if (NOT_BLOCK_PACKS.has(name)) return false;
    const dir = packageDir(root, name);
    if (!dir) return false;
    try {
      const dependency = readJson(join(dir, "package.json"));
      return Boolean(
        dependency.dependencies?.["@goodfellow-cms/react"] ?? dependency.peerDependencies?.["@goodfellow-cms/react"],
      );
    } catch {
      return false;
    }
  });
}

// biome-ignore lint/suspicious/noExplicitAny: ESTree nodes from Vite's parser
type Node = any;

function bindingNames(pattern: Node): string[] {
  switch (pattern?.type) {
    case "Identifier":
      return [pattern.name];
    case "ObjectPattern":
      return pattern.properties.flatMap((property: Node) =>
        bindingNames(property.type === "RestElement" ? property.argument : property.value),
      );
    case "ArrayPattern":
      return pattern.elements.flatMap((element: Node) => (element ? bindingNames(element) : []));
    case "RestElement":
      return bindingNames(pattern.argument);
    case "AssignmentPattern":
      return bindingNames(pattern.left);
    default:
      return [];
  }
}

function exportName(node: Node): string {
  return node.type === "Literal" ? String(node.value) : node.name;
}

function parse(code: string, file: string): Node {
  const extension = extname(file).replace(/^\.[cm]?/, ".");
  const lang = extension === ".ts" ? "ts" : extension === ".tsx" ? "tsx" : "jsx";
  return parseAst(code, { lang });
}

function hasUseClient(program: Node): boolean {
  for (const statement of program.body) {
    if (statement.type !== "ExpressionStatement" || typeof statement.directive !== "string") return false;
    if (statement.directive === "use client") return true;
  }
  return false;
}

export interface ClientModuleExports {
  /** The module's exports that hold values, by name. */
  names: string[];
  /** Whether it also has `export * from …`, whose names aren't known without loading the other module. */
  star: boolean;
  /** Whether it says it works with Preact as well as React: `export const worksWithPreact = true`. */
  preact: boolean;
}

/** What a Client Component's module exports to say it works with Preact's `preact/compat` as well as React. */
export const PREACT_EXPORT = "worksWithPreact";

/** The names a declaration gives `true`, as in `const worksWithPreact = true`. */
function trueConstants(declaration: Node): string[] {
  if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") return [];
  return declaration.declarations
    .filter(
      (declarator: Node) =>
        declarator.id?.type === "Identifier" && declarator.init?.type === "Literal" && declarator.init.value === true,
    )
    .map((declarator: Node) => declarator.id.name as string);
}

/**
 * The exports of a module whose source starts with `"use client"`, leaving out
 * TypeScript's types. Returns `undefined` for other modules.
 */
export function clientModuleExports(code: string, file: string): ClientModuleExports | undefined {
  if (!code.includes("use client")) return undefined;
  const program = parse(code, file);
  if (!hasUseClient(program)) return undefined;

  const names: string[] = [];
  let star = false;
  let preact = false;
  // `const worksWithPreact = true`, exported where it's declared or, as bundlers write it, in `export { … }`.
  const constants = new Set((program.body as Node[]).flatMap(trueConstants));
  for (const node of program.body as Node[]) {
    if (node.type === "ExportNamedDeclaration") {
      if (node.exportKind === "type" || node.declaration?.declare) continue;
      const declaration = node.declaration;
      if (trueConstants(declaration).includes(PREACT_EXPORT)) preact = true;
      for (const specifier of node.specifiers ?? []) {
        if (
          !node.source &&
          exportName(specifier.exported) === PREACT_EXPORT &&
          constants.has(exportName(specifier.local))
        ) {
          preact = true;
        }
      }
      if (declaration?.type === "VariableDeclaration") {
        names.push(...declaration.declarations.flatMap((declarator: Node) => bindingNames(declarator.id)));
      } else if (declaration?.id) {
        names.push(declaration.id.name);
      }
      for (const specifier of node.specifiers ?? []) {
        if (specifier.exportKind !== "type") names.push(exportName(specifier.exported));
      }
    } else if (node.type === "ExportDefaultDeclaration") {
      names.push("default");
    } else if (node.type === "ExportAllDeclaration" && node.exportKind !== "type") {
      if (node.exported) names.push(exportName(node.exported));
      else star = true;
    }
  }
  return { names, star, preact };
}

/**
 * The site's Client Components that don't say they work with Preact, by the
 * name pages refer to them by. Where there are none, and the config doesn't
 * say otherwise, `goodfellow build` runs islands with Preact.
 */
export function needReact(modules: ClientModules): string[] {
  return [...modules]
    .filter(([, file]) => {
      try {
        return !clientModuleExports(readFileSync(file, "utf8"), file)?.preact;
      } catch {
        return true;
      }
    })
    .map(([name]) => name);
}

/** A name as it's written in `export { … }`, quoted unless it's an identifier. */
function identifier(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : jsString(name);
}

/**
 * The module server-rendered blocks get in place of a Client Component's:
 * each export wrapped in `island()`, which renders it as an island. Client
 * Components that import each other get the module itself, as in the browser.
 */
export function islandModule(file: string, name: string, exports: ClientModuleExports): string {
  const lines = [
    `import * as __gf_module from ${jsString(file)};`,
    `import { island as __gf_island } from "@goodfellow-cms/react/island";`,
  ];
  exports.names.forEach((exported, index) => {
    lines.push(
      `const __gf_export${index} = __gf_island(__gf_module[${jsString(exported)}], ${jsString(name)}, ${jsString(exported)});`,
      `export { __gf_export${index} as ${identifier(exported)} };`,
    );
  });
  // Names re-exported with `export *` aren't known here, so they're passed on as they are.
  if (exports.star) lines.push(`export * from ${jsString(file)};`);
  return `${lines.join("\n")}\n`;
}

/**
 * Finds the site's Client Components (`"use client"` modules) and turns them
 * into islands on server-rendered pages, and serves the browser's entry that
 * runs them. The modules it finds go into `modules`, which the build shares
 * between the server that renders pages and the browser build.
 */
export function islandsPlugin(root: string, modules: ClientModules): Plugin {
  const renderers = RENDERERS.map((name) => packageDir(root, name)).filter((dir) => dir !== undefined);
  const blockPacks = blockPackages(root)
    .map((name) => packageDir(root, name))
    .filter((dir) => dir !== undefined);
  /** Each file's exports if it's a Client Component's module, read again when the file changes. */
  const cache = new Map<string, { mtime: number; exports: ClientModuleExports | undefined }>();
  let invalidateEntry = () => {};

  function clientExports(file: string): ClientModuleExports | undefined {
    if (!SCRIPT.test(file) || renderers.some((dir) => insideDir(file, dir))) return undefined;
    if (inNodeModules(file) && !blockPacks.some((dir) => insideDir(file, dir))) return undefined;
    let mtime: number;
    try {
      mtime = statSync(file).mtimeMs;
    } catch {
      return undefined;
    }
    const cached = cache.get(file);
    if (cached?.mtime === mtime) return cached.exports;
    let exports: ClientModuleExports | undefined;
    try {
      exports = clientModuleExports(readFileSync(file, "utf8"), file);
    } catch {
      // Vite reports the file's syntax errors when it loads the file itself.
      exports = undefined;
    }
    cache.set(file, { mtime, exports });
    return exports;
  }

  /** Lists a Client Component's module in the browser's entry, which a page that uses it loads. */
  function remember(file: string) {
    const name = slashes(relative(root, file));
    if (modules.get(name) === file) return;
    modules.set(name, file);
    invalidateEntry();
  }

  return {
    name: "goodfellow:islands",
    // Before Vite's own resolver, which would otherwise resolve imports of Client Components' modules first.
    enforce: "pre",
    configureServer(server) {
      invalidateEntry = () => {
        const { moduleGraph } = server.environments.client;
        const entry = moduleGraph.getModuleById(RESOLVED_ISLANDS_ENTRY);
        if (entry) moduleGraph.invalidateModule(entry);
      };
    },

    async resolveId(source, importer, options) {
      if (source === ISLANDS_ENTRY) return RESOLVED_ISLANDS_ENTRY;
      if (this.environment.config.consumer !== "server" || !importer || importer.startsWith(ISLAND_PREFIX)) {
        return undefined;
      }
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const file = resolved.id.split("?")[0] ?? resolved.id;
      // Only where a server-rendered module imports a Client Component's module: inside it, it's all one component.
      if (!clientExports(file) || clientExports(importer.split("?")[0] ?? importer)) return resolved;
      // Here as well as in `load`, since a module deleted and written again, such as a block removed and added back,
      // can keep its island module from before, which isn't loaded again.
      remember(file);
      return `${ISLAND_PREFIX}${file}`;
    },

    // A removed Client Component, such as a removed block's, leaves the browser's entry, which would fail to load otherwise.
    watchChange(id, change) {
      if (change.event !== "delete") return;
      for (const [name, file] of modules) {
        if (file === id || slashes(file) === slashes(id)) {
          modules.delete(name);
          invalidateEntry();
        }
      }
    },

    load(id) {
      if (id === RESOLVED_ISLANDS_ENTRY) {
        for (const [name, file] of modules) if (!existsSync(file)) modules.delete(name);
        // Each module is loaded only on pages that use it.
        const loaders = [...modules].map(([name, file]) => `  ${jsString(name)}: () => import(${jsString(file)}),`);
        return [
          `import { hydrateIslands } from "@goodfellow-cms/react/hydrate";`,
          "hydrateIslands({",
          ...loaders,
          "});",
        ].join("\n");
      }
      if (!id.startsWith(ISLAND_PREFIX)) return undefined;
      const file = id.slice(ISLAND_PREFIX.length);
      const exports = clientExports(file);
      // Changes to the module's exports change this one.
      this.addWatchFile(file);
      if (!exports) return `export * from ${jsString(file)};\n`;
      remember(file);
      return islandModule(file, slashes(relative(root, file)), exports);
    },
  };
}
