import {
  type ContentSource,
  checkSite,
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
  type SiteContent,
  type SiteProblem,
  todayIn,
} from "@goodfellow-cms/core";
import type { ComponentConfig } from "@puckeditor/core";
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

/**
 * The site checks for a publish: the site as it's loaded, and as the changes
 * would leave it. A site the changes would leave unreadable isn't checked;
 * loading it again after publishing says what's wrong.
 */
export async function checkPublish(
  source: ContentSource,
  loaded: { content: SiteContent; media: string[] },
  changes: FileChange[],
  blocks: Record<string, ComponentConfig>,
): Promise<PublishChecks> {
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
  const problems = checkSite(after, { media: mediaAddresses(media), blocks, today });
  const found = publishProblems(
    before,
    problems,
    changes.map((change) => change.path),
  );
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
  }
}
