/**
 * The whole site's history: the publishes that changed its content or media,
 * what has changed since one of them, and the changes that put the site back
 * as it was then, in one publish.
 */
import type { FileVersion, GitBackend, RevisionFiles } from "../git.js";
import type { Collection, Entry } from "./collections.js";
import { type ContentSource, type Page, readTextFiles, type SiteContent } from "./load.js";
import {
  BODY_CODE_FILE,
  CONTENT_DIR,
  CUSTOM_CSS_FILE,
  FOOTER_FILE,
  HEAD_CODE_FILE,
  HEADER_FILE,
  MEDIA_DIR,
  MEDIA_FILE,
  MENUS_FILE,
  REDIRECTS_FILE,
  SITE_FILE,
  THEME_FILE,
  UPDATES_FILE,
} from "./paths.js";
import type { FileChange } from "./store.js";

/** The folders a whole-site restore puts back: the content and the media. */
export const SITE_FOLDERS = [CONTENT_DIR, MEDIA_DIR] as const;

/**
 * Whether restoring the whole site puts a file back. Everything in the content
 * and media folders is, except the update settings, which are about the
 * site's code: going back to an older list of releases to skip could install
 * one again.
 */
export function isRestoredPath(path: string): boolean {
  if (path === UPDATES_FILE) return false;
  return SITE_FOLDERS.some((folder) => path.startsWith(`${folder}/`));
}

/** The whole site's publishes, newest first, a page at a time. */
export interface SiteHistory {
  /** The next publishes, or none once there are no more. */
  more(): Promise<FileVersion[]>;
  /** Whether every publish has been listed. */
  readonly done: boolean;
}

/**
 * The publishes that changed the site's content or media, newest first: each
 * folder's history merged by date, with publishes that changed both listed once.
 */
export function siteHistory(versions: Pick<GitBackend, "history">, perPage = 20): SiteHistory {
  const sources = SITE_FOLDERS.map((folder) => ({ folder, page: 0, waiting: [] as FileVersion[], done: false }));
  const seen = new Set<string>();
  const fill = async (source: (typeof sources)[number]) => {
    if (source.waiting.length > 0 || source.done) return;
    const page = source.page + 1;
    const found = await versions.history(source.folder, { page, perPage });
    // Only once it's come, so a page that couldn't be read is asked for again next time.
    source.page = page;
    source.waiting.push(...found);
    if (found.length < perPage) source.done = true;
  };
  const time = (version: FileVersion) => {
    const parsed = Date.parse(version.date);
    return Number.isNaN(parsed) ? 0 : parsed;
  };
  const next = async () => {
    const listed: FileVersion[] = [];
    while (listed.length < perPage) {
      await Promise.all(sources.map(fill));
      let newest: (typeof sources)[number] | undefined;
      for (const source of sources) {
        const first = source.waiting[0];
        if (first && (!newest || time(first) > time(newest.waiting[0] as FileVersion))) newest = source;
      }
      const version = newest?.waiting.shift();
      if (!version) break;
      if (seen.has(version.revision)) continue;
      seen.add(version.revision);
      listed.push(version);
    }
    return listed;
  };
  // One page at a time, so pages asked for together still come in order.
  let previous: Promise<unknown> = Promise.resolve();
  return {
    get done() {
      return sources.every((source) => source.done && source.waiting.length === 0);
    },
    more() {
      const page = previous.then(next, next);
      previous = page;
      return page;
    },
  };
}

/** How a file has changed since an earlier publish. */
export type SinceChange = "added" | "removed" | "changed";

/** One file a whole-site restore would put back. */
export interface ChangedFile {
  path: string;
  /** `added` since, which the restore removes; `removed` since, which it brings back; or `changed`. */
  since: SinceChange;
}

/**
 * The content and media files that differ between the site then and now,
 * which a restore would put back. Content files are compared by their text,
 * so none is missed; media files by `changed`, the paths the git host says
 * differ, and by which files each has, since hosts list a limited number.
 */
