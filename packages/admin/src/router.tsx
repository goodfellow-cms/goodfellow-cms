import { useEffect, useSyncExternalStore } from "react";

/**
 * A tiny hash router: the admin panel lives at a single address (`/admin`),
 * so it works on static hosts without any server-side rewrites.
 */
export interface Route {
  /** Path segments after `#/`, such as `["settings", "theme"]`. */
  segments: string[];
  params: URLSearchParams;
}

export function parseHash(hash: string): Route {
  const [path = "", query = ""] = hash.replace(/^#\/?/, "").split("?");
  return { segments: path.split("/").filter(Boolean), params: new URLSearchParams(query) };
}

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function useRoute(): Route {
  const hash = useSyncExternalStore(
    subscribe,
    () => window.location.hash,
    () => "",
  );
  return parseHash(hash);
}

type Guard = () => boolean;
const guards = new Set<Guard>();

/** Whether any screen has unpublished changes. */
export function hasUnsavedChanges(): boolean {
  return [...guards].some((isDirty) => isDirty());
}

/**
 * Registers a screen's unpublished changes, so leaving it (inside the admin
 * panel or by closing the tab) asks for confirmation first.
 */
export function useUnsavedChanges(isDirty: boolean): void {
  useEffect(() => {
    if (!isDirty) return;
    const guard = () => true;
    guards.add(guard);
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      guards.delete(guard);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [isDirty]);
}

/** Goes to another screen, asking first if there are unpublished changes. Returns whether it navigated. */
export function navigate(to: string, confirmLeave: () => boolean): boolean {
  if (hasUnsavedChanges() && !confirmLeave()) return false;
  guards.clear();
  window.location.hash = to;
  return true;
}

/** Sections of Site Settings' General tab that links can scroll to, as `#/settings/general?section=forms`. */
export const SETTINGS_SECTIONS = { contact: "contact", forms: "forms", consent: "consent" } as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[keyof typeof SETTINGS_SECTIONS];

/** The id of a General tab section's heading, which links scroll to. */
export function sectionId(section: SettingsSection): string {
  return `gfa-settings-${section}`;
}

export function pageEditorHref(path: string): string {
  return `#/pages/edit?path=${encodeURIComponent(path)}`;
}

/** An in-app link that asks before leaving a screen with unpublished changes. */
export function Link({
  href,
  confirmLeave,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string; confirmLeave: () => boolean }) {
  return (
    <a
      {...props}
      href={href}
      onClick={(event) => {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate(href, confirmLeave);
      }}
    />
  );
}

export type CollectionTab = "entries" | "template" | "settings";

export function collectionHref(id: string, tab: CollectionTab = "entries"): string {
  return tab === "entries" ? `#/collections/${id}` : `#/collections/${id}/${tab}`;
}

export function entryEditorHref(collection: string, slug: string): string {
  return `#/collections/${collection}/edit?slug=${encodeURIComponent(slug)}`;
}
