import type {
  Collection,
  Entry,
  ImageSize,
  LanguageLink,
  LanguageMap,
  Menus,
  PageCredit,
  PageLink,
  PageView,
  SiteSettings,
  SyncedBlock,
} from "@goodfellow-cms/core";
import type { Metadata } from "@puckeditor/core";
import type { AnchorHTMLAttributes, ComponentType, ImgHTMLAttributes } from "react";

export interface SiteLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  href: string;
}

export interface SiteImageProps extends ImgHTMLAttributes<HTMLImageElement> {
  src: string;
  alt: string;
}

/**
 * Components that replace plain links and images, such as Next.js's `next/link`
 * and `next/image`. `<SiteLink>` and `<SiteImage>` use them where they can.
 */
export interface SiteComponents {
  /** Renders links to the site's own pages. Gets the address without the base path. */
  Link?: ComponentType<SiteLinkProps>;
  /** Renders the site's own images whose size is known. Gets the address with the base path. */
  Image?: ComponentType<SiteImageProps & ImageSize>;
}

/** What every block can know about the site and the page being rendered. */
/** A place in the admin panel that blocks' notes in the editor can link to: Site Settings, or a section of it. */
export type AdminPlace =
  | "settings"
  | "contact-settings"
  | "forms-settings"
  | "theme-settings"
  | "language-settings"
  | "comments-settings";

/** A link into the admin panel, for a block's note in the editor: spread it onto an `<a>`. */
export interface AdminLinkProps {
  href: string;
  onClick: (event: { preventDefault(): void }) => void;
  /** Lets the link take clicks through the editor's overlay on blocks. */
  ref: (element: HTMLElement | null) => (() => void) | undefined;
}

export interface SiteContextValue {
  settings: SiteSettings;
  menus: Menus;
  /** The URL path of the page being rendered, such as `/about`. */
  path: string;
  /** Every collection, with its entries. */
  collections: Collection[];
  /** The site's pages in the page's language, by address, for lists of pages (`pageLinks()`). */
  pages?: PageLink[];
  /** The collection whose template is being rendered or edited. */
  collection?: Collection;
  /** The entry being rendered, on an entry's page. */
  entry?: Entry;
  /**
   * On a page a block added (see `withPages`), such as a calendar's month or a
   * list's second page, and on the page it added it to: which block, and what
   * the page shows of it.
   */
  view?: PageView;
  /**
   * The path the site is served from, such as `/my-site/`, when the renderer
   * leaves adding it to blocks: `<SiteLink>` and `<SiteImage>` add it, and
   * `withBase()` adds it to any other address. Unset when the whole page is
   * rewritten afterwards, as `goodfellow build` does.
   */
  base?: string;
  /** Replacements for plain links and images, such as Next.js's. */
  components?: SiteComponents;
  /**
   * Where a plugin keeps the site's media, the address its files are public
   * at, as `content/media-storage.json` says: its files are the media
   * library's, wherever they're served.
   */
  mediaStorage?: string;
  /** The sizes of the site's images, by address (`/media/photo.jpg`), where they're known. */
  media?: Record<string, ImageSize>;
  /**
   * The widths the build makes smaller copies of the media library's photos
   * at (`IMAGE_WIDTHS`), which `<SiteImage>` lists in their `srcset`, so
   * browsers download the smallest that fills its space. Only builds that write
   * the copies set it: the development servers and the editor don't.
   */
  imageWidths?: readonly number[];
  /**
   * On a site in several languages, the page in each of them: its translation,
   * or the language's home page where it has none, for a language switch.
   */
  languages?: LanguageLink[];
  /**
   * In a layout shared by every page on a site in several languages, where
   * each page's translations are, for a language switch to work out its links
   * from the current address (`useCurrentPath()`).
   */
  languageMap?: LanguageMap;
  /** On a site in several languages, the home page of the page's language, such as `/es`, which the site's name links to. */
  home?: string;
  /** The credits of the photos the page shows, such as ones from Openverse, which the page lists at its end. */
  credits?: PageCredit[];
  /**
   * The media library's descriptions of the images the page shows, in its
   * language, by address, which `SiteImage` uses where a block leaves an
   * image's `alt` empty and doesn't hide it with `aria-hidden`.
   */
  descriptions?: Record<string, string>;
  /**
   * The media library's focal points of the images the page shows, as CSS
   * positions (`30% 60%`), by address, which `SiteImage` and backgrounds keep
   * in view wherever they're cut to fit.
   */
  focus?: Record<string, string>;
  /**
   * In the admin panel's editor only: the site's synced blocks, which the
   * Synced block block offers and draws. Where pages are built, each is put
   * in place of the block that places it (`expandSyncedBlocks()`), so they
   * aren't needed there.
   */
  syncedBlocks?: SyncedBlock[];
  /** In the admin panel's editor only: links to its screens, so a block's note can say where to fix something. */
  adminLink?: (place: AdminPlace) => AdminLinkProps;
  /**
   * In the admin panel's editor only: asks one of a plugin's services, by the
   * plugin's name, which its admin module answers in a frame of its own. A
   * plugin's blocks use it to reach what only its frame may, such as its own
   * service's addresses.
   */
  callPlugin?: (plugin: string, method: string, ...args: unknown[]) => Promise<unknown>;
}

/** The Puck metadata every block receives, mirroring `useSite()`. */
export function siteMetadata(site: SiteContextValue): Metadata {
  return {
    site: site.settings,
    menus: site.menus,
    path: site.path,
    collections: site.collections,
    collection: site.collection,
    entry: site.entry,
    view: site.view,
    languages: site.languages,
    syncedBlocks: site.syncedBlocks,
  };
}
