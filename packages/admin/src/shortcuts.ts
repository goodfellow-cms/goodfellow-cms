/**
 * The admin panel's keyboard shortcuts, and what the Go to box lists. Frames
 * use it too: the editor's frame tells the page only which of
 * `FORWARDED_SHORTCUTS` was pressed, never what was typed.
 */
import { entryTitle, pageTitle, type SiteContent } from "@goodfellow-cms/core";
import { collectionHref, entryEditorHref, pageEditorHref, syncedBlockEditorHref } from "./router.js";

/** Every shortcut: add to a draft, undo, redo, the Go to box and the list of shortcuts. */
export type Shortcut = "save" | "undo" | "redo" | "goTo" | "help";

/** The shortcuts the editor's frame passes on to the page. Puck undoes and redoes in the frame itself. */
export const FORWARDED_SHORTCUTS = ["save", "goTo", "help"] as const satisfies readonly Shortcut[];

export type ForwardedShortcut = (typeof FORWARDED_SHORTCUTS)[number];

// What runs shortcuts pressed in frames: the page's `ShortcutsProvider`.
const runners = new Set<(shortcut: Shortcut) => void>();

/** Runs a shortcut pressed in a frame, as if pressed on the page. */
export function runShortcut(shortcut: Shortcut): void {
  for (const run of runners) run(shortcut);
}

/** Runs `run` for shortcuts frames pass on, until the function it returns is called. */
export function onShortcut(run: (shortcut: Shortcut) => void): () => void {
  runners.add(run);
  return () => runners.delete(run);
}

/** Whether a frame named a shortcut it may pass on. */
export function isForwardedShortcut(value: unknown): value is ForwardedShortcut {
  return typeof value === "string" && (FORWARDED_SHORTCUTS as readonly string[]).includes(value);
}

/** The parts of a key press shortcuts read. */
export interface KeyPress {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The shortcut a key press is, if any: Ctrl or ⌘ with S adds to a draft and
 * with K opens the Go to box, even while typing; with Z undoes and with
 * Shift+Z or Y redoes, outside text fields, which keep their own; and `?`
 * lists the shortcuts, outside text fields.
 */
export function shortcutFor(press: KeyPress, typing: boolean): Shortcut | undefined {
  const key = press.key.toLowerCase();
  const mod = (press.ctrlKey || press.metaKey) && !press.altKey;
  if (mod && !press.shiftKey && key === "s") return "save";
  if (mod && !press.shiftKey && key === "k") return "goTo";
  if (typing) return undefined;
  if (mod && key === "z") return press.shiftKey ? "redo" : "undo";
  if (mod && !press.shiftKey && key === "y") return "redo";
  if (!press.ctrlKey && !press.metaKey && !press.altKey && press.key === "?") return "help";
  return undefined;
}

/** Whether a key press belongs to a text field, which has its own undo and takes `?` as a letter. */
export function isTyping(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  if (element.isContentEditable) return true;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea" || tag === "select") return true;
  if (tag !== "input") return false;
  return !["button", "checkbox", "color", "radio", "range", "submit", "reset"].includes(
    (element as HTMLInputElement).type,
  );
}

/** Whether shortcuts should name ⌘ rather than Ctrl. */
export function usesCommandKey(platform: string): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/** Somewhere the Go to box goes. */
export interface GoToPlace {
  kind: "screen" | "settings" | "page" | "item" | "collection" | "synced";
  label: string;
  /** What else it's found by and shows, such as a page's address or an item's collection. */
  detail?: string;
  href: string;
}

/** The places the Go to box lists: the screens given, then the site's pages, collections, items and synced blocks. */
export function goToPlaces(content: SiteContent, screens: readonly GoToPlace[]): GoToPlace[] {
  const pages = content.pages.map<GoToPlace>((page) => ({
    kind: "page",
    label: pageTitle(page),
    detail: page.path,
    href: pageEditorHref(page.path),
  }));
  const collections = content.collections.map<GoToPlace>((collection) => ({
    kind: "collection",
    label: collection.settings.name,
    href: collectionHref(collection.id),
  }));
  const items = content.collections.flatMap((collection) =>
    collection.entries.map<GoToPlace>((entry) => ({
      kind: "item",
      label: entryTitle(entry),
      detail: collection.settings.name,
      href: entryEditorHref(collection.id, entry.slug),
    })),
  );
  const synced = (content.syncedBlocks ?? []).map<GoToPlace>((block) => ({
    kind: "synced",
    label: block.content.title || block.name,
    href: syncedBlockEditorHref(block.name),
  }));
  return [...screens, ...pages, ...collections, ...items, ...synced];
}

/** Text as the Go to box compares it: lowercase, without accents. */
function plain(text: string): string {
  return text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * The places whose name or detail has every word typed, those whose name
 * starts with what's typed first, at most `limit`.
 */
export function findPlaces(places: readonly GoToPlace[], query: string, limit = 50): GoToPlace[] {
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return places.slice(0, limit);
  const whole = plain(query.trim());
  const found = places.filter((place) => {
    const text = plain(`${place.label} ${place.detail ?? ""}`);
    return words.every((word) => text.includes(word));
  });
  const starts = found.filter((place) => plain(place.label).startsWith(whole));
  const rest = found.filter((place) => !plain(place.label).startsWith(whole));
  return [...starts, ...rest].slice(0, limit);
}
