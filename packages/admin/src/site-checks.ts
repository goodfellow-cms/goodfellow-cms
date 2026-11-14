import {
  allPages,
  type CollectionFile,
  type CollectionSources,
  type ContentSource,
  checkSite,
  collectionSettingsFile,
  entryTitle,
  type FileChange,
  FOOTER_FILE,
  HEADER_FILE,
  loadSiteContent,
  MEDIA_DIR,
  MENUS_FILE,
  publishProblems,
  REDIRECTS_FILE,
  SITE_FILE,
  SignInError,
  type SiteContent,
  type SiteProblem,
  type SourcedItem,
  siteLanguages,
  todayIn,
  withoutUnreadLinks,
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
  sourcesFor: CollectionSources | SourcesFor | undefined,
): Promise<{ shown?: SiteContent; unreadSources?: true }> {
  const sources = typeof sourcesFor === "function" ? sourcesFor(content) : sourcesFor;
  if (!sources) return {};
  try {
    const shown = await withSourcedCollections(content, sources, () => {});
    return shown === content ? {} : { shown };
  } catch (error) {
    if (error instanceof SignInError) throw error;
    return { unreadSources: true };
  }
}

/** The sources to ask for a copy of the site: what the admin panel reads, for the site as it's loaded or checked. */
export type SourcesFor = (content: SiteContent) => CollectionSources | undefined;

/**
 * The sources of the collections `sourced` names, for a copy of the site: an owner asks each with the collection's
 * settings as that copy has them (`read(id, settings)`), so a draft's new collection, or a publish's new field, is
 * read as it would be once published; anyone else, whose changes to those settings the server refuses anyway, asks
 * with the settings as they're published (`read(id)`).
 */
export function askedWithSettings(
  sourced: readonly string[],
  read: (collection: string, settings?: CollectionFile) => Promise<SourcedItem[]>,
  owner: () => boolean,
): SourcesFor {
  return (content) => {
    if (sourced.length === 0) return undefined;
    return Object.fromEntries(
      sourced.map((id) => {
        const collection = content.collections.find((one) => one.id === id);
        return [id, { items: () => (collection && owner() ? read(id, collection.settings) : read(id)) }];
      }),
    );
  };
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
    /** The sources the admin panel reads, or what gives them for the site as the changes would leave it. */
    sources?: CollectionSources | SourcesFor;
    /** Every collection whose items come from a source, by id: those without one in `sources` the admin panel can't read. */
    sourced?: readonly string[];
  },
): Promise<PublishChecks> {
  const { blocks, code } = site;
  const given = typeof site.sources === "function" ? undefined : site.sources;
  const sourced = site.sourced ?? Object.keys(given ?? {});
  const unreachable = new Set(sourced.filter((id) => !site.sources || (given && !Object.hasOwn(given, id))));
  let leftOut: string[] | undefined;
  // As visitors see it, with sourced collections' items, so links to their pages aren't missing.
  let before = loaded.shown ?? loaded.content;
  let after: SiteContent;
  try {
    after = await contentWithChanges(source, changes, sourced);
  } catch (error) {
    // A sign-in that ran out is for signing in again, never for publishing without the checks.
    if (error instanceof SignInError) throw error;
    return { blocking: [], warnings: [], content: before };
  }
  const sources = typeof site.sources === "function" ? site.sources(after) : site.sources;
  let read: [SiteContent, SiteContent] | undefined;
  if (sources) {
    // Asked each time, so publishing again retries a source that couldn't be read, here or as the site loaded, and
    // for the site as it is now too, so an item the other system removed since the site loaded isn't counted as one
    // the publish leaves out. Items left out are named below (`leftOut`), so nothing is logged in the editor's
    // browser, as `readShown()`.
    const sourcesBefore = (typeof site.sources === "function" ? site.sources(loaded.content) : site.sources) ?? {};
    try {
      read = await Promise.all([
        withSourcedCollections(loaded.content, sourcesBefore, () => {}),
        withSourcedCollections(after, sources, () => {}),
      ]);
    } catch (error) {
      if (error instanceof SignInError) throw error;
      const ids = after.collections.filter((one) => Object.hasOwn(sources, one.id)).map((one) => one.id);
      // Changes to a sourced collection's settings can't be checked without its items, so they wait for the source.
      // Anything else is checked as a static site's is: without the items, and leaving alone links that could go to
      // their pages (`unreachable`), so an outage elsewhere never stops a change that can't touch them.
      if (ids.some((id) => changes.some((change) => change.path === collectionSettingsFile(id)))) {
        return { blocking: [], warnings: [], unread: ids, content: after };
      }
      for (const id of ids) unreachable.add(id);
    }
  }
  if (sources && read) {
    [before, after] = read;
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
    ...withoutUnreadLinks(
      checkSite(before, { media: mediaAddresses(loaded.media), blocks, pages: pagesBefore }),
      before,
      unreachable,
    ),
    ...renderedBefore,
  ];
  const problems = [
    ...withoutUnreadLinks(
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
