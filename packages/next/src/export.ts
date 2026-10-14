import { access, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { allPages, calendarFiles, loadSiteContent, redirectFiles } from "@goodfellow-cms/core";
import { fileSystemSource } from "@goodfellow-cms/core/node";

/**
 * Writes the calendar files of the site's collections of events into the
 * export, as `goodfellow build` does: Next.js has no route for them. Returns
 * how many it wrote.
 */
export async function writeCalendarFiles(outDir: string, root = process.cwd()): Promise<number> {
  const files = calendarFiles(await loadSiteContent(fileSystemSource(resolve(root))));
  for (const file of files) {
    const target = join(outDir, file.path.slice(1));
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  return files.length;
}

/** The `basePath` the export was built with, which Next.js records in `.next/routes-manifest.json`. */
async function exportBasePath(root: string): Promise<string> {
  try {
    const manifest = JSON.parse(await readFile(join(root, ".next/routes-manifest.json"), "utf8")) as {
      basePath?: unknown;
    };
    return typeof manifest.basePath === "string" ? manifest.basePath : "";
  } catch {
    return "";
  }
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

/**
 * Writes a page at each of the site's old addresses that sends visitors on, as
 * `goodfellow build` does. Pages win: an address the export has a page at keeps
 * it. Returns how many it wrote.
 */
export async function writeRedirectFiles(outDir: string, root = process.cwd()): Promise<number> {
  const dir = resolve(root);
  const content = await loadSiteContent(fileSystemSource(dir));
  const files = redirectFiles(content, {
    taken: allPages(content).map((page) => page.path),
    base: await exportBasePath(dir),
  });
  let written = 0;
  for (const file of files) {
    const target = join(outDir, file.path.slice(1));
    // Next.js writes pages as `about.html`, such as ones blocks add.
    const page = join(outDir, `${file.path.replace(/\/index\.html$/, "")}.html`);
    if ((await exists(target)) || (await exists(page))) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
    written++;
  }
  return written;
}

/**
 * Puts a static export's prefetch files where the browser asks for them.
 * Next.js names each after its segment path with `/` turned into `.`
 * (`__next.$oc$path.__PAGE__.txt`), but on Windows the path has `\` instead, so
 * the export writes folders (`__next.$oc$path/__PAGE__.txt`), and every
 * prefetch is "not found". Returns how many files it moved; none elsewhere.
 */
export async function fixSegmentFiles(outDir: string): Promise<number> {
  let moved = 0;
  async function visit(dir: string) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name === "_next") continue;
      const path = join(dir, entry.name);
      if (!entry.name.startsWith("__next.")) {
        await visit(path);
        continue;
      }
      for (const file of await readdir(path, { recursive: true, withFileTypes: true })) {
        if (!file.isFile()) continue;
        const source = join(file.parentPath, file.name);
        const parts = relative(path, source).split(/[\\/]/);
        await rename(source, join(dir, [entry.name, ...parts].join(".")));
        moved++;
      }
      await rm(path, { recursive: true, force: true });
    }
  }
  await visit(outDir);
  return moved;
}
