import type { z } from "zod";
import { type ContentKind, migrateContent } from "../migrations/index.js";
import { type Collection, type Entry, entryFieldProblems, sortCollectionEntries } from "./collections.js";
import { mediaFileSchema, type PhotoCredit } from "./credits.js";
import { ContentError, type ContentProblem } from "./errors.js";
import { entryLanguage, entryPathIn, isOtherLanguage, siteLanguages } from "./languages.js";
import { parseMarkdownEntry } from "./markdown.js";
import {
  BODY_CODE_FILE,
  COLLECTION_SETTINGS_FILE,
  COLLECTIONS_DIR,
  CUSTOM_CSS_FILE,
  FOOTER_FILE,
  HEAD_CODE_FILE,
  HEADER_FILE,
  isAddressSegment,
  isReservedPagePath,
  languageLayoutFile,
  MEDIA_FILE,
  MENUS_FILE,
  PAGES_DIR,
  pageFileToPath,
  REDIRECTS_FILE,
  SITE_FILE,
} from "./paths.js";
import { type Redirect, redirectProblems, redirectsFileSchema } from "./redirects.js";
import {
  type CollectionFile,
  collectionFileSchema,
  type EntryFile,
  entryFileSchema,
  type LayoutFile,
  layoutFileSchema,
  type Menus,
  menusFileSchema,
  type PageFile,
  pageFileSchema,
  type SiteSettings,
  siteSettingsSchema,
} from "./schemas.js";
import type { PageView } from "./site-pages.js";

/**
 * Read access to a site's files. Implemented by the local file system during
 * builds and, later, by each git backend.
 */
export interface ContentSource {
  /** Returns a file's text, or `undefined` if it doesn't exist. Paths are repo-relative. */
  read(path: string): Promise<string | undefined>;
  /** Lists every file under a directory, recursively, as repo-relative paths. Returns `[]` if the directory doesn't exist. */
  list(dir: string): Promise<string[]>;
  /**
   * Reads several text files at once, where the source can do that in fewer
   * requests than reading them one by one. Files that don't exist are left out.
   */
  readFiles?(paths: string[]): Promise<Map<string, string>>;
  /** The size in bytes of every file under a directory, recursively, where the source can say without reading them. */
  fileSizes?(dir: string): Promise<Map<string, number>>;
}

/** Reads several text files, all at once where the source can. Files that don't exist are left out. */
export async function readTextFiles(source: ContentSource, paths: string[]): Promise<Map<string, string>> {
  if (source.readFiles) return source.readFiles(paths);
  const texts = await Promise.all(paths.map(async (path) => [path, await source.read(path)] as const));
  return new Map(texts.filter((entry): entry is readonly [string, string] => entry[1] !== undefined));
}

export interface Page {
  /** The URL path, such as `/` or `/about`. */
  path: string;
  /** The content file it came from. */
  file: string;
  content: PageFile;
  /**
   * Set for an entry's page, whose `content` is its collection's template. The
   * entry's values are filled into the template when the page is rendered.
   */
  entry?: { collection: string; slug: string };
  /**
   * Set on pages that blocks add (see `sitePages`), such as a calendar's month
   * or a list's second page, and on the page they're added to: what it shows.
   */
  view?: PageView;
}

export interface SiteContent {
  settings: SiteSettings;
  /** The main language's menus. */
  menus: Menus;
  /** The menus in the site's other languages, by code (see `menusIn()`). */
  languageMenus?: Record<string, Menus>;
  header: LayoutFile;
  footer: LayoutFile;
  /** Headers and footers of the site's other languages, by code, where they have their own (see `layoutIn()`). */
  languageLayouts?: Record<string, { header?: LayoutFile; footer?: LayoutFile }>;
  /** Pages sorted by path. Entries' pages aren't included; see `allPages`. */
  pages: Page[];
  /** Collections sorted by id, each with its entries. */
  collections: Collection[];
  /** Admin-written CSS, or `""`. */
  customCss: string;
  /** Admin-written code for every page, such as analytics: `head` for the `<head>`, `body` for the end of the `<body>`. Missing means none. */
  code?: SiteCode;
  /** Old addresses that send visitors on (`content/redirects.json`). Missing means none. */
  redirects?: Redirect[];
  /** What the page at an old address says while it sends visitors on, if the site set it. */
  redirectMessage?: string;
  /** Media files' credits, by address (`content/media.json`), such as photos from Openverse. Missing means none. */
  credits?: Record<string, PhotoCredit>;
}

