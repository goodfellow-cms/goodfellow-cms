/**
 * Moving content between Goodfellow sites on disk: `goodfellow export site`
 * writes the zip the admin panel's **Download a copy** makes, with its
 * manifest, and `goodfellow import site` brings one, or its unpacked folder,
 * into a site with `planSiteImport()`, as the admin panel does.
 */
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { unzipSync, zipSync } from "fflate";
import { loadSiteContent } from "./content/load.js";
import { MEDIA_DIR } from "./content/paths.js";
import type { FileChange } from "./content/store.js";
import { fileSystemSource } from "./node-fs-source.js";
import { localFileStore } from "./node-local-files.js";
import { parseInstalledPlugins } from "./plugin-packages.js";
import {
  planSiteImport,
  type SiteImport,
  type SiteImportNote,
  type SiteImportOptions,
  TRANSFER_FOLDERS,
  TRANSFER_RECORDS,
  transferManifestFile,
  transferName,
  transferPaths,
} from "./site-transfer.js";
import { unsafeMediaChanges } from "./svg-check.js";

/** Why an export can't be written or read. */
export class SiteTransferError extends Error {
  override name = "SiteTransferError";
  constructor(
    readonly problem: "exists" | "not-found" | "not-a-site",
    readonly path: string,
  ) {
    super(
      problem === "exists"
        ? `${path} is already there. Name another file, or move that one first.`
        : problem === "not-found"
          ? `There's no file or folder at ${path}.`
          : `${path} isn't an export of a Goodfellow site: it has no content/site.json or content/pages/.`,
    );
  }
}

export interface ExportSiteResult {
  file: string;
  /** Content files and records. */
  files: number;
  media: number;
  /** Media a storage plugin keeps, which isn't in it. */
  stored: number;
}

/** The files an export holds: the content and media folders, and the records the site has. */
async function exportedPaths(root: string): Promise<string[]> {
  const source = fileSystemSource(root);
  const folders = await Promise.all(TRANSFER_FOLDERS.map((dir) => source.list(dir)));
  const records: string[] = [];
  for (const path of TRANSFER_RECORDS) {
    if (await stat(join(root, path)).catch(() => undefined)) records.push(path);
  }
  return [...new Set([...folders.flat(), ...records])].sort();
}

/**
 * Writes the site's content, media and records as a zip, with its manifest,
 * for `importSite()` or the admin panel's import to bring into another site.
 * `file` defaults to one named after the site; it has to be new.
 */
export async function exportSite(
  root: string,
  file?: string,
  { now = new Date() }: { now?: Date } = {},
): Promise<ExportSiteResult> {
  const content = await loadSiteContent(fileSystemSource(root));
  const target = resolve(file ?? transferName(content.settings.title, now));
  if (await stat(target).catch(() => undefined)) throw new SiteTransferError("exists", target);
  const paths = await exportedPaths(root);
  const entries: Record<string, Uint8Array> = {};
  for (const path of paths) entries[path] = new Uint8Array(await readFile(join(root, path)));
  const manifest = transferManifestFile(content, { now });
  entries[manifest.path] = new TextEncoder().encode(manifest.content);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, zipSync(entries, { level: 6 }));
  const media = paths.filter((path) => path.startsWith(`${MEDIA_DIR}/`)).length;
  return {
    file: target,
    files: paths.length - media,
    media,
    stored: Object.keys(content.mediaStorage?.files ?? {}).length,
  };
}

export function formatSiteExport(result: ExportSiteResult, from = process.cwd()): string {
  const near = relative(from, result.file);
  const lines = [
    `Wrote ${near && !near.startsWith("..") ? near : result.file}, with ${plural(result.files, "content file")} and ${plural(result.media, "media file")}.`,
    "Bring it into another Goodfellow site with `goodfellow import site`, or on Site Settings → Import.",
  ];
  if (result.stored > 0) {
    lines.push(
      `${plural(result.stored, "media file")} your storage service keeps isn't in it: pages link to where it's kept.`,
    );
  }
  return lines.join("\n");
}

