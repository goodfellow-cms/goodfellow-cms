import {
  allPages,
  type Collection,
  type ContentSource,
  type Entry,
  entryTitle,
  type FileChange,
  FOOTER_FILE,
  HEADER_FILE,
  loadSiteContent,
  type Page,
  type SiteContent,
  type SyncedBlock,
  syncedBlockUses,
} from "@goodfellow-cms/core";
import type { Config, Data } from "@puckeditor/core";
import { entryFileChange, layoutFileChange, pageFileChange, pageTitle, syncedBlockFileChange } from "./changes.js";

/** A content file whose earlier versions can be seen and restored. */
export type VersionSubject =
  | { kind: "page"; file: string; page: Page }
  | { kind: "header" | "footer"; file: string }
  | { kind: "entry"; file: string; collection: Collection; entry: Entry }
  /** A synced block, or its own version in one of the site's other languages. */
  | { kind: "synced"; file: string; block: SyncedBlock; language?: string };

/** What a content file is in the site: a page, the header or footer, an item in a collection or a synced block. */
export function versionSubject(content: SiteContent, file: string): VersionSubject | undefined {
  if (file === HEADER_FILE) return { kind: "header", file };
  if (file === FOOTER_FILE) return { kind: "footer", file };
  const page = content.pages.find((candidate) => candidate.file === file);
  if (page) return { kind: "page", file, page };
  for (const collection of content.collections) {
    const entry = collection.entries.find((candidate) => candidate.file === file);
    if (entry) return { kind: "entry", file, collection, entry };
  }
  for (const block of content.syncedBlocks ?? []) {
    if (block.file === file) return { kind: "synced", file, block };
    for (const [language, own] of Object.entries(block.languages ?? {})) {
      if (own.file === file) return { kind: "synced", file, block, language };
    }
  }
  return undefined;
}

/** A page's or item's title, or `undefined` for the header and footer, which are named by the admin panel. */
export function subjectTitle(subject: VersionSubject): string | undefined {
  if (subject.kind === "page") return pageTitle(subject.page);
  if (subject.kind === "entry") return entryTitle(subject.entry);
  if (subject.kind === "synced") return syncedContent(subject).title;
  return undefined;
}

/** A synced block's file as the subject names it: the main language's, or another language's own. */
function syncedContent(subject: Extract<VersionSubject, { kind: "synced" }>) {
  return (subject.language && subject.block.languages?.[subject.language]?.content) || subject.block.content;
}

/**
 * The site as it would be with one file put back as it was in an earlier
 * version. It's loaded like the site itself, so a version that no longer fits,
 * such as an item with a field that's since been removed, throws `ContentError`.
 */
export function contentWithVersion(source: ContentSource, file: string, text: string): Promise<SiteContent> {
  return loadSiteContent({
    read: (path) => (path === file ? Promise.resolve(text) : source.read(path)),
    list: (dir) => source.list(dir),
  });
}

/** The change that publishes the subject as it is in `content`, in canonical form. */
export function restoreChange(content: SiteContent, subject: VersionSubject): FileChange {
  switch (subject.kind) {
    case "page":
      // As the version was, schedule and all.
      return pageFileChange(subject.page.path, subject.page.content.data as Data, subject.page.content);
    case "header":
    case "footer":
      return layoutFileChange(subject.file, content[subject.kind].data as Data);
    case "entry": {
      // Fields removed since the version was published go, as they went from every item then.
      const names = new Set(subject.collection.settings.fields.map((field) => field.name));
      const fields = Object.entries(subject.entry.content.fields).filter(([name]) => names.has(name));
      return entryFileChange(subject.collection, subject.entry.slug, Object.fromEntries(fields), subject.entry.content);
    }
    case "synced": {
      const shown = syncedContent(subject);
      return syncedBlockFileChange(subject.block.name, shown.title, shown.data as Data, subject.language);
    }
  }
}

/**
 * The page that shows the subject: the page itself, an item's page, for a synced block the first page that places
 * it, or for the header and footer, the home page.
 */
export function previewPage(content: SiteContent, subject: VersionSubject): Page | undefined {
  switch (subject.kind) {
    case "page":
      return subject.page;
    case "entry":
      return allPages(content).find(
        (page) => page.entry?.collection === subject.collection.id && page.entry.slug === subject.entry.slug,
      );
    case "synced": {
      const use = syncedBlockUses(content, subject.block.name).find((found) => found.kind === "page");
      const page = use && content.pages.find((found) => found.file === use.file);
      if (page) return page;
      return content.pages.find((found) => found.path === "/") ?? content.pages[0];
    }
    default:
      return content.pages.find((page) => page.path === "/") ?? content.pages[0];
  }
}

/** The Puck data a version keeps, which can only be restored if the site still has its blocks. */
export function subjectData(content: SiteContent, subject: VersionSubject): Data | undefined {
  if (subject.kind === "page") return subject.page.content.data as Data;
  if (subject.kind === "header" || subject.kind === "footer") return content[subject.kind].data as Data;
  if (subject.kind === "synced") return syncedContent(subject).data as Data;
  return undefined;
}

/** The names of blocks that Puck data uses, including inside other blocks, that `config` doesn't have. */
export function unknownBlocks(data: unknown, config: Config): string[] {
  const unknown = new Set<string>();
  const visit = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!value || typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    if (typeof record.type === "string" && record.props && typeof record.props === "object") {
      if (!(record.type in config.components)) unknown.add(record.type);
    }
    for (const item of Object.values(record)) visit(item);
  };
  visit(data);
  return [...unknown].sort();
}