export interface SiteCode {
  /** HTML for the `<head>`: script, style, link, meta, base and noscript elements only (see `parseHeadCode`). */
  head: string;
  /** HTML for the end of the `<body>`. */
  body: string;
}

const EMPTY_LAYOUT: LayoutFile = { version: 1, data: { root: {}, content: [] } };

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => (issue.path.length ? `${issue.path.join(".")} ${issue.message}` : issue.message))
    .join("; ");
}

/**
 * Parses one content file: JSON, then migration to the current version, then
 * validation. Returns the problem instead of throwing so callers can report
 * every bad file at once.
 */
export function parseContentFile<S extends z.ZodType>(
  kind: ContentKind,
  schema: S,
  file: string,
  text: string,
): { ok: true; value: z.output<S> } | { ok: false; problem: ContentProblem } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return { ok: false, problem: { file, message: `isn't valid JSON (${(error as Error).message}).` } };
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, problem: { file, message: "must contain a JSON object." } };
  }
  return checkContentFile(kind, schema, file, raw as Record<string, unknown>);
}

/** Migrates a parsed content file to the current version, then validates it. */
function checkContentFile<S extends z.ZodType>(
  kind: ContentKind,
  schema: S,
  file: string,
  raw: Record<string, unknown>,
): { ok: true; value: z.output<S> } | { ok: false; problem: ContentProblem } {
  let migrated: Record<string, unknown>;
  try {
    migrated = migrateContent(kind, raw);
  } catch (error) {
    return { ok: false, problem: { file, message: (error as Error).message } };
  }

  const result = schema.safeParse(migrated);
  if (!result.success) {
    return { ok: false, problem: { file, message: formatIssues(result.error) } };
  }
  return { ok: true, value: result.data };
}

/** Loads and validates everything under `content/`. Throws a `ContentError` listing every problem found. */
export async function loadSiteContent(source: ContentSource): Promise<SiteContent> {
  const problems: ContentProblem[] = [];

  async function loadOptional<S extends z.ZodType>(
    kind: ContentKind,
    schema: S,
    file: string,
    fallback: z.output<S>,
  ): Promise<z.output<S>> {
    const text = await source.read(file);
    if (text === undefined) return fallback;
    const result = parseContentFile(kind, schema, file, text);
    if (result.ok) return result.value;
    problems.push(result.problem);
    return fallback;
  }

  const [
    settings,
    menusFile,
    redirectsFile,
    mediaFile,
    header,
    footer,
    customCss,
    headCode,
    bodyCode,
    pageFiles,
    collectionFiles,
  ] = await Promise.all([
    loadOptional("site", siteSettingsSchema, SITE_FILE, siteSettingsSchema.parse({ version: 1 })),
    loadOptional("menus", menusFileSchema, MENUS_FILE, { version: 1, menus: {} }),
    loadOptional("redirects", redirectsFileSchema, REDIRECTS_FILE, { version: 1, redirects: [] }),
    loadOptional("media", mediaFileSchema, MEDIA_FILE, { version: 1, credits: {} }),
    loadOptional("layout", layoutFileSchema, HEADER_FILE, EMPTY_LAYOUT),
    loadOptional("layout", layoutFileSchema, FOOTER_FILE, EMPTY_LAYOUT),
    source.read(CUSTOM_CSS_FILE),
    source.read(HEAD_CODE_FILE),
    source.read(BODY_CODE_FILE),
    source.list(PAGES_DIR),
    source.list(COLLECTIONS_DIR),
  ]);

  const pages: Page[] = [];
  const filesByPath = new Map<string, string>();

  await Promise.all(
    pageFiles
      .filter((file) => file.endsWith(".json"))
      .map(async (file) => {
        let path: string;
        try {
          path = pageFileToPath(file);
        } catch (error) {
          problems.push({ file, message: (error as Error).message });
          return;
        }

        if (isReservedPagePath(path)) {
          problems.push({ file, message: `can't be used: ${path} is reserved for the admin panel. Rename the file.` });
          return;
        }

        const existing = filesByPath.get(path);
        if (existing) {
          const [first, second] = [existing, file].sort();
          problems.push({
            file: second ?? file,
            message: `serves the same address (${path}) as ${first}. Remove one of them.`,
          });
          return;
        }
        filesByPath.set(path, file);

        const text = await source.read(file);
        if (text === undefined) return;
        const result = parseContentFile("page", pageFileSchema, file, text);
        if (result.ok) pages.push({ path, file, content: result.value });
        else problems.push(result.problem);
      }),
  );

  // A language can have a header and footer of its own.
  const languageLayouts: NonNullable<SiteContent["languageLayouts"]> = {};
  await Promise.all(
    siteLanguages(settings)
      .filter((language) => !language.main)
      .flatMap((language) =>
        (["header", "footer"] as const).map(async (part) => {
          const file = languageLayoutFile(part, language.code);
          const text = await source.read(file);
          if (text === undefined) return;
          const result = parseContentFile("layout", layoutFileSchema, file, text);
          if (!result.ok) {
            problems.push(result.problem);
            return;
          }
          languageLayouts[language.code] = { ...languageLayouts[language.code], [part]: result.value };
        }),
      ),
  );

  const collections = await loadCollections(source, collectionFiles, problems, settings);

  // Entries' pages share addresses with ordinary pages, so they can't clash with them.
  for (const collection of collections) {
    for (const entry of collection.entries) {
      if (!entry.path) continue;
      if (isReservedPagePath(entry.path)) {
        problems.push({
          file: entry.file,
          message: `can't be used: ${entry.path} is reserved for the admin panel. Rename the file.`,
        });
        continue;
      }
      const existing = filesByPath.get(entry.path);
      if (existing) {
        problems.push({
          file: entry.file,
          message: `has the same address (${entry.path}) as ${existing}. Rename one of them.`,
        });
        continue;
      }
      filesByPath.set(entry.path, entry.file);
    }
  }

  redirectProblems(redirectsFile.redirects).forEach((problem, index) => {
    if (!problem) return;
    const { from, to } = redirectsFile.redirects[index] ?? { from: "", to: "" };
    problems.push({
      file: REDIRECTS_FILE,
      message: `has a redirect from "${from}" to "${to}" that ${REDIRECT_PROBLEMS[problem]}`,
    });
  });

  if (problems.length > 0) {
    problems.sort((a, b) => a.file.localeCompare(b.file));
    throw new ContentError(problems);
  }

  pages.sort((a, b) => a.path.localeCompare(b.path));
  return {
    settings,
    menus: menusFile.menus,
    ...(menusFile.languages && { languageMenus: menusFile.languages }),
    header,
    footer,
    ...(Object.keys(languageLayouts).length > 0 && { languageLayouts }),
    pages,
    collections,
    customCss: customCss ?? "",
    code: { head: headCode ?? "", body: bodyCode ?? "" },
    redirects: redirectsFile.redirects,
    ...(redirectsFile.message !== undefined && { redirectMessage: redirectsFile.message }),
    credits: mediaFile.credits,
  };
}

