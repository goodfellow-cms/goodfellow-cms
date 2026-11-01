/**
 * Imports a WordPress site into a site on disk, as `goodfellow import
 * wordpress`, `goodfellow-next import wordpress` and `create-goodfellow
 * --wordpress` do: from an export file or the site's address, with the media
 * its pages and posts use downloaded into `public/media/`. Also writes a site
 * on disk as a WordPress export file, as `goodfellow export wordpress` does,
 * and imports folders of Markdown files, as `goodfellow import markdown` does.
 */
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import {
  exifOrientation,
  extensionOf,
  type FileChange,
  loadSiteContent,
  MAX_UPLOAD_BYTES,
  MEDIA_DIR,
  withoutImageDetails,
} from "./index.js";
import { fileSystemSource } from "./node-fs-source.js";
import { localFileStore } from "./node-local-files.js";
import {
  fetchWordPressSite,
  type MarkdownFolderUse,
  type MarkdownImport,
  type MarkdownImportNote,
  type MarkdownImportOptions,
  planMarkdownImport,
  planWordPressImport,
  readWordPressExport,
  type WordPressExport,
  type WordPressExportNote,
  type WordPressImport,
  type WordPressImportNote,
  type WordPressSite,
  wordPressExport,
  wordPressExportName,
} from "./wordpress.js";

/** How many media files are downloaded at once. */
const DOWNLOADS = 4;

type Fetch = typeof fetch;

export interface ImportWordPressOptions {
  fetch?: Fetch;
  /** Plans the import and downloads nothing, writing no files. */
  dryRun?: boolean;
  /** Called with a line of progress, such as each file downloaded. */
  log?(line: string): void;
}

export type MediaSkipReason = "type" | "size" | "download";

export interface ImportWordPressResult {
  plan: WordPressImport;
  /** Media copied into `public/media/`, by its WordPress address. */
  copied: string[];
  /** Media that wasn't, which pages show from the WordPress site instead. */
  skipped: Array<{ url: string; reason: MediaSkipReason }>;
  /** Whether files were written: not for a dry run. */
  written: boolean;
}

/** Reads a WordPress site from an export file's path or the site's address. */
export async function readWordPressSource(from: string, fetcher: Fetch = fetch): Promise<WordPressSite> {
  const isFile = await stat(from).then(
    (found) => found.isFile(),
    () => false,
  );
  if (isFile) return readWordPressExport(await readFile(from, "utf8"));
  return fetchWordPressSite(from, { fetch: fetcher });
}

/**
 * Removes what a JPEG keeps about where and how it was taken (its Exif and
 * IPTC details), as the admin panel's uploads do by re-saving photos. A photo
 * whose Exif turns it, which only Exif can say, keeps its details.
 */
export function withoutJpegDetails(bytes: Uint8Array): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const kept: Uint8Array[] = [bytes.subarray(0, 2)];
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1] ?? 0;
    // The image data starts here, and runs to the end.
    if (marker === 0xda) break;
    const length = ((bytes[at + 2] ?? 0) << 8) | (bytes[at + 3] ?? 0);
    const segment = bytes.subarray(at, at + 2 + length);
    if (marker === 0xe1 && turned(segment)) return bytes;
    if (marker !== 0xe1 && marker !== 0xed) kept.push(segment);
    at += 2 + length;
  }
  kept.push(bytes.subarray(at));
  const result = new Uint8Array(kept.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of kept) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}

/** Whether an Exif segment says the photo is shown turned or flipped. */
function turned(segment: Uint8Array): boolean {
  return (exifOrientation(segment) ?? 1) > 1;
}

async function download(url: string, fetcher: Fetch): Promise<{ bytes: Uint8Array } | { reason: MediaSkipReason }> {
  let response: Response;
  try {
    response = await fetcher(url);
  } catch {
    return { reason: "download" };
  }
  if (!response.ok) return { reason: "download" };
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > MAX_UPLOAD_BYTES) return { reason: "size" };
  const extension = extensionOf(url);
  if (["jpg", "jpeg"].includes(extension)) return { bytes: withoutJpegDetails(bytes) };
  return { bytes: ["png", "webp"].includes(extension) ? withoutImageDetails(bytes) : bytes };
}

