/**
 * Scheduled publishing: pages and collections' entries that are on the site
 * only from a time (`showFrom`), until a time (`hideAfter`), or both. Times are
 * wall-clock times in the site's time zone (`content/site.json`'s `timeZone`,
 * UTC without one), and builds apply them: `shownContent()` is the site as
 * visitors see it at an instant, so pages are rebuilt when a change comes due.
 *
 * Scheduled content is in the site's repository from the moment it's
 * published, so on a public repository anyone can read it before it's shown.
 */
import { wallClock, zonedInstant } from "../calendar.js";
import { pageTitle } from "./changes.js";
import { type Collection, type Entry, entryTitle } from "./collections.js";
import { linkTarget } from "./links.js";
import type { Page, SiteContent } from "./load.js";
import { withStoredMedia } from "./media-storage.js";
import type { MenuItem, Menus } from "./schemas.js";

/** When a page or entry is on the site. Either time can be left out. */
export interface Schedule {
  /** Shown from this time, `YYYY-MM-DDTHH:MM` in the site's time zone. */
  showFrom?: string;
  /** Hidden from this time on, `YYYY-MM-DDTHH:MM` in the site's time zone. */
  hideAfter?: string;
}

/** A page's or entry's file's schedule, with only the times it has. */
export function scheduleOf(file: Schedule): Schedule {
  return {
    ...(file.showFrom && { showFrom: file.showFrom }),
    ...(file.hideAfter && { hideAfter: file.hideAfter }),
  };
}

/**
 * What a page's or item's file says besides its content: when it's shown,
 * and for a translation, its language (items only, since a page's is its
 * address) and what it translates.
 */
export interface FileDetails extends Schedule {
  inLanguage?: string;
  translationOf?: string;
  translatedFrom?: string;
}

/** A file's details, with only the ones it has. */
export function fileDetailsOf(file: FileDetails): FileDetails {
  return {
    ...scheduleOf(file),
    ...(file.inLanguage && { inLanguage: file.inLanguage }),
    ...(file.translationOf && { translationOf: file.translationOf }),
    ...(file.translatedFrom && { translatedFrom: file.translatedFrom }),
  };
}

/** A file's details with a new schedule in place of its own, keeping what it translates and its language. */
export function withSchedule(file: FileDetails, schedule: Schedule): FileDetails {
  const { showFrom: _from, hideAfter: _after, ...rest } = fileDetailsOf(file);
  return { ...rest, ...scheduleOf(schedule) };
}

/** Whether a schedule has either time. */
export function isScheduled(schedule: Schedule): boolean {
  return Boolean(schedule.showFrom || schedule.hideAfter);
}

/** The instant a schedule's time comes, in the site's time zone. */
export function scheduleInstant(time: string, timeZone: string | undefined): Date {
  return zonedInstant(time, timeZone);
}

/** Where a schedule puts something at an instant: not shown yet, shown, or hidden again. */
export type ScheduleState = "waiting" | "shown" | "hidden";

export function scheduleState(schedule: Schedule, now: Date, timeZone: string | undefined): ScheduleState {
  if (schedule.hideAfter && now >= scheduleInstant(schedule.hideAfter, timeZone)) return "hidden";
  if (schedule.showFrom && now < scheduleInstant(schedule.showFrom, timeZone)) return "waiting";
  return "shown";
}

/** Whether a schedule shows something at an instant. */
export function isShown(schedule: Schedule, now: Date, timeZone: string | undefined): boolean {
  return scheduleState(schedule, now, timeZone) === "shown";
}

/** What a schedule problem is, for the admin panel's words, or `undefined` if the times can be used. */
export function scheduleProblem(schedule: Schedule): "invalid" | "order" | undefined {
  for (const time of [schedule.showFrom, schedule.hideAfter]) {
    if (time !== undefined && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time) || wallClock(time) === undefined)) {
      return "invalid";
    }
  }
  if (schedule.showFrom && schedule.hideAfter && schedule.hideAfter <= schedule.showFrom) return "order";
  return undefined;
}

/** A menu without links to addresses that aren't shown, and without items left with nothing under them. */
function shownMenus(menus: Menus, hidden: ReadonlySet<string>): Menus {
  const shown = (item: { href: string }) => {
    const target = linkTarget(item.href);
    return !(target?.kind === "page" && hidden.has(target.path));
  };
  return Object.fromEntries(
    Object.entries(menus).map(([name, items]) => [
      name,
      items.filter(shown).map((item): MenuItem => {
        if (!item.children) return item;
        const { children, ...rest } = item;
        const kept = children.filter(shown);
        return kept.length > 0 ? { ...rest, children: kept } : rest;
      }),
    ]),
  );
}