/** What's wrong with a redirect, for build errors. The admin panel has its own words for these. */
const REDIRECT_PROBLEMS: Record<NonNullable<ReturnType<typeof redirectProblems>[number]>, string> = {
  "no-from": "has no old address.",
  "bad-from": 'has an old address that isn\'t one: it should start with "/", such as /about-us.',
  query: "has an old address with a ?, which a static site can't tell apart from the address without it.",
  home: "is from the home page, which can't be redirected.",
  reserved: "is from an address Goodfellow uses itself.",
  "no-to": "doesn't say where to send visitors.",
  "bad-to": 'sends visitors somewhere that isn\'t an address: it should start with "/" or "https://".',
  loop: "sends visitors back to the same address.",
  duplicate: "is from the same address as an earlier redirect. Remove one of them.",
};

/** Reads a Markdown entry like a JSON one: migrated to the current version, then checked. */
function parseMarkdownContent(
  file: string,
  text: string,
  body: string,
): { ok: true; value: EntryFile } | { ok: false; problem: ContentProblem } {
  let raw: Record<string, unknown>;
  try {
    raw = parseMarkdownEntry(text, body);
  } catch (error) {
    return { ok: false, problem: { file, message: (error as Error).message } };
  }
  return checkContentFile("entry", entryFileSchema, file, raw);
}

/**
 * Reads one entry's file as loading the site does: Markdown or JSON as its
 * collection stores them, migrated, then checked against the collection's fields.
 */
export function parseEntryFile(
  settings: CollectionFile,
  file: string,
  text: string,
): { ok: true; value: EntryFile } | { ok: false; problem: ContentProblem } {
  const entry = settings.markdown
    ? parseMarkdownContent(file, text, settings.markdown.body)
    : parseContentFile("entry", entryFileSchema, file, text);
  if (!entry.ok) return entry;
  const fieldProblems = entryFieldProblems(settings.fields, entry.value.fields);
  if (fieldProblems.length > 0) {
    return { ok: false, problem: { file, message: fieldProblems.map((problem) => `fields.${problem}`).join("; ") } };
  }
  return entry;
}