export async function siteChangesSince(
  then: RevisionFiles,
  now: ContentSource,
  changed: readonly string[],
): Promise<ChangedFile[]> {
  const [thenContent, nowContent, thenMedia, nowMedia] = await Promise.all([
    then.list(CONTENT_DIR),
    now.list(CONTENT_DIR),
    then.list(MEDIA_DIR),
    now.list(MEDIA_DIR),
  ]);
  const [thenTexts, nowTexts] = await Promise.all([
    readTextFiles(then, thenContent.filter(isRestoredPath)),
    readTextFiles(now, nowContent.filter(isRestoredPath)),
  ]);
  const files: ChangedFile[] = [];
  const contentPaths = new Set([...thenTexts.keys(), ...nowTexts.keys()]);
  for (const path of contentPaths) {
    const before = thenTexts.get(path);
    const after = nowTexts.get(path);
    if (before === after) continue;
    files.push({ path, since: before === undefined ? "added" : after === undefined ? "removed" : "changed" });
  }
  const mediaThen = new Set(thenMedia);
  const mediaNow = new Set(nowMedia);
  const hostChanged = new Set(changed);
  for (const path of new Set([...thenMedia, ...nowMedia])) {
    if (!mediaThen.has(path)) files.push({ path, since: "added" });
    else if (!mediaNow.has(path)) files.push({ path, since: "removed" });
    else if (hostChanged.has(path)) files.push({ path, since: "changed" });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** The changes that put every file back as it was then: removing what was added, and writing the rest as it was. */
export async function siteRestoreChanges(then: RevisionFiles, files: readonly ChangedFile[]): Promise<FileChange[]> {
  const texts = await readTextFiles(
    then,
    files.filter((file) => file.since !== "added" && !file.path.startsWith(`${MEDIA_DIR}/`)).map((file) => file.path),
  );
  return Promise.all(
    files.map(async ({ path, since }): Promise<FileChange> => {
      if (since === "added") return { path, delete: true };
      if (path.startsWith(`${MEDIA_DIR}/`)) {
        const bytes = await then.readBytes(path);
        if (!bytes) throw new Error(`${path} couldn't be read as it was.`);
        return { path, bytes };
      }
      const content = texts.get(path);
      if (content === undefined) throw new Error(`${path} couldn't be read as it was.`);
      return { path, content };
    }),
  );
}

/** What a changed file is in the site, for saying what has changed in words. */
export type SiteChangeSubject =
  | { kind: "page"; page: Page }
  | { kind: "entry"; collection: Collection; entry: Entry }
  | { kind: "collection"; collection: Collection }
  | { kind: "header" | "footer" | "settings" | "menus" | "redirects" | "credits" | "css" | "code" | "theme" }
  | { kind: "media"; url: string }
  | { kind: "file"; path: string };

export interface SiteChange {
  subject: SiteChangeSubject;
  since: SinceChange;
}

const NAMED_FILES: Record<string, SiteChangeSubject> = {
  [HEADER_FILE]: { kind: "header" },
  [FOOTER_FILE]: { kind: "footer" },
  [SITE_FILE]: { kind: "settings" },
  [MENUS_FILE]: { kind: "menus" },
  [REDIRECTS_FILE]: { kind: "redirects" },
  [MEDIA_FILE]: { kind: "credits" },
  [CUSTOM_CSS_FILE]: { kind: "css" },
  [THEME_FILE]: { kind: "theme" },
  [HEAD_CODE_FILE]: { kind: "code" },
  [BODY_CODE_FILE]: { kind: "code" },
};

/** What a file is in a loaded site, if it's there. */
function subjectIn(content: SiteContent, path: string): SiteChangeSubject | undefined {
  const page = content.pages.find((candidate) => candidate.file === path);
  if (page) return { kind: "page", page };
  for (const collection of content.collections) {
    if (path === collection.file) return { kind: "collection", collection };
    const entry = collection.entries.find((candidate) => candidate.file === path);
    if (entry) return { kind: "entry", collection, entry };
  }
  return undefined;
}

/**
 * What has changed since, as pages, items, settings and media rather than
 * files: each page and item from the site where it is, now or, for one removed
 * since, then. The site's own code (custom code's two files) is listed once.
 */
export function describeSiteChanges(then: SiteContent, now: SiteContent, files: readonly ChangedFile[]): SiteChange[] {
  const changes: SiteChange[] = [];
  const named = new Set<string>();
  for (const { path, since } of files) {
    const known = NAMED_FILES[path];
    if (known) {
      if (named.has(known.kind)) continue;
      named.add(known.kind);
      changes.push({ subject: known, since: path === HEAD_CODE_FILE || path === BODY_CODE_FILE ? "changed" : since });
      continue;
    }
    if (path.startsWith(`${MEDIA_DIR}/`)) {
      changes.push({ subject: { kind: "media", url: `/media/${path.slice(MEDIA_DIR.length + 1)}` }, since });
      continue;
    }
    const subject = (since === "removed" ? subjectIn(then, path) : subjectIn(now, path)) ?? subjectIn(then, path);
    changes.push({ subject: subject ?? { kind: "file", path }, since });
  }
  return changes;
}