/**
 * Imports a WordPress site into the site at `root`. SVG images aren't copied,
 * since only the admin panel can make them safe, and nor are files over the
 * upload limit; pages show those from the WordPress site.
 */
export async function importWordPress(
  root: string,
  from: string,
  options: ImportWordPressOptions = {},
): Promise<ImportWordPressResult> {
  const fetcher = options.fetch ?? fetch;
  const site = await readWordPressSource(from, fetcher);
  const source = fileSystemSource(root);
  const content = await loadSiteContent(source);
  const mediaFiles = await source.list(MEDIA_DIR);
  const first = planWordPressImport(site, content, { mediaFiles });
  if (options.dryRun) return { plan: first, copied: [], skipped: [], written: false };

  const files = new Map<string, Uint8Array>();
  const skipped: ImportWordPressResult["skipped"] = [];
  const queue = first.media.filter((copy) => {
    if (extensionOf(copy.path) !== "svg") return true;
    skipped.push({ url: copy.url, reason: "type" });
    return false;
  });
  await Promise.all(
    Array.from({ length: DOWNLOADS }, async () => {
      for (let copy = queue.shift(); copy; copy = queue.shift()) {
        const result = await download(copy.url, fetcher);
        if ("bytes" in result) {
          files.set(copy.url, result.bytes);
          options.log?.(`Copied ${copy.path}`);
        } else {
          skipped.push({ url: copy.url, reason: result.reason });
        }
      }
    }),
  );

  const plan = planWordPressImport(site, content, { mediaFiles, copied: new Set(files.keys()) });
  const media: FileChange[] = plan.media.flatMap((copy) => {
    const bytes = files.get(copy.url);
    return bytes ? [{ path: copy.path, bytes }] : [];
  });
  const store = localFileStore(root);
  await store.write([...plan.changes, ...media], {
    expectedRevision: await store.revision(),
    message: `Import ${site.title || "a WordPress site"} from WordPress`,
  });
  return { plan, copied: [...files.keys()], skipped, written: true };
}

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
/** A verb that agrees with a count: `are(1, "is", "are")`. */
const verb = (count: number, one: string, many: string) => (count === 1 ? one : many);

function noteLine(note: WordPressImportNote): string {
  switch (note.kind) {
    case "left-out": {
      const what: Record<string, string> = {
        drafts: "drafts and pages waiting for review",
        private: "private pages and posts",
        trash: "pages and posts in the trash",
        comments: "comments",
      };
      return `Left out ${plural(note.count, "item")}: ${what[note.what] ?? `WordPress content of the kind "${note.what}"`}.`;
    }
    case "converted": {
      const where =
        note.items.slice(0, 3).join(", ") + (note.items.length > 3 ? ` and ${note.items.length - 3} more` : "");
      const what: Record<string, string> = {
        block: `The "${note.name}" block, from another plugin, was brought across as its text and pictures`,
        dropped: `The "${note.name}" block shows something only WordPress has, so it was left out`,
        shortcode: `The [${note.name}] shortcode only works in WordPress, so it was left out`,
        embed: `Something from ${note.name} is now a link to it`,
        form: "A form was left out; add a Form block in its place",
        script: "A script was left out",
        table: "A table became text, since the site has no Table block",
        posts: "A list of the latest posts was left out of a post",
        video: "A video is now a link to it, since posts show videos as links",
      };
      return `${what[note.note] ?? note.name}: ${where}.`;
    }
    case "old-links":
      return `${plural(note.urls.length, "link")} still ${verb(note.urls.length, "goes", "go")} to the WordPress site, to pages that weren't imported, such as ${note.urls[0]}.`;
    case "not-copied":
      return `${plural(note.urls.length, "media file")} couldn't be copied, so pages show ${verb(note.urls.length, "it", "them")} from the WordPress site, such as ${note.urls[0]}.`;
    case "unused-media":
      return `${plural(note.count, "file")} in the media library ${verb(note.count, "isn't", "aren't")} used by any page or post, so ${verb(note.count, "it wasn't", "they weren't")} copied.`;
    case "no-menus":
      return "Menus can't be read from a site's address, so the main menu lists the top-level pages. Import an export file to bring the menus across.";
  }
}