export interface ImportSiteOptions
  extends Pick<
    SiteImportOptions,
    "replace" | "menus" | "settings" | "layout" | "redirects" | "withoutMissingBlocks" | "installing"
  > {
  /** The site's blocks, by name, from its config. */
  blocks: readonly string[];
  /** Which version of what both have differently to keep when adding: the site's (the default) or the export's. */
  take?: "site" | "export";
  /** Works out what would change without writing anything. */
  dryRun?: boolean;
  log?: (line: string) => void;
}

export interface ImportSiteResult {
  plan: SiteImport;
  /** Media left out because it isn't safe on the site's address. */
  unsafe: string[];
  /** Whose version of what both have differently was kept. */
  took: "site" | "export";
  written: boolean;
}

/** Every file in a folder, by its path in it with forward slashes. */
async function folderFiles(folder: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) found.push(relative(folder, path).split(sep).join("/"));
    }
  };
  await walk(folder);
  return found;
}

/**
 * Brings an export of another Goodfellow site, a zip or its unpacked folder,
 * into the site at `root`, as the admin panel's import does, and writes the
 * changes to disk, to publish with git. Media that isn't safe on the site's
 * address is left out.
 */
export async function importSite(root: string, from: string, options: ImportSiteOptions): Promise<ImportSiteResult> {
  const found = await stat(from).catch(() => undefined);
  if (!found) throw new SiteTransferError("not-found", from);
  const archive = new Map<string, Uint8Array>();
  if (found.isDirectory()) {
    for (const path of await folderFiles(from)) archive.set(path, new Uint8Array(await readFile(join(from, path))));
  } else {
    for (const [path, bytes] of Object.entries(unzipSync(new Uint8Array(await readFile(from)))))
      archive.set(path, bytes);
  }
  const paths = transferPaths([...archive.keys()]);
  if (paths.size === 0) throw new SiteTransferError("not-a-site", from);
  const bytesOf = (path: string) => {
    const at = paths.get(path);
    return at === undefined ? undefined : archive.get(at);
  };
  const decoder = new TextDecoder();
  const files = {
    paths: [...paths.keys()],
    read: (path: string) => {
      const bytes = bytesOf(path);
      return bytes && decoder.decode(bytes);
    },
  };

  const source = fileSystemSource(root);
  const content = await loadSiteContent(source);
  const siteFiles = (await Promise.all(TRANSFER_FOLDERS.map((dir) => source.list(dir)))).flat();
  const sameMedia = new Set<string>();
  for (const path of files.paths.filter((path) => path.startsWith(`${MEDIA_DIR}/`) && siteFiles.includes(path))) {
    const mine = new Uint8Array(await readFile(join(root, path)));
    const theirs = bytesOf(path);
    if (theirs && mine.length === theirs.length && mine.every((byte, index) => byte === theirs[index]))
      sameMedia.add(path);
  }
  const unsafe = unsafeMediaChanges(
    files.paths.flatMap((path): FileChange[] => {
      const bytes = path.startsWith(`${MEDIA_DIR}/`) ? bytesOf(path) : undefined;
      return bytes ? [{ path, bytes }] : [];
    }),
  );
  let plugins: string[] = [];
  try {
    plugins = Object.keys(parseInstalledPlugins(await source.read("plugins/installed/installed.json")).plugins);
  } catch {
    // A record that can't be read names no plugins.
  }
  const { take, dryRun, log, ...choices } = options;
  const site = { content, files: siteFiles, read: (path: string) => source.read(path) };
  const planned = (chosen: ReadonlySet<string>) =>
    planSiteImport(files, site, { ...choices, plugins, sameMedia, uncopied: new Set(unsafe), take: chosen });
  let plan = await planned(new Set());
  // Taking the export's version can bring up more to choose, such as a collection's items once it's taken whole.
  for (let round = 0; take === "export" && round < 3; round += 1) {
    const keys = new Set(plan.conflicts.map((conflict) => conflict.key));
    plan = await planned(keys);
    if (plan.conflicts.every((conflict) => keys.has(conflict.key))) break;
  }
  const took = take ?? "site";
  if (dryRun) return { plan, unsafe, took, written: false };

  const media: FileChange[] = plan.media.flatMap((path) => {
    const bytes = bytesOf(path);
    return bytes ? [{ path, bytes }] : [];
  });
  const store = localFileStore(root);
  await store.write([...plan.changes, ...media], {
    expectedRevision: await store.revision(),
    message: `Import ${plan.summary.title || "another site"}`,
  });
  for (const change of plan.changes) log?.(`${"delete" in change ? "Removed" : "Wrote"} ${change.path}`);
  for (const change of media) log?.(`Copied ${change.path}`);
  return { plan, unsafe, took, written: true };
}

