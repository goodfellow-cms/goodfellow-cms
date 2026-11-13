import {
  allPages,
  type CollectionFile,
  type CollectionSources,
  type ContentSource,
  checkSite,
  collectionFileSchema,
  collectionSettingsFile,
  entryTitle,
  type FileChange,
  FOOTER_FILE,
  HEADER_FILE,
  languagePattern,
  loadSiteContent,
  MEDIA_DIR,
  MENUS_FILE,
  matchesAddressPattern,
  publishProblems,
  REDIRECTS_FILE,
  SITE_FILE,
  SignInError,
  type SiteContent,
  type SiteProblem,
  type SourcedItem,
  siteLanguages,
  todayIn,
  withSourcedCollections,
} from "@goodfellow-cms/core";
import type { ComponentConfig } from "@puckeditor/core";
import { pageTitle } from "./changes.js";
import { mediaUrl } from "./media.js";
import { pagesToRender, type SiteCodeService } from "./site-code.js";
import type { StringKey, Translate } from "./strings.js";

export interface PublishChecks {
  /** Errors the publish would bring, which stop it. */
  blocking: SiteProblem[];
  /** What the files it changes have wrong besides, which the editor can publish anyway. */
  warnings: SiteProblem[];
  /** The site as the publish would leave it, which names where each problem is. */
  content: SiteContent;
  /**
   * Collections whose items come from a source that couldn't be read just now
   * (by id), so links to their pages couldn't be checked. This stops the
   * publish too, until publishing again finds the source answering.
   */
  unread?: string[];
  /**
   * Items a collection's source gives that the site shows now, which the
   * publish would leave out, such as when a removed choice or field no longer
   * fits them: their titles. The editor can publish anyway, since only the
   * other system can change them, and they show again once they fit.
   */
  leftOut?: string[];
}

/** The media library's files as the addresses content uses, such as `/media/photo.jpg`. */
function mediaAddresses(paths: Iterable<string>): string[] {
  return [...paths].filter((path) => path.startsWith(`${MEDIA_DIR}/`)).map(mediaUrl);
}

/** The site as it would be once the changes are published, read like the site itself. */
function contentWithChanges(
  source: ContentSource,
  changes: FileChange[],
  sourced: readonly string[] = [],
): Promise<SiteContent> {
  const changed = new Map(changes.map((change) => [change.path, change]));
  return loadSiteContent(
    {
      read: async (path) => {
        const change = changed.get(path);
        if (!change) return source.read(path);
        return "content" in change ? change.content : undefined;
      },
      list: async (dir) => {
        const listed = new Set(await source.list(dir));
        for (const change of changes) {
          if (!change.path.startsWith(`${dir}/`)) continue;
          if ("delete" in change) listed.delete(change.path);
          else listed.add(change.path);
        }
        return [...listed];
      },
    },
    { sourced },
  );
}

/**
 * The site as visitors see it, with its sourced collections' items
 * (`LoadState.shown`, left out where nothing is sourced), or, where a source
 * can't be read just now, `unreadSources`, so the rest of the site can still
 * be edited. A `SignInError` is thrown, since signing in again is for
 * everything. Problems with a source's items are the server's to report: here
 * they're left out, as on the site.
 */
export async function readShown(
  content: SiteContent,
  sources: CollectionSources | undefined,
): Promise<{ shown?: SiteContent; unreadSources?: true }> {
  if (!sources) return {};
  try {
    const shown = await withSourcedCollections(content, sources, () => {});
    return shown === content ? {} : { shown };
  } catch (error) {
    if (error instanceof SignInError) throw error;
    return { unreadSources: true };
  }
}

/**
 * Whether a link's address could be a page of a collection whose items the
 * admin panel can't read, such as a static site's, whose build reads them: its
 * pages aren't known here, so a link to one can't be checked.
 */
function unreachablePage(content: SiteContent, unreachable: ReadonlySet<string>, target: string): boolean {
  return content.collections.some(
    (collection) =>
      unreachable.has(collection.id) &&
      siteLanguages(content.settings).some((language) => {
        const pattern = languagePattern(content.settings, collection.settings, language.code);
        return pattern !== undefined && matchesAddressPattern(pattern, target);
      }),
  );
}

/**
 * The problems without links that might go to an unreachable collection's
 * items: to their pages (`unreachablePage()`), and from item fields that name
 * one of them, since the admin panel doesn't know which items it has.
 */