/** What an import did, in words, for the command line. */
export function formatWordPressImport(result: ImportWordPressResult): string {
  const { summary } = result.plan;
  const lines = [
    result.written ? "Imported from WordPress:" : "Importing from WordPress would bring across:",
    `- ${plural(summary.pages.length, "page")}${summary.replaced.length ? `, replacing ${summary.replaced.join(", ")}` : ""}`,
    ...(summary.collection
      ? [
          `- ${plural(summary.posts, "post")} in the "${summary.collection.id}" collection, at ${summary.collection.path}${summary.listPath ? `, listed on ${summary.listPath}` : ""}`,
        ]
      : []),
    ...(summary.categories || summary.tags
      ? [`- ${plural(summary.categories, "category", "categories")} and ${plural(summary.tags, "tag")}`]
      : []),
    ...(summary.menus.length ? [`- Menus: ${summary.menus.join(", ")}`] : []),
    ...(summary.syncedBlocks?.length
      ? [
          `- ${plural(summary.syncedBlocks.length, "synced block")} from synced patterns: ${summary.syncedBlocks.join(", ")}`,
        ]
      : []),
    ...(summary.redirects ? [`- ${plural(summary.redirects, "redirect")} from old addresses`] : []),
    `- ${plural(result.written ? result.copied.length : result.plan.media.length, "media file")}`,
  ];
  const notes = result.plan.notes.map(noteLine);
  const skippedSvg = result.skipped.filter((skip) => skip.reason === "type").length;
  const skippedBig = result.skipped.filter((skip) => skip.reason === "size").length;
  if (skippedSvg)
    notes.push(
      `${plural(skippedSvg, "SVG image")} ${verb(skippedSvg, "wasn't", "weren't")} copied; upload ${verb(skippedSvg, "it", "them")} in the admin panel, which makes ${verb(skippedSvg, "it", "them")} safe.`,
    );
  if (skippedBig)
    notes.push(
      `${plural(skippedBig, "file")} ${verb(skippedBig, "was", "were")} over the 25 MB upload limit, so ${verb(skippedBig, "it wasn't", "they weren't")} copied.`,
    );
  if (notes.length) lines.push("", "Check these:", ...notes.map((note) => `- ${note}`));
  return lines.join("\n");
}

export interface ExportWordPressResult {
  /** Where the export file was written. */
  file: string;
  export: WordPressExport;
}

/**
 * Writes the site at `root` as a WordPress export file, at `file` or, by
 * default, a file named after the site in the current folder.
 */
export async function exportWordPress(
  root: string,
  file?: string,
  options: { now?: Date } = {},
): Promise<ExportWordPressResult> {
  const source = fileSystemSource(root);
  const content = await loadSiteContent(source);
  const result = wordPressExport(content, { mediaFiles: await source.list(MEDIA_DIR), now: options.now });
  const written = resolve(file ?? wordPressExportName(content));
  await writeFile(written, result.xml);
  return { file: written, export: result };
}

const listed = (items: string[]) =>
  items.slice(0, 3).join(", ") + (items.length > 3 ? ` and ${items.length - 3} more` : "");

function exportNoteLine(note: WordPressExportNote): string {
  switch (note.kind) {
    case "left-out-block":
      return `WordPress has nothing like the ${note.name} block, so it was left out: ${listed(note.items)}.`;
    case "no-pages":
      return `${listed(note.collections)} ${verb(note.collections.length, "has", "have")} no pages of ${verb(note.collections.length, "its", "their")} own, so ${verb(note.collections.length, "its", "their")} items weren't exported.`;
    case "hidden":
      return `${plural(note.items.length, "page or post", "pages and posts")} ${verb(note.items.length, "is", "are")} hidden by ${verb(note.items.length, "its", "their")} schedule, so ${verb(note.items.length, "it's", "they're")} exported as ${verb(note.items.length, "a draft", "drafts")}: ${listed(note.items)}.`;
    case "redirects":
      return `${plural(note.count, "redirect")} from old addresses ${verb(note.count, "isn't", "aren't")} in the file, since WordPress needs a plugin for redirects.`;
    case "no-address":
      return "The site has no address in Site Settings, so WordPress can't download its media. Set it, then export again.";
    case "layout":
      return "The header and footer aren't in the file: WordPress's theme shows its own, with the menus.";
  }
}