function noteLine(note: SiteImportNote): string {
  const list = (items: string[]) =>
    items.length > 5 ? `${items.slice(0, 5).join(", ")} and ${items.length - 5} more` : items.join(", ");
  switch (note.kind) {
    case "missing-block":
      return `${note.name} isn't one of this site's blocks${note.installable ? " (add it from Goodfellow's registry on the Blocks screen)" : ""}. It's used on ${list(note.items)}.`;
    case "left-out":
      return `Left out, since they use blocks this site doesn't have: ${list(note.items)}. Add the blocks, or import with --without-missing-blocks.`;
    case "without-blocks":
      return `Brought in without the blocks this site doesn't have: ${list(note.items)}.`;
    case "taken":
      return `Left out, since this site has something else at their addresses: ${list(note.items)}.`;
    case "collection-differs":
      return `This site's ${list(note.collections)} has other fields, so the export's items in it are left out. Import with --take export to replace it with the export's.`;
    case "uncopied":
      return `Left out, since they aren't safe to show on the site: ${list(note.files)}.`;
    case "stored-media":
      return note.merged
        ? `${plural(note.count, "media file")} the export's storage keeps are listed in this site's storage, which is the same.`
        : `${plural(note.count, "media file")} the export's storage service keeps isn't copied: pages link to where it's kept.`;
    case "languages":
      return `Added the export's languages to Site Settings: ${note.codes.join(", ")}.`;
    case "plugins":
      return `The export's site used plugins this site doesn't have: ${list(note.names)}.`;
    case "code":
      return "Custom code came in. It runs on every page, so check it.";
    case "kept": {
      const names = {
        address: "the Site address",
        limits: "editors' limits",
        updates: "update settings",
        storage: "media storage settings",
      };
      return `Kept this site's own ${note.things.map((thing) => names[thing]).join(", ")}.`;
    }
  }
}

export function formatSiteImport(result: ImportSiteResult): string {
  const { summary, conflicts, notes } = result.plan;
  const lines = [
    `${result.written ? "Imported" : "Would import"} ${summary.title || "the export"}:`,
    `- ${plural(summary.pages, "page")}`,
    `- ${plural(summary.items, "collection item")}${summary.collections ? `, in ${plural(summary.collections, "new collection")}` : ""}`,
    `- ${plural(summary.syncedBlocks, "synced block")}`,
    `- ${plural(summary.media, "media file")}`,
  ];
  const also = [
    summary.menus && "menus",
    summary.settings && "Site Settings",
    summary.layout && "the header and footer",
    summary.redirects && "redirects",
  ].filter(Boolean);
  if (also.length) lines.push(`- ${also.join(", ")}`);
  if (summary.removed) lines.push(`- ${plural(summary.removed, "file")} removed`);
  if (conflicts.length) {
    lines.push(
      "",
      result.took === "export"
        ? "Took the export's version of what this site has differently:"
        : "Kept this site's version of what the export has differently (import with --take export for the export's):",
      ...conflicts.map((conflict) => `- ${conflict.name}${conflict.detail ? ` (${conflict.detail})` : ""}`),
    );
  }
  if (notes.length) lines.push("", "Check these:", ...notes.map((note) => `- ${noteLine(note)}`));
  if (result.written) lines.push("", "Check the site with `goodfellow dev`, then publish the changes with git.");
  return lines.join("\n");
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