/** Loads every collection's settings and entries, adding any problems found to `problems`. */
async function loadCollections(
  source: ContentSource,
  files: string[],
  problems: ContentProblem[],
  site: SiteSettings,
): Promise<Collection[]> {
  const folders = new Map<string, { settings?: string; entries: string[] }>();
  for (const file of files) {
    if (!file.endsWith(".json") && !file.endsWith(".md")) continue;
    const parts = file.slice(COLLECTIONS_DIR.length + 1).split("/");
    const [id, name] = parts;
    if (parts.length !== 2 || id === undefined || name === undefined) {
      problems.push({
        file,
        message: "is in the wrong place. Collections are folders of entry files, with no folders inside.",
      });
      continue;
    }
    if (!isAddressSegment(id)) {
      problems.push({
        file,
        message: `is in a folder named "${id}". Collection folders use lowercase letters, numbers and hyphens only.`,
      });
      continue;
    }
    const folder = folders.get(id) ?? { entries: [] };
    folders.set(id, folder);
    if (name === COLLECTION_SETTINGS_FILE) folder.settings = file;
    else folder.entries.push(file);
  }

  const collections = await Promise.all(
    [...folders].map(async ([id, folder]): Promise<Collection | undefined> => {
      if (!folder.settings) {
        for (const file of folder.entries) {
          problems.push({
            file,
            message: `belongs to a collection with no ${COLLECTION_SETTINGS_FILE}. Add one, or move the file.`,
          });
        }
        return undefined;
      }
      const text = await source.read(folder.settings);
      if (text === undefined) return undefined;
      const parsed = parseContentFile("collection", collectionFileSchema, folder.settings, text);
      if (!parsed.ok) {
        problems.push(parsed.problem);
        return undefined;
      }
      const settings = parsed.value;

      const entries = await Promise.all(
        folder.entries.map(async (file): Promise<Entry | undefined> => {
          const markdown = file.endsWith(".md");
          const slug = file.slice(file.lastIndexOf("/") + 1, markdown ? -".md".length : -".json".length);
          if (markdown !== Boolean(settings.markdown)) {
            problems.push({
              file,
              message: markdown
                ? `is a Markdown file, but this collection's entries are JSON files. Rename it to ${slug}.json and write it as JSON, or turn on Markdown in the collection's settings.`
                : `is a JSON file, but this collection's entries are Markdown files (${slug}.md).`,
            });
            return undefined;
          }
          if (!isAddressSegment(slug)) {
            problems.push({
              file,
              message: `has a name that can't be used. Entry files are named with lowercase letters, numbers and hyphens only.`,
            });
            return undefined;
          }
          const entryText = await source.read(file);
          if (entryText === undefined) return undefined;
          const entry = parseEntryFile(settings, file, entryText);
          if (!entry.ok) {
            problems.push(entry.problem);
            return undefined;
          }
          const language = entryLanguage(site, { content: entry.value });
          if (language !== site.language && !isOtherLanguage(site, language)) {
            problems.push({
              file,
              message: `is in ${language}, which isn't one of the site's languages. Add it in Site Settings, or take inLanguage out.`,
            });
            return undefined;
          }
          const path = entryPathIn(site, settings, slug, language);
          return { collection: id, slug, file, ...(path !== undefined && { path }), content: entry.value };
        }),
      );

      return {
        id,
        file: folder.settings,
        settings,
        entries: sortCollectionEntries(
          settings,
          entries.filter((entry) => entry !== undefined),
        ),
      };
    }),
  );

  return collections.filter((collection) => collection !== undefined).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every page the site serves: its pages, plus a page for each entry in a
 * collection that gives entries pages. Sorted by address.
 */
export function allPages(content: SiteContent): Page[] {
  const entryPages = content.collections.flatMap((collection) =>
    collection.entries.flatMap((entry): Page[] =>
      entry.path
        ? [
            {
              path: entry.path,
              file: entry.file,
              content: { version: 1, data: collection.settings.template },
              entry: { collection: collection.id, slug: entry.slug },
            },
          ]
        : [],
    ),
  );
  return [...content.pages, ...entryPages].sort((a, b) => a.path.localeCompare(b.path));
}

/** Finds an entry and its collection. */
export function findEntry(
  content: Pick<SiteContent, "collections">,
  collectionId: string,
  slug: string,
): { collection: Collection; entry: Entry } | undefined {
  const collection = content.collections.find((candidate) => candidate.id === collectionId);
  const entry = collection?.entries.find((candidate) => candidate.slug === slug);
  return collection && entry ? { collection, entry } : undefined;
}