/** What an export wrote, in words, for the command line. */
export function formatWordPressExport(result: ExportWordPressResult, from = process.cwd()): string {
  const { summary, notes } = result.export;
  const near = relative(from, result.file);
  const shown = near && !near.startsWith("..") ? near : result.file;
  const lines = [
    `Wrote ${shown}, a WordPress export file with:`,
    `- ${plural(summary.pages, "page")}`,
    `- ${plural(summary.posts, "post")}${summary.categories || summary.tags ? `, with ${plural(summary.categories, "category", "categories")} and ${plural(summary.tags, "tag")}` : ""}`,
    `- ${plural(summary.menus, "menu")}`,
    `- ${plural(summary.media, "media file")}, which WordPress downloads from the site`,
    "",
    'Import it in WordPress with Tools → Import → WordPress, and check "Download and import file attachments".',
  ];
  if (notes.length) lines.push("", "Check these:", ...notes.map((note) => `- ${exportNoteLine(note)}`));
  return lines.join("\n");
}

/** Folders never read from a Markdown folder: tools' own and hidden ones. */
const SKIPPED_FOLDERS = new Set(["node_modules", "dist", "_site"]);

export interface ImportMarkdownOptions
  extends Pick<MarkdownImportOptions, "folders" | "replaceHome" | "replacePages" | "drafts" | "menu" | "keepFields"> {
  /** Plans the import and copies nothing, writing no files. */
  dryRun?: boolean;
  log?(line: string): void;
}

export interface ImportMarkdownResult {
  plan: MarkdownImport;
  /** The files in the folder, by their paths in it. */
  files: string[];
  /** Media copied into `public/media/`, by its path in the folder. */
  copied: string[];
  /** Media that wasn't: SVGs, which only the admin panel can make safe, and files over the upload limit. */
  skipped: Array<{ file: string; reason: "type" | "size" }>;
  written: boolean;
}

/** Every file under a folder, by its path in it with `/` between folders, leaving out hidden folders and tools' own. */
async function folderFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(folder, join(entry.parentPath, entry.name)).split(sep).join("/"))
    .filter((path) => !path.split("/").some((part) => part.startsWith(".") || SKIPPED_FOLDERS.has(part)))
    .sort();
}

/**
 * Imports a folder of Markdown files into the site at `root`, as `goodfellow
 * import markdown` does, with the pictures and files they use copied into
 * `public/media/`, as uploads are: JPEGs without their details, and no SVGs
 * or files over the upload limit.
 */
export async function importMarkdown(
  root: string,
  folder: string,
  options: ImportMarkdownOptions = {},
): Promise<ImportMarkdownResult> {
  const found = await stat(folder).catch(() => undefined);
  if (!found?.isDirectory()) throw new MarkdownFolderError(folder);
  const files = await folderFiles(folder);
  const texts = new Map<string, string>();
  for (const file of files.filter((file) => /\.(md|markdown|mdx)$/i.test(file))) {
    texts.set(file, await readFile(join(folder, file), "utf8"));
  }
  const source = fileSystemSource(root);
  const content = await loadSiteContent(source);
  const mediaFiles = await source.list(MEDIA_DIR);
  const { dryRun, log, ...choices } = options;
  const plan = (copied?: ReadonlySet<string>) =>
    planMarkdownImport(files, (file) => texts.get(file), content, {
      ...choices,
      mediaFiles,
      ...(copied && { copied }),
    });
  const first = plan();
  if (dryRun) return { plan: first, files, copied: [], skipped: [], written: false };

  const bytes = new Map<string, Uint8Array>();
  const skipped: ImportMarkdownResult["skipped"] = [];
  for (const copy of first.media) {
    const extension = extensionOf(copy.file);
    if (extension === "svg") {
      skipped.push({ file: copy.file, reason: "type" });
      continue;
    }
    const read = new Uint8Array(await readFile(join(folder, copy.file)));
    if (read.length > MAX_UPLOAD_BYTES) {
      skipped.push({ file: copy.file, reason: "size" });
      continue;
    }
    bytes.set(
      copy.file,
      ["jpg", "jpeg"].includes(extension)
        ? withoutJpegDetails(read)
        : ["png", "webp"].includes(extension)
          ? withoutImageDetails(read)
          : read,
    );
    log?.(`Copied ${copy.path}`);
  }
  const final = plan(new Set(bytes.keys()));
  const media: FileChange[] = final.media.flatMap((copy) => {
    const read = bytes.get(copy.file);
    return read ? [{ path: copy.path, bytes: read }] : [];
  });
  const store = localFileStore(root);
  await store.write([...final.changes, ...media], {
    expectedRevision: await store.revision(),
    message: "Import Markdown files",
  });
  return { plan: final, files, copied: [...bytes.keys()], skipped, written: true };
}