/**
 * The site as visitors see it at an instant: without the pages and entries
 * its schedules don't show then, and without menus' links to their addresses.
 * Media a plugin keeps outside the repository is shown from its storage's
 * address (`withStoredMedia()`). Builds, `goodfellow dev` and Next.js's
 * routes use it; the admin panel edits the site as loaded.
 */
export function shownContent(content: SiteContent, now: Date = new Date()): SiteContent {
  return withStoredMedia(scheduledContent(content, now));
}

function scheduledContent(content: SiteContent, now: Date): SiteContent {
  const { timeZone } = content.settings;
  const hidden = new Set<string>();
  const pages = content.pages.filter((page) => {
    const shown = isShown(page.content, now, timeZone);
    if (!shown) hidden.add(page.path);
    return shown;
  });
  let changed = pages.length !== content.pages.length;
  const collections = content.collections.map((collection): Collection => {
    const entries = collection.entries.filter((entry) => {
      const shown = isShown(entry.content, now, timeZone);
      if (!shown && entry.path) hidden.add(entry.path);
      return shown;
    });
    if (entries.length === collection.entries.length) return collection;
    changed = true;
    return { ...collection, entries };
  });
  if (!changed) return content;
  const languageMenus =
    content.languageMenus &&
    Object.fromEntries(
      Object.entries(content.languageMenus).map(([language, menus]) => [language, shownMenus(menus, hidden)]),
    );
  return {
    ...content,
    pages,
    collections,
    menus: shownMenus(content.menus, hidden),
    ...(languageMenus && { languageMenus }),
  };
}

/** One change a schedule makes: a page or entry is shown, or hidden again. */
export interface ScheduledChange {
  kind: "show" | "hide";
  /** When, as written: `YYYY-MM-DDTHH:MM` in the site's time zone. */
  time: string;
  /** When, as an instant. */
  at: Date;
  /** The file whose schedule it is. */
  file: string;
  /** The page's or entry's name, as lists show it. */
  title: string;
  /** Its address, if it has a page. */
  path?: string;
  /** For an entry, its collection's id and its own name. */
  entry?: { collection: string; slug: string };
}

function changesOf(
  schedule: Schedule,
  timeZone: string | undefined,
  subject: Omit<ScheduledChange, "kind" | "time" | "at">,
): ScheduledChange[] {
  const found: ScheduledChange[] = [];
  if (schedule.showFrom) {
    found.push({ kind: "show", time: schedule.showFrom, at: scheduleInstant(schedule.showFrom, timeZone), ...subject });
  }
  if (schedule.hideAfter) {
    found.push({
      kind: "hide",
      time: schedule.hideAfter,
      at: scheduleInstant(schedule.hideAfter, timeZone),
      ...subject,
    });
  }
  return found;
}

/** Every change the site's schedules make, past and future, in the order they come. */
export function scheduledChanges(content: SiteContent): ScheduledChange[] {
  const { timeZone } = content.settings;
  const found = [
    ...content.pages.flatMap((page: Page) =>
      changesOf(page.content, timeZone, { file: page.file, title: pageTitle(page), path: page.path }),
    ),
    ...content.collections.flatMap((collection) =>
      collection.entries.flatMap((entry: Entry) =>
        changesOf(entry.content, timeZone, {
          file: entry.file,
          title: entryTitle(entry),
          ...(entry.path && { path: entry.path }),
          entry: { collection: collection.id, slug: entry.slug },
        }),
      ),
    ),
  ];
  return found.sort((a, b) => a.at.getTime() - b.at.getTime() || a.file.localeCompare(b.file));
}

/** The changes still to come after an instant, soonest first. */
export function upcomingChanges(content: SiteContent, now: Date = new Date()): ScheduledChange[] {
  return scheduledChanges(content).filter((change) => change.at > now);
}

/**
 * The changes that came due after `since` and by `now`, which a build at
 * `now` makes and one at `since` didn't, such as since the last hourly check.
 */
export function dueChanges(content: SiteContent, since: Date, now: Date = new Date()): ScheduledChange[] {
  return scheduledChanges(content).filter((change) => change.at > since && change.at <= now);
}
