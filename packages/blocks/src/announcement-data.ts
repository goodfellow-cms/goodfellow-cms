/**
 * What the Announcement bar and its version for apps share, with no React:
 * whether it shows today, and the hash a closed bar is remembered by.
 */
import { addDays, translationHash } from "@goodfellow-cms/core";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A day as the bar's settings write it (`2026-12-24`), or `undefined` for an empty or unreadable one. */
export function announcementDay(value: unknown): string | undefined {
  return typeof value === "string" && DAY.test(value.trim()) ? value.trim() : undefined;
}

/**
 * Whether the bar shows on `today` (`YYYY-MM-DD` in the site's time zone),
 * from its first day to its last, and the next day that changes, for the
 * nightly build (`changesOn()`).
 */
export function announcementShown(
  props: { showFrom?: unknown; hideAfter?: unknown },
  today: string,
): { shown: boolean; changes?: string } {
  const from = announcementDay(props.showFrom);
  const until = announcementDay(props.hideAfter);
  if (from && today < from) return { shown: false, changes: from };
  if (until && today > until) return { shown: false };
  return { shown: true, ...(until && { changes: addDays(until, 1) }) };
}

/** What a closed bar is remembered by: a hash of its message and link, so a new message shows again. */
export function announcementHash(message: string, link: string): string {
  return translationHash({ message: message.trim(), link: link.trim() });
}
