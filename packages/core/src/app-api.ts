import {
  COLLECTION_SETTINGS_FILE,
  COLLECTIONS_DIR,
  COMPONENTS_DIR,
  CONTENT_DIR,
  HOOKS_DIR,
  INSTALLED_BLOCKS_DIR,
  LIB_DIR,
  PERMISSIONS_FILE,
  REDIRECTS_FILE,
  SITE_FILE,
  UPDATES_FILE,
} from "./content/paths.js";
import type { GitUser } from "./git.js";

/**
 * The header every request from the admin panel carries. Browsers send custom
 * headers to another site only after asking it (a CORS preflight), which the
 * API never answers, so another site can't make an editor's browser publish.
 */
export const APP_API_HEADER = "x-goodfellow-request";

/** What an editor may do on a full-stack site, as its own sign-in says. */
export type AppRole =
  /** Edits and publishes pages, collections' items, media, menus and the header and footer. */
  | "editor"
  /** Also changes Site Settings, redirects, collections' settings and templates, and blocks. */
  | "owner";

/** Who the site's own sign-in says is using the admin panel. */
export interface AppEditor {
  /** What stays the same about them, such as their username or email address. Shown as who's signed in. */
  login: string;
  /** Their name, shown in the admin panel and named as the author of what they publish. */
  name: string;
  /** Their email address, named with their name as the author of what they publish. */
  email: string;
  avatarUrl?: string;
  role: AppRole;
}

/** The admin panel's view of a session, from the `session` endpoint. */
export type AppSession =
  | {
      signedIn: true;
      user: GitUser;
      role: AppRole;
      /** Where signing out goes, if the site has an address for it. */
      signOut?: string;
      /** The AI services the site's server has keys for. */
      ai: string[];
      /** The site's repository holds only its content, as `GitBackend.contentOnly`. */
      contentOnly?: boolean;
      /** Changes to the site's code, such as adding blocks, go to a developer for review (`AppApiOptions.codeChanges`). */
      codeReview?: boolean;
    }
  | {
      signedIn: false;
      /** Where to sign in. */
      signIn: string;
      /** Signed in, but the site's sign-in says they may not edit it. */
      notAllowed?: boolean;
      signOut?: string;
    };

/**
 * Files only owners may change: Site Settings, redirects and updates, editors'
 * permissions, custom CSS and code, collections' settings and templates, and
 * installed blocks' code.
 */
export function isSettingsPath(path: string): boolean {
  if (path === SITE_FILE || path === REDIRECTS_FILE || path === UPDATES_FILE || path === PERMISSIONS_FILE) return true;
  if (path.startsWith(`${CONTENT_DIR}/styles/`) || path.startsWith(`${CONTENT_DIR}/code/`)) return true;
  if (path.startsWith(`${COLLECTIONS_DIR}/`) && path.endsWith(`/${COLLECTION_SETTINGS_FILE}`)) return true;
  return [INSTALLED_BLOCKS_DIR, COMPONENTS_DIR, LIB_DIR, HOOKS_DIR].some((dir) => path.startsWith(`${dir}/`));
}
