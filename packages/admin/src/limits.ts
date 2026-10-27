/**
 * What the signed-in person may change, for screens that show the rest
 * read-only. Publishing checks every change again (`outsideLimits()`), so
 * these only spare people changes they couldn't publish.
 */
import {
  type EditorLimits,
  mayChangeEntry,
  mayChangeLayout,
  mayChangeMedia,
  mayChangeMenus,
  mayChangePage,
  type SiteContent,
} from "@goodfellow-cms/core";
import { useAdmin } from "./admin-context.js";

/** Something an editor opens. */
export type Editable =
  | { kind: "page"; path: string }
  | { kind: "header" | "footer"; language?: string }
  | { kind: "template"; collection: string }
  | { kind: "entry"; collection: string; entry: string }
  | { kind: "media" }
  | { kind: "menus"; language?: string };

/** Whether someone with `limits` may change what's open. Collections' templates are their settings, which limits never cover. */
export function mayChange(content: SiteContent, limits: EditorLimits | undefined, what: Editable): boolean {
  if (!limits) return true;
  switch (what.kind) {
    case "page": {
      const page = content.pages.find((found) => found.path === what.path);
      return mayChangePage(content, limits, page ?? { path: what.path });
    }
    case "header":
    case "footer":
      return mayChangeLayout(content, limits, what.language);
    case "template":
      return false;
    case "entry": {
      const entry = content.collections
        .find((found) => found.id === what.collection)
        ?.entries.find((found) => found.slug === what.entry);
      return entry ? mayChangeEntry(content, limits, entry) : (limits.collections ?? []).includes(what.collection);
    }
    case "media":
      return mayChangeMedia(limits);
    case "menus":
      return mayChangeMenus(content, limits, what.language);
  }
}

/** Whether the signed-in person may change what's open, once the site has loaded. */
export function useMayChange(what: Editable): boolean {
  const { state, limits } = useAdmin();
  return state.status !== "ready" || mayChange(state.content, limits, what);
}
