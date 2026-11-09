// `@goodfellow-cms/core/server` runs on Cloudflare Workers, which have no files to read or programs to start, so
// nothing it loads may need Node: this follows every module it imports, as a bundler for workerd would.

import { readFile } from "node:fs/promises";
import { builtinModules } from "node:module";
import { dirname, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = import.meta.dirname;

/** Packages that need Node, which only `@goodfellow-cms/core/node` and the other Node entries load. */
const NODE_ONLY = ["sigstore", "pagefind", "happy-dom", "fontaine", "axe-core", "typescript"];

/** What a module imports, leaving out `import type` and `export type`, which bundlers drop. */
function importsOf(source: string): string[] {
  const found: string[] = [];
  const statements = /^\s*(?:import|export)\s+(?!type\s)(?:[^"';]*?\sfrom\s*)?["']([^"']+)["']/gm;
  for (const match of source.matchAll(statements)) found.push(match[1] ?? "");
  for (const match of source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) found.push(match[1] ?? "");
  return found;
}

/** Every module `entry` loads, by its path in `src/`, and the packages they import. */
async function graph(entry: string): Promise<{ modules: string[]; packages: Set<string> }> {
  const seen = new Set<string>();
  const packages = new Set<string>();
  const queue = [join(SRC, entry)];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const specifier of importsOf(await readFile(file, "utf8"))) {
      if (specifier.startsWith(".")) queue.push(join(dirname(file), specifier.replace(/\.js$/, ".ts")));
      else packages.add(specifier);
    }
  }
  return { modules: [...seen].map((file) => relative(SRC, file)), packages };
}

describe("@goodfellow-cms/core/server", () => {
  it("finds the modules and packages a module imports", () => {
    expect(
      importsOf(
        [
          'import { a } from "./a.js";',
          'import type { B } from "./b.js";',
          'export { c } from "./c.js";',
          'export type { D } from "./d.js";',
          'import "./e.js";',
          'const f = await import("node:fs");',
          "import {\n  g,\n  type H,\n} from 'htmlparser2';",
        ].join("\n"),
      ),
    ).toEqual(["./a.js", "./c.js", "./e.js", "htmlparser2", "node:fs"]);
  });

  it("loads nothing that needs Node", async () => {
    const { modules, packages } = await graph("server.ts");
    expect(modules).toContain("server-app-api.ts");
    expect(modules).toContain("index.ts");
    expect(modules.filter((module) => /(^|\/)node[-.]/.test(module))).toEqual([]);
    const builtins = new Set(builtinModules);
    const needsNode = [...packages].filter(
      (name) =>
        name.startsWith("node:") ||
        builtins.has(name) ||
        NODE_ONLY.some((pkg) => name === pkg || name.startsWith(`${pkg}/`)),
    );
    expect(needsNode).toEqual([]);
  });
});