/** Thrown when the folder to import from isn't one. */
export class MarkdownFolderError extends Error {
  override name = "MarkdownFolderError";

  constructor(readonly folder: string) {
    super(`There's no folder at ${folder}. Give the folder the Markdown files are in.`);
  }
}

function markdownNoteLine(note: MarkdownImportNote): string {
  const files = "files" in note ? listed(note.files) : "";
  switch (note.kind) {
    case "drafts":
      return `Left out ${plural(note.files.length, "draft")}: ${files}. Use --drafts to import ${verb(note.files.length, "it", "them")} too.`;
    case "taken":
      return `Left out ${plural(note.files.length, "file")} at addresses the site already has: ${files}. Use --replace-pages (or --replace-home for index.md) to put ${verb(note.files.length, "it", "them")} in their place.`;
    case "front-matter":
      return `The front matter of ${files} couldn't be read, so ${verb(note.files.length, "it was", "they were")} imported without it.`;
    case "missing-links":
      return `Links to files or pages the import doesn't have are now just their words, in ${files}.`;
    case "missing-media":
      return `Pictures or files the folder doesn't have were left out of ${files}.`;
    case "not-copied":
      return `${plural(note.files.length, "file")} couldn't be copied, so ${verb(note.files.length, "it was", "they were")} left out: ${files}.`;
    case "template-code":
      return `Another site's template code, such as {{< … >}} or {% … %}, shows as written in ${files}.`;
    case "html":
      return `HTML in ${files} shows as text, since items keep their Markdown.`;
    case "fields":
      return `Front matter left out: ${listed(note.names)}. Use --keep-fields to keep ${verb(note.names.length, "it", "them")} as fields.`;
    case "converted":
      return `Something in ${files} was simplified (${note.note}: ${note.name}).`;
  }
}

/** What a Markdown import did, in words, for the command line. */
export function formatMarkdownImport(result: ImportMarkdownResult): string {
  const { summary } = result.plan;
  const lines = [
    result.written ? "Imported the Markdown files:" : "Importing the Markdown files would bring across:",
    `- ${plural(summary.pages.length, "page")}${summary.replaced.length ? `, replacing ${summary.replaced.join(", ")}` : ""}`,
    ...summary.collections.map(
      (collection) =>
        `- ${plural(collection.items, "item")} in the "${collection.id}" collection, at ${collection.path}${collection.list ? `, listed on ${collection.list}` : ""}`,
    ),
    ...(summary.menu ? [`- ${plural(summary.menu, "page")} added to the main menu`] : []),
    ...(summary.redirects ? [`- ${plural(summary.redirects, "redirect")} from old addresses`] : []),
    `- ${plural(result.written ? result.copied.length : result.plan.media.length, "media file")}`,
  ];
  const notes = result.plan.notes.map(markdownNoteLine);
  const svg = result.skipped.filter((skip) => skip.reason === "type").length;
  if (svg) {
    notes.push(
      `${plural(svg, "SVG image")} ${verb(svg, "wasn't", "weren't")} copied; upload ${verb(svg, "it", "them")} in the admin panel, which makes ${verb(svg, "it", "them")} safe.`,
    );
  }
  if (notes.length) lines.push("", "Check these:", ...notes.map((note) => `- ${note}`));
  return lines.join("\n");
}

/**
 * How folders are imported, from the commands' `--pages` and `--collection`
 * options, each naming a folder at the top, or `.` for the files at the top.
 */
export function markdownFolderChoices(
  pages: readonly string[] = [],
  collections: readonly string[] = [],
): Record<string, MarkdownFolderUse> {
  const name = (folder: string) => (folder === "." ? "" : folder.replace(/^\.\//, "").replace(/\/+$/, ""));
  return {
    ...Object.fromEntries(pages.map((folder) => [name(folder), "pages" as const])),
    ...Object.fromEntries(collections.map((folder) => [name(folder), "collection" as const])),
  };
}
