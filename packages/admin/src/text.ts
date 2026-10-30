/**
 * The admin panel's English, with nothing to draw: every string a site's own
 * admin text or a language pack translates, by `sourceKey()`, and how much of
 * it a language's file says. For tools and tests outside the admin panel, such
 * as a language pack's own checks, which can't load the admin panel itself.
 */
import { adminTextSources } from "./admin-text-sources.js";
import { labels } from "./languages/es-labels.js";

export {
  type AdminTextTable,
  adminTextSources,
  type LanguageStatus,
  languageStatus,
  type SourceState,
  sourceKey,
  sourceState,
  sourcesToTranslate,
} from "./admin-text-sources.js";
export { PUCK_ENGLISH } from "./languages/en-puck.js";
export { defaultStrings } from "./strings.js";

/**
 * The labels Goodfellow's own blocks show, by their English: the built-in
 * blocks', their groups', the page settings' and Goodfellow's registry
 * blocks'. A site's own blocks add theirs.
 */
export const BUILT_IN_LABELS: readonly string[] = Object.keys(labels).sort();

/** Every string the admin panel shows in English, with Goodfellow's own blocks' labels. */
export function goodfellowAdminTextSources() {
  return adminTextSources(BUILT_IN_LABELS);
}
