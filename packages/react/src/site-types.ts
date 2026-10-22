import type {
  Collection,
  Entry,
  ImageSize,
  LanguageLink,
  LanguageMap,
  Menus,
  PageCredit,
  PageView,
  SiteSettings,
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
export type AdminPlace = "settings" | "contact-settings" | "forms-settings" | "theme-settings" | "language-settings";

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
  /** The sizes of the site's images, by address (`/media/photo.jpg`), where they're known. */
  media?: Record<string, ImageSize>;
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
  /** In the admin panel's editor only: links to its screens, so a block's note can say where to fix something. */
  adminLink?: (place: AdminPlace) => AdminLinkProps;
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
  };
}