function withoutUnreachable(
  problems: SiteProblem[],
  content: SiteContent,
  unreachable: ReadonlySet<string>,
): SiteProblem[] {
  if (unreachable.size === 0) return problems;
  return problems.filter((problem) => {
    if (problem.kind === "missing-page") return !unreachablePage(content, unreachable, problem.target);
    if (problem.kind === "missing-item") return !unreachable.has(problem.collection);
    return true;
  });
}

/**
 * The sources a publish's checks ask: a collection whose settings the changes write is asked with those, so its
 * source's values for a field they add are checked as the site would check them once published. The rest are asked
 * as they are.
 */
export function withProposedSettings(
  sources: CollectionSources | undefined,
  changes: readonly FileChange[],
  read: (collection: string, settings: CollectionFile) => Promise<SourcedItem[]>,
): CollectionSources | undefined {
  if (!sources) return undefined;
  return Object.fromEntries(
    Object.entries(sources).map(([id, source]) => {
      const change = changes.find((one) => one.path === collectionSettingsFile(id));
      const settings = change && "content" in change ? proposedSettings(change.content) : undefined;
      return [id, settings ? { ...source, items: () => read(id, settings) } : source];
    }),
  );
}

/** A collection's settings as a change writes them, or nothing where they can't be read, as loading would refuse. */
function proposedSettings(text: string): CollectionFile | undefined {
  try {
    const parsed = collectionFileSchema.safeParse(JSON.parse(text));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The site checks for a publish: the site as it's loaded, and as the changes
 * would leave it, with the pages they change rendered. A site the changes
 * would leave unreadable isn't checked; loading it again after publishing
 * says what's wrong.
 */
export async function checkPublish(
  source: ContentSource,
  loaded: { content: SiteContent; shown?: SiteContent; media: string[] },
  changes: FileChange[],
  site: {
    blocks: Record<string, ComponentConfig>;
    code: SiteCodeService;
    sources?: CollectionSources;
    /** Every collection whose items come from a source, by id: those without one in `sources` the admin panel can't read. */
    sourced?: readonly string[];
  },
): Promise<PublishChecks> {
  const { blocks, code, sources } = site;
  const sourced = site.sourced ?? Object.keys(sources ?? {});
  const unreachable = new Set(sourced.filter((id) => !sources || !Object.hasOwn(sources, id)));
  let leftOut: string[] | undefined;
  // As visitors see it, with sourced collections' items, so links to their pages aren't missing.
  const before = loaded.shown ?? loaded.content;
  let after: SiteContent;
  try {
    after = await contentWithChanges(source, changes, sourced);
  } catch {
    return { blocking: [], warnings: [], content: before };
  }
  if (sources) {
    // Asked each time, so publishing again retries a source that couldn't be read, here or as the site loaded.
    try {
      after = await withSourcedCollections(after, sources);
    } catch {
      const unread = after.collections.filter((one) => Object.hasOwn(sources, one.id)).map((one) => one.id);
      return { blocking: [], warnings: [], unread, content: after };
    }
    // Items shown before that the changes would leave out, whether the site's checks refuse them here or the server
    // already left them out, as it does an item that doesn't fit the settings it's asked with.
    const shownAfter = new Set(
      after.collections.flatMap((collection) =>
        collection.sourced ? collection.entries.map((entry) => entry.file) : [],
      ),
    );
    const out = before.collections.flatMap((collection) =>
      collection.sourced
        ? collection.entries.filter((entry) => !shownAfter.has(entry.file)).map((entry) => entryTitle(entry))
        : [],
    );
    if (out.length > 0) leftOut = [...new Set(out)];
  }
  const media = new Set(loaded.media);
  for (const change of changes) {
    if ("delete" in change) media.delete(change.path);
    else if ("bytes" in change) media.add(change.path);
  }
  const today = todayIn(after.settings.timeZone);
  const changed = new Set(changes.map((change) => change.path));
  // Without the site's code, such as when its frame doesn't start, links are checked against pages alone.
  // The same pages are rendered as they were too, so a warning they had before isn't asked about again.
  const [pagesBefore, pagesAfter, renderedBefore, rendered] = await Promise.all([
    code.sitePages(before, today).catch(() => allPages(before)),
    code.sitePages(after, today).catch(() => allPages(after)),
    code.renderedProblems(before, pagesToRender(before, changed), today).catch((): SiteProblem[] => []),
    code.renderedProblems(after, pagesToRender(after, changed), today).catch((): SiteProblem[] => []),
  ]);
  const problemsBefore = [
    ...withoutUnreachable(
      checkSite(before, { media: mediaAddresses(loaded.media), blocks, pages: pagesBefore }),
      before,
      unreachable,
    ),
    ...renderedBefore,
  ];
  const problems = [
    ...withoutUnreachable(
      checkSite(after, { media: mediaAddresses(media), blocks, pages: pagesAfter }),
      after,
      unreachable,
    ),
    ...rendered,
  ];
  const found = publishProblems(problemsBefore, problems, changed);
  return { ...found, ...(leftOut && { leftOut }), content: after };
}

/** Where a problem is, as the admin panel names it, such as `The page "About us"`. */
export function problemPlace(t: Translate, content: SiteContent, file: string): string {
  if (file === HEADER_FILE) return t("checks.place.header");
  if (file === FOOTER_FILE) return t("checks.place.footer");
  if (file === MENUS_FILE) return t("checks.place.menus");
  if (file === SITE_FILE) return t("checks.place.settings");
  if (file === REDIRECTS_FILE) return t("checks.place.redirects");
  const page = content.pages.find((candidate) => candidate.file === file);
  if (page) return t("checks.place.page", { title: pageTitle(page) });
  for (const block of content.syncedBlocks ?? []) {
    if (block.file === file) return t("checks.place.synced", { title: block.content.title });
    const language = Object.values(block.languages ?? {}).find((own) => own.file === file);
    if (language) return t("checks.place.synced", { title: language.content.title });
  }
  for (const collection of content.collections) {
    if (collection.file === file) return t("checks.place.design", { collection: collection.settings.name });
    const entry = collection.entries.find((candidate) => candidate.file === file);
    if (entry) return t("checks.place.entry", { title: entryTitle(entry), collection: collection.settings.name });
  }
  return t("checks.place.file", { file });
}

/** What a theme color problem means, which needs no content to say. */
export function describeContrast(t: Translate, problem: Extract<SiteProblem, { kind: "low-contrast" }>): string {
  return t(problem.dark ? "checks.low-contrast.dark" : "checks.low-contrast", {
    text: t(`theme.color.${problem.text}` as StringKey),
    background: t(`theme.color.${problem.background}` as StringKey),
    ratio: problem.ratio.toFixed(1),
  });
}

/** One of the site's languages, as it's named in the switch. */
function languageName(content: SiteContent, code: string): string {
  return siteLanguages(content.settings).find((language) => language.code === code)?.name ?? code;
}

/** What a problem means, in plain words. */
export function describeProblem(t: Translate, content: SiteContent, problem: SiteProblem): string {
  switch (problem.kind) {
    case "missing-page":
    case "missing-media":
    case "unsafe-link":
      return t(`checks.${problem.kind}`, { place: problemPlace(t, content, problem.file), target: problem.target });
    case "no-title":
    case "no-description":
      return t(`checks.${problem.kind}`, { place: problemPlace(t, content, problem.file) });
    case "missing-item":
      return t("checks.missing-item", {
        place: problemPlace(t, content, problem.file),
        target: problem.target,
        collection:
          content.collections.find((collection) => collection.id === problem.collection)?.settings.name ??
          problem.collection,
      });
    case "missing-synced-block":
      return problem.target
        ? t("checks.missing-synced-block", { place: problemPlace(t, content, problem.file), target: problem.target })
        : t("checks.unchosen-synced-block", { place: problemPlace(t, content, problem.file) });
    case "nested-synced-block":
      return t("checks.nested-synced-block", { place: problemPlace(t, content, problem.file) });
    case "bad-translation":
      return t("checks.bad-translation", { place: problemPlace(t, content, problem.file), target: problem.target });
    case "missing-translation":
    case "outdated-translation":
      return t(`checks.${problem.kind}`, {
        place: problemPlace(t, content, problem.file),
        language: languageName(content, problem.language),
      });
    case "low-contrast":
      return describeContrast(t, problem);
    case "no-alt":
      return t("checks.no-alt", {
        place: problemPlace(t, content, problem.file),
        image: problem.target.slice(problem.target.lastIndexOf("/") + 1) || problem.target,
      });
    case "skipped-heading":
      return problem.previous === undefined
        ? t("checks.skipped-heading.first", {
            place: problemPlace(t, content, problem.file),
            text: problem.text,
            level: String(problem.level),
          })
        : t("checks.skipped-heading", {
            place: problemPlace(t, content, problem.file),
            text: problem.text,
            level: String(problem.level),
            previous: String(problem.previous),
          });
    case "vague-link":
      return t("checks.vague-link", { place: problemPlace(t, content, problem.file), text: problem.text });
    case "empty-link":
      return t("checks.empty-link", { place: problemPlace(t, content, problem.file), target: problem.target });
    case "accessibility":
      return t("checks.accessibility", { place: problemPlace(t, content, problem.file), help: problem.help });
  }
}
