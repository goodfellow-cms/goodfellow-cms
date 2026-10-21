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
} from "@goodfellow-cms/core";
import type { Config, Data } from "@puckeditor/core";
import { entryFileChange, layoutFileChange, pageFileChange, pageTitle } from "./changes.js";

/** A content file whose earlier versions can be seen and restored. */
export type VersionSubject =
  | { kind: "page"; file: string; page: Page }
  | { kind: "header" | "footer"; file: string }
  | { kind: "entry"; file: string; collection: Collection; entry: Entry };

/** What a content file is in the site: a page, the header or footer, or an item in a collection. */
export function versionSubject(content: SiteContent, file: string): VersionSubject | undefined {
  if (file === HEADER_FILE) return { kind: "header", file };
  if (file === FOOTER_FILE) return { kind: "footer", file };
  const page = content.pages.find((candidate) => candidate.file === file);
  if (page) return { kind: "page", file, page };
  for (const collection of content.collections) {
    const entry = collection.entries.find((candidate) => candidate.file === file);
    if (entry) return { kind: "entry", file, collection, entry };
  }
  return undefined;
}

/** A page's or item's title, or `undefined` for the header and footer, which are named by the admin panel. */
export function subjectTitle(subject: VersionSubject): string | undefined {
  if (subject.kind === "page") return pageTitle(subject.page);
  if (subject.kind === "entry") return entryTitle(subject.entry);
  return undefined;
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
  }
}

/** The page that shows the subject: the page itself, an item's page, or for the header and footer, the home page. */
export function previewPage(content: SiteContent, subject: VersionSubject): Page | undefined {
  switch (subject.kind) {
    case "page":
      return subject.page;
    case "entry":
      return allPages(content).find(
        (page) => page.entry?.collection === subject.collection.id && page.entry.slug === subject.entry.slug,
      );
    default:
      return content.pages.find((page) => page.path === "/") ?? content.pages[0];
  }
}

/** The Puck data a version keeps, which can only be restored if the site still has its blocks. */
export function subjectData(content: SiteContent, subject: VersionSubject): Data | undefined {
  if (subject.kind === "page") return subject.page.content.data as Data;
  if (subject.kind === "header" || subject.kind === "footer") return content[subject.kind].data as Data;
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
