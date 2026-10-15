/**
 * Light and dark on a site's pages. Kept apart from the theme, with no
 * imports, since the Dark mode switch uses it in visitors' browsers.
 */
import type { Theme } from "./content/schemas.js";

/**
 * The attribute the admin panel's previews set on `<html>` to show a site
 * light (`light`) or dark (`dark`) whatever the computer's setting, as the
 * Dark mode switch does on live pages. Without it, pages follow the
 * visitor's setting.
 */
export const COLOR_SCHEME_ATTRIBUTE = "data-gf-color-scheme";

/**
 * Where a visitor's choice from the Dark mode switch is kept, in the
 * browser's `localStorage`: `light` or `dark`, or nothing to follow the
 * computer's setting.
 */
export const COLOR_SCHEME_STORAGE_KEY = "goodfellow.colorScheme";

/**
 * The script at the start of each page of a site with dark mode, which puts
 * back the visitor's choice from the Dark mode switch before the page is
 * shown, so it never flashes the other colors first.
 */
export function colorSchemeScript(theme: Theme): string | undefined {
  if (!theme.darkMode) return undefined;
  return `try{var s=localStorage.getItem(${JSON.stringify(COLOR_SCHEME_STORAGE_KEY)});if(s==="light"||s==="dark")document.documentElement.setAttribute(${JSON.stringify(COLOR_SCHEME_ATTRIBUTE)},s)}catch(e){}`;
}
