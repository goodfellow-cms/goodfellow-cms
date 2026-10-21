import {
  allPages,
  type ContentSource,
  checkSite,
  entryTitle,
  type FileChange,
  FOOTER_FILE,
  type GoodfellowConfig,
  HEADER_FILE,
  loadSiteContent,
  MEDIA_DIR,
  MENUS_FILE,
  type Page,
  pageView,
  publishProblems,
  REDIRECTS_FILE,
  renderedProblems,
  SITE_FILE,
  type SiteContent,
  type SiteProblem,
  todayIn,
} from "@goodfellow-cms/core";
import { createPuckConfigs, PageBody, preparePage } from "@goodfellow-cms/react";
import { createElement } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { pageTitle } from "./changes.js";
import { mediaUrl } from "./media.js";
import type { StringKey, Translate } from "./strings.js";

export interface PublishChecks {
  /** Errors the publish would bring, which stop it. */
  blocking: SiteProblem[];
  /** What the files it changes have wrong besides, which the editor can publish anyway. */
  warnings: SiteProblem[];
  /** The site as the publish would leave it, which names where each problem is. */
  content: SiteContent;
}

/** The media library's files as the addresses content uses, such as `/media/photo.jpg`. */
function mediaAddresses(paths: Iterable<string>): string[] {
  return [...paths].filter((path) => path.startsWith(`${MEDIA_DIR}/`)).map(mediaUrl);
}

/** The site as it would be once the changes are published, read like the site itself. */
function contentWithChanges(source: ContentSource, changes: FileChange[]): Promise<SiteContent> {
  const changed = new Map(changes.map((change) => [change.path, change]));
  return loadSiteContent({
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
  });
}

/** At most this many pages are rendered to check a publish, such as one that changes every item in a collection. */
const MAX_RENDERED = 10;

/**
 * The pages a publish changes, each with the file its own content comes from:
 * a page or item, an item's page for its collection's design, and the home
 * page for the header and footer.
 */
function pagesToRender(content: SiteContent, changed: ReadonlySet<string>): Array<{ page: Page; file: string }> {
  const pages = allPages(content);
  const targets = pages.filter((page) => changed.has(page.file)).map((page) => ({ page, file: page.file }));
  for (const collection of content.collections) {
    if (!changed.has(collection.file)) continue;
    const first = pages.find((page) => page.entry?.collection === collection.id);
    if (first && !targets.some((target) => target.page === first)) targets.push({ page: first, file: collection.file });
  }
  if ((changed.has(HEADER_FILE) || changed.has(FOOTER_FILE)) && targets.length === 0) {
    const home = pages.find((page) => page.path === "/") ?? pages[0];
    if (home) targets.push({ page: home, file: home.file });
  }
  return targets.slice(0, MAX_RENDERED);
}

/**
 * What only shows once pages are rendered, such as images without alt text:
 * each page the publish changes is rendered as the site shows it, outside the
 * page, and checked. A page that can't be rendered is left out, since the
 * editor's preview shows why.
 */
async function renderedChecks(
  content: SiteContent,
  changed: ReadonlySet<string>,
  config: GoodfellowConfig,
  today: string,
): Promise<SiteProblem[]> {
  const targets = pagesToRender(content, changed);
  if (targets.length === 0 || typeof document === "undefined") return [];
  const configs = createPuckConfigs(config);
  const container = document.createElement("div");
  const root = createRoot(container);
  const problems: SiteProblem[] = [];
  try {
    for (const { page, file } of targets) {
      try {
        // As builds show it, with its added pages' links on the block they're for.
        const view = pageView(page, content, today, config.blocks);
        const prepared = await preparePage(configs, content, view ? { ...page, view } : page);
        flushSync(() =>
          root.render(
            createElement(PageBody, {
              site: prepared.site,
              pageConfig: prepared.pageConfig,
              layoutConfig: prepared.layoutConfig,
              page: prepared.data,
              header: prepared.header,
              footer: prepared.footer,
            }),
          ),
        );
        problems.push(...renderedProblems({ html: container.innerHTML, path: page.path, file }));
      } catch {
        // Left out: the editor's preview shows what's wrong with the page.
      }
    }
  } finally {
    root.unmount();
  }
  return problems;
}

/**
 * The site checks for a publish: the site as it's loaded, and as the changes
 * would leave it, with the pages they change rendered. A site the changes
 * would leave unreadable isn't checked; loading it again after publishing
 * says what's wrong.
 */
export async function checkPublish(
  source: ContentSource,
  loaded: { content: SiteContent; media: string[] },
  changes: FileChange[],
  config: GoodfellowConfig,
): Promise<PublishChecks> {
  const { blocks } = config;
  let after: SiteContent;
  try {
    after = await contentWithChanges(source, changes);
  } catch {
    return { blocking: [], warnings: [], content: loaded.content };
  }
  const media = new Set(loaded.media);
  for (const change of changes) {
    if ("delete" in change) media.delete(change.path);
    else if ("bytes" in change) media.add(change.path);
  }
  const today = todayIn(after.settings.timeZone);
  const before = checkSite(loaded.content, { media: mediaAddresses(loaded.media), blocks, today });
  const changed = new Set(changes.map((change) => change.path));
  const problems = [
    ...checkSite(after, { media: mediaAddresses(media), blocks, today }),
    ...(await renderedChecks(after, changed, config, today)),
  ];
  const found = publishProblems(before, problems, changed);
  return { ...found, content: after };
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

/** What a problem means, in plain words. */
export function describeProblem(t: Translate, content: SiteContent, problem: SiteProblem): string {
  switch (problem.kind) {
    case "missing-page":
    case "missing-media":
      return t(`checks.${problem.kind}`, { place: problemPlace(t, content, problem.file), target: problem.target });
    case "no-title":
    case "no-description":
      return t(`checks.${problem.kind}`, { place: problemPlace(t, content, problem.file) });
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
