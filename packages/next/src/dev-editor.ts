import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import { DEV_EDITOR_PREFIX, EDITOR_PRELUDE, editorPage } from "@goodfellow-cms/core";

/**
 * The editor's frames in `next dev`. They're sandboxed with `allow-scripts`
 * alone, so their origin is `null`, and Next.js refuses its development
 * files to every `null` origin, whose requests carry no address to check. So
 * `next dev` doesn't serve them: the site's config, Puck and every block are
 * bundled here as one classic script, as `goodfellow build` bundles them,
 * rebuilt as the site's code changes, and served by the local backend.
 */
export interface DevEditor {
  /** Answers the frames' requests, under `DEV_EDITOR_PREFIX`. */
  serve(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

const CONFIG_FILES = ["goodfellow.config.tsx", "goodfellow.config.ts", "goodfellow.config.jsx", "goodfellow.config.js"];
const ENTRY = "\0goodfellow:next-editor";
const TAILWIND_BROWSER = "tailwind-browser.js";

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  map: "application/json",
  json: "application/json",
};

export async function startDevEditor(root: string): Promise<DevEditor> {
  const configFile = CONFIG_FILES.map((name) => join(root, name)).find((file) => existsSync(file));
  if (!configFile) throw new Error(`No goodfellow.config.tsx in ${root}.`);
  const outDir = join(root, "node_modules/.goodfellow/next-editor");
  await mkdir(outDir, { recursive: true });
  // Loaded only here, so builds never load the bundler.
  const [{ watch }, { default: tailwindBrowser }] = await Promise.all([
    import("rolldown"),
    import("./generated/tailwind-browser.js"),
  ]);
  await writeFile(join(outDir, TAILWIND_BROWSER), tailwindBrowser);

  // Stylesheets the editor's modules import, put in one file beside the script.
  const stylesheets = new Set<string>();
  let version = 0;
  let built: () => void = () => {};
  const ready = new Promise<void>((resolveReady) => {
    built = resolveReady;
  });

  const writePage = async () => {
    const css = await Promise.all([...stylesheets].map((file) => readFile(file, "utf8")));
    await writeFile(join(outDir, "editor.css"), css.join("\n"));
    await writeFile(join(outDir, "index.html"), editorPage({ scripts: ["editor.js"], stylesheets: ["editor.css"] }));
    version += 1;
    await writeFile(join(outDir, "version.json"), JSON.stringify({ version }));
  };

  const watcher = watch({
    input: { editor: ENTRY },
    cwd: root,
    platform: "browser",
    // The site's own paths, such as `@/components/ui/button`.
    tsconfig: existsSync(join(root, "tsconfig.json")) ? join(root, "tsconfig.json") : false,
    transform: {
      jsx: { runtime: "automatic" },
      define: { "process.env.NODE_ENV": JSON.stringify("development") },
    },
    plugins: [
      {
        name: "goodfellow:next-editor",
        resolveId: (id) => (id === ENTRY ? id : undefined),
        load(id) {
          if (id === ENTRY) {
            return [
              `import config from ${JSON.stringify(configFile)};`,
              `import { mountEditorFrame } from "@goodfellow-cms/admin/editor";`,
              `import "@puckeditor/core/puck.css";`,
              `import "@goodfellow-cms/admin/styles.css";`,
              `mountEditorFrame(config, undefined, { tailwindBrowserUrl: ${JSON.stringify(TAILWIND_BROWSER)} });`,
            ].join("\n");
          }
          if (id.endsWith(".css")) {
            stylesheets.add(id);
            return { code: "", moduleType: "js" };
          }
          return undefined;
        },
      },
    ],
    onLog(level, log, handler) {
      // React libraries mark modules "use client", which only matters to server-component bundlers.
      if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
      handler(level, log);
    },
    output: {
      dir: outDir,
      format: "iife",
      codeSplitting: false,
      entryFileNames: "editor.js",
      banner: EDITOR_PRELUDE,
      sourcemap: true,
    },
  });
  watcher.on("event", (event) => {
    if (event.code === "BUNDLE_END") {
      void event.result.close();
      writePage().then(built, (error: Error) => {
        console.error(`The editor's frames couldn't be written: ${error.message}`);
        built();
      });
    } else if (event.code === "ERROR") {
      void event.result?.close();
      console.error(`The editor's frames couldn't be built: ${event.error.message}`);
      built();
    }
  });

  return {
    async serve(req, res) {
      // Next.js passes the frames' page on without its trailing slash.
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      const page = pathname === DEV_EDITOR_PREFIX.slice(0, -1);
      if (!(page || pathname.startsWith(DEV_EDITOR_PREFIX)) || (req.method !== "GET" && req.method !== "HEAD")) {
        return false;
      }
      await ready;
      const name = page ? "index.html" : pathname.slice(DEV_EDITOR_PREFIX.length) || "index.html";
      const file = resolve(outDir, name);
      if (!file.startsWith(`${outDir}${sep}`)) return false;
      try {
        const data = await readFile(file);
        res.setHeader("Content-Type", TYPES[file.slice(file.lastIndexOf(".") + 1)] ?? "application/octet-stream");
        res.setHeader("Cache-Control", "no-store");
        res.end(req.method === "HEAD" ? undefined : data);
      } catch {
        res.writeHead(404).end();
      }
      return true;
    },
  };
}
