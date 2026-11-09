import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import { DEV_EDITOR_PREFIX, pluginId } from "@goodfellow-cms/core";
import { editorFramesOptions, siteConfigFile, writeEditorFramesPage } from "./editor-frames.js";
import { buildPluginFrame, loadSiteConfig } from "./plugins.js";

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

/** How long the editor's frames stay as built before the admin panel reloads them. */
const REBUILT_DELAY = 300;

const TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  map: "application/json",
  json: "application/json",
};

export async function startDevEditor(root: string): Promise<DevEditor> {
  siteConfigFile(root);
  const outDir = join(root, "node_modules/.goodfellow/next-editor");
  await mkdir(outDir, { recursive: true });
  // Loaded only here, so builds never load the bundler.
  const { watch } = await import("rolldown");

  // Stylesheets the editor's modules import, put in one file beside the script.
  const stylesheets = new Set<string>();
  let version = 0;
  let built: () => void = () => {};
  const ready = new Promise<void>((resolveReady) => {
    built = resolveReady;
  });

  // A change such as adding a block writes several files, which can take several builds: the frames
  // reload once, after the last.
  let counting: ReturnType<typeof setTimeout> | undefined;
  const writePage = async () => {
    await writeEditorFramesPage(outDir, stylesheets);
    counting = setTimeout(
      () => {
        version += 1;
        void writeFile(join(outDir, "version.json"), JSON.stringify({ version }));
      },
      version === 0 ? 0 : REBUILT_DELAY,
    );
  };

  const watcher = watch(editorFramesOptions(root, outDir, { development: true, stylesheets }));
  watcher.on("event", (event) => {
    if (event.code === "BUNDLE_START") {
      clearTimeout(counting);
    } else if (event.code === "BUNDLE_END") {
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

  // Plugins' admin frames, beside the editor's (`pluginFrameUrl()`), each built the first time it's asked for,
  // from the config as it is then, and rebuilt as its code changes.
  const pluginsDir = join(root, "node_modules/.goodfellow/next-plugins");
  const pluginsPrefix = DEV_EDITOR_PREFIX.replace(/editor\/$/, "plugins/");
  const pluginBuilds = new Map<string, Promise<boolean>>();
  const pluginFrame = (id: string): Promise<boolean> => {
    let ready = pluginBuilds.get(id);
    if (!ready) {
      ready = (async () => {
        const plugin = (await loadSiteConfig(root)).plugins?.find(
          (candidate) => pluginId(candidate.name) === id && candidate.admin,
        );
        if (!plugin) {
          pluginBuilds.delete(id);
          return false;
        }
        await new Promise<void>((done) => {
          buildPluginFrame(plugin, {
            root,
            dir: join(pluginsDir, id),
            watch: {
              onBuilt(error) {
                if (error) console.error(`${plugin.title}'s admin frame couldn't be built: ${error.message}`);
                done();
              },
            },
          }).catch((error: Error) => {
            console.error(`${plugin.title}'s admin frame couldn't be built: ${error.message}`);
            done();
          });
        });
        return true;
      })();
      pluginBuilds.set(id, ready);
    }
    return ready;
  };

  return {
    async serve(req, res) {
      // Next.js passes the frames' page on without its trailing slash.
      const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
      if (pathname.startsWith(pluginsPrefix) && (req.method === "GET" || req.method === "HEAD")) {
        const [id = "", ...rest] = decodeURIComponent(pathname.slice(pluginsPrefix.length)).split("/");
        const file = resolve(pluginsDir, id, rest.join("/") || "index.html");
        if (!file.startsWith(`${pluginsDir}${sep}`) || !(await pluginFrame(id))) return false;
        try {
          const data = await readFile(file);
          res.setHeader("Content-Type", TYPES[file.slice(file.lastIndexOf(".") + 1)] ?? "application/octet-stream");
          res.setHeader("Cache-Control", "no-store");
          res.end(req.method === "HEAD" ? undefined : data);
        } catch {
          res.writeHead(404).end();
        }
        return true;
      }
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
