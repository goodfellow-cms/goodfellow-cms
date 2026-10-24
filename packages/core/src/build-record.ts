/**
 * What a build says about when the site it built stops being current, so the
 * nightly check (`goodfellow nightly`) builds the site only when visitors would
 * see something new. Builds write a `BuildRecord` to `BUILD_RECORD_PATH`: the
 * commit and Goodfellow release they built, and `currentUntil`, the next time
 * anything the site shows by today's date changes.
 *
 * Code that shows something by today's date (`todayIn()`) says when it would
 * show something else with `changesOn()`, such as the day after an event's
 * next time ends. The calendar functions in `calendar.ts` do it themselves.
 * Changes are kept on `globalThis`, so every copy of this module a build loads
 * shares them.
 */
import { z } from "zod";

/** Where builds put the record, from the site's root. */
export const BUILD_RECORD_PATH = "goodfellow-build.json";

export interface BuildRecord {
  version: 1;
  /** The Goodfellow release the site was built with, such as `0.3.0`. */
  goodfellow: string;
  /** The commit of the repository the site was built from, where the build could tell. */
  commit?: string;
  /** The content repository's commit, for a site that keeps its content in one of its own. */
  content?: string;
  /** When it was built, as an ISO time. */
  builtAt: string;
  /**
   * When something the site shows by today's date, or a scheduled change,
   * would make it different, as an ISO time. Without it, the site stays as it
   * is until something is published.
   */
  currentUntil?: string;
}

const recordSchema = z.object({
  version: z.literal(1),
  goodfellow: z.string(),
  commit: z.string().optional(),
  content: z.string().optional(),
  builtAt: z.string(),
  currentUntil: z.string().optional(),
});

/** A build record read from a site, or `undefined` where it isn't one. */
export function parseBuildRecord(text: string): BuildRecord | undefined {
  try {
    const parsed = recordSchema.safeParse(JSON.parse(text));
    return parsed.success ? (parsed.data as BuildRecord) : undefined;
  } catch {
    return undefined;
  }
}

/** The record as builds write it. */
export function serializeBuildRecord(record: BuildRecord): string {
  const { version, goodfellow, commit, content, builtAt, currentUntil } = record;
  return `${JSON.stringify(
    {
      version,
      goodfellow,
      ...(commit && { commit }),
      ...(content && { content }),
      builtAt,
      ...(currentUntil && { currentUntil }),
    },
    null,
    2,
  )}\n`;
}

// Date changes -----------------------------------------------------------------

interface DateChanges {
  /** The earliest date reported, as `YYYY-MM-DD` in the site's time zone. */
  next?: string;
  listeners: Set<(date: string) => void>;
}

const KEY = Symbol.for("goodfellow.dateChanges");
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dateChanges(): DateChanges {
  const holder = globalThis as { [KEY]?: DateChanges };
  holder[KEY] ??= { listeners: new Set() };
  return holder[KEY];
}

/**
 * Says that something shown by today's date would be different from `date`
 * (`YYYY-MM-DD`, in the site's time zone), such as the day after an event
 * ends, so the site is built again then. Saying a date too early only builds
 * the site sooner; too late would leave it out of date.
 */
export function changesOn(date: string | undefined): void {
  if (!date || !DATE.test(date)) return;
  const changes = dateChanges();
  if (changes.next !== undefined && changes.next <= date) return;
  changes.next = date;
  for (const listener of changes.listeners) listener(date);
}

/** The earliest date `changesOn()` was given since `resetDateChanges()`, if any. */
export function nextDateChange(): string | undefined {
  return dateChanges().next;
}

/** Forgets the dates given so far, before a build renders the site. */
export function resetDateChanges(): void {
  dateChanges().next = undefined;
}

/** Calls `listener` with each new earliest date. Returns a function that stops it. */
export function onDateChange(listener: (date: string) => void): () => void {
  const { listeners } = dateChanges();
  listeners.add(listener);
  return () => listeners.delete(listener);
}
