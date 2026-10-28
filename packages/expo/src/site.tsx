import {
  type Collection,
  type Entry,
  type LanguageLink,
  languagePrefix,
  type Menus,
  type PageLink,
  type PageView,
  type SiteSettings,
} from "@goodfellow-cms/core";
import type { ApiCollectionsFile, ApiManifest, ApiPageFile, RichTextBlock } from "@goodfellow-cms/core/content-api";
import {
  type ComponentType,
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AppState, Linking, useColorScheme } from "react-native";
import {
  type ContentStorage,
  findPage,
  loadPage,
  MANIFEST_FILE,
  type ManifestPage,
  MEDIA_FOLDER,
  readSiteFiles,
  type SiteFiles,
  type SyncResult,
  siteAddress,
  syncSite,
} from "./sync.js";
import { type NativeTheme, nativeTheme } from "./theme.js";

/** A block as the app draws it: a React Native component given the block's props, as the page has them. */
// biome-ignore lint/suspicious/noExplicitAny: each block has props of its own
export type NativeBlock = ComponentType<any>;

/** The app's blocks, by the names content gives them, as the site's config has them. */
export type NativeBlocks = Record<string, NativeBlock>;

/** What the app shows in place of a block it has no code for, such as a `use dom` component that draws the web block. */
export type FallbackBlock = ComponentType<{ type: string; props: Record<string, unknown>; path: string }>;

/** A collection as the app has it, with its items' rich text as a simple structure by item and field. */
export interface NativeCollection extends Collection {
  richText: Record<string, Record<string, RichTextBlock[]>>;
}

/** What blocks read about the site, as web blocks read `useSite()`, in the language shown. */
export interface NativeSite {
  /** The Site address the app reads the site from. */
  site: string;
  settings: SiteSettings;
  menus: Menus;
  collections: NativeCollection[];
  /** The site's pages, for lists of pages. */
  pages: PageLink[];
  /** The address of the page shown, such as `/about`; empty in the header and footer, as on the web. */
  path: string;
  /** On an item's page, its item and collection. */
  entry?: Entry;
  collection?: NativeCollection;
  view?: PageView;
  /** The page in each of the site's languages, on a site in several. */
  languages?: LanguageLink[];
  /** The home page of the language shown, which the site's name links to. */
  home: string;
  theme: NativeTheme;
  /** Rich text of a block on the page, header or footer, as a simple structure, by the block's id and its prop. */
  richText(block: string, prop: string): RichTextBlock[] | undefined;
  /** Opens an address: the site's pages in the app, anything else in the phone's browser. */
  open(href: string): void;
  /** Where the app shows one of the site's media files from: its own copy, or the site. */
  media(address: string): string;
  /** An address on the site in full, such as for sharing. */
  address(href: string): string;
  /** Scrolls to a heading on the page by its id, as the web's `#` links do. */
  scrollTo(id: string): void;
  /** Lets a heading be scrolled to: `scrollTo()` finds it by its id. */
  anchor(id: string, measure: () => Promise<number | undefined>): () => void;
  /** Shows the site in another of its languages. */
  setLanguage(code: string): void;
  /** Shows the site light or dark, or like the phone (`undefined`), as its Dark mode switch block does. */
  setColorScheme(scheme: "light" | "dark" | undefined): void;
  colorScheme?: "light" | "dark";
}

const SiteContext = createContext<NativeSite | undefined>(undefined);

/** The site, for native blocks. */
export function useNativeSite(): NativeSite {
  const site = useContext(SiteContext);
  if (!site) throw new Error("useNativeSite() is for blocks inside <GoodfellowSite> or <GoodfellowPage>.");
  return site;
}

/** Shows `children` with another page's details, such as the page shown, or none in the header and footer. */
export function NativeSiteProvider({ value, children }: { value: NativeSite; children: ReactNode }) {
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/** The collections file's collections as blocks read them, as on the web. */
export function nativeCollections(file: ApiCollectionsFile | undefined): NativeCollection[] {
  return (file?.collections ?? []).map((collection) => ({
    id: collection.id,
    file: `content/collections/${collection.id}/_collection.json`,
    settings: { ...collection.settings, template: undefined } as unknown as Collection["settings"],
    entries: collection.entries.map(
      (entry): Entry => ({
        collection: collection.id,
        slug: entry.slug,
        file: "",
        ...(entry.path !== undefined && { path: entry.path }),
        content: { version: 1, fields: entry.fields } as Entry["content"],
      }),
    ),
    richText: Object.fromEntries(collection.entries.map((entry) => [entry.slug, entry.richText])),
  }));
}

/** Whether an address is one of the site's pages, which the app shows itself, rather than a file to open. */
export function isPageAddress(href: string): boolean {
  if (!href.startsWith("/") || href.startsWith("//")) return false;
  const path = href.split(/[?#]/)[0] ?? "";
  if (/^\/(media|calendars|feeds|api|admin|pagefind)(\/|$)/.test(path)) return false;
  return !/\.[a-z0-9]{2,5}$/i.test(path);
}

/** What `<GoodfellowSite>` keeps: the site's files, and how its copy is kept up to date. */
interface SiteState {
  manifest?: ApiManifest;
  files?: SiteFiles;
  media: Map<string, string>;
  /** `no-api`: the site has no content API, such as before it's rebuilt with it, or where its config turns it off. */
  status: "loading" | "ready" | "offline" | "newer-content" | "no-api" | "missing";
}

interface SiteRoot {
  site: string;
  storage: ContentStorage;
  blocks: NativeBlocks;
  fallback?: FallbackBlock;
  state: SiteState;
  language: string;
  setLanguage(code: string): void;
  colorScheme?: "light" | "dark";
  setColorScheme(scheme: "light" | "dark" | undefined): void;
  fonts: NativeTheme["fonts"];
  navigate(path: string): void;
  refresh(): Promise<SyncResult>;
  fetch?: typeof fetch;
}

const RootContext = createContext<SiteRoot | undefined>(undefined);

export function useSiteRoot(): SiteRoot {
  const root = useContext(RootContext);
  if (!root) throw new Error("Goodfellow's components go inside <GoodfellowSite>.");
  return root;
}

/** The site's status: whether its copy is ready, and why it isn't up to date when it isn't. */
export function useSiteStatus(): SiteState["status"] {
  return useSiteRoot().state.status;
}

export interface GoodfellowSiteProps {
  /** The Site address, as Site settings has it, such as `https://parish.example/`. */
  site: string;
  /** Where the app keeps its copy, such as `fileStorage()` from `@goodfellow-cms/expo/file-system`. */
  storage: ContentStorage;
  /** The blocks the app draws, such as `nativeBlocks` from `@goodfellow-cms/blocks/native`, with the site's own. */
  blocks: NativeBlocks;
  /** What shows in place of a block the app doesn't have, such as a `use dom` component; a note linking to the website otherwise. */
  fallback?: FallbackBlock;
  /** Which pages to keep ahead, so they show offline; every page unless given. */
  keep?: (page: ManifestPage) => boolean;
  /** The language to show at first: the site's main one unless given. */
  language?: string;
  /** Font families the app loaded for the theme's fonts, such as with expo-font. */
  fonts?: NativeTheme["fonts"];
  /** Opens one of the site's pages, such as with Expo Router; `<GoodfellowApp>` gives its own. */
  onNavigate?: (path: string) => void;
  fetch?: typeof fetch;
  children: ReactNode;
}

async function readMedia(storage: ContentStorage): Promise<Map<string, string>> {
  const media = new Map<string, string>();
  if (!storage.fileUri) return media;
  for (const name of await storage.list()) {
    if (!name.startsWith(MEDIA_FOLDER)) continue;
    const uri = await storage.fileUri(name);
    if (uri) media.set(`/media/${name.slice(MEDIA_FOLDER.length)}`, uri);
  }
  return media;
}

/**
 * Keeps the app's copy of the site, and brings it up to date when the app
 * starts and whenever it comes back to the front. Until it has a copy, it
 * shows nothing of the site: put a loading screen in `children` with
 * `useSiteStatus()`.
 */
export function GoodfellowSite(props: GoodfellowSiteProps) {
  const { site, storage, keep, fetch: fetcher } = props;
  const [state, setState] = useState<SiteState>({ media: new Map(), status: "loading" });
  const [language, setLanguage] = useState(props.language);
  const [colorScheme, setColorScheme] = useState<"light" | "dark" | undefined>();
  const running = useRef<Promise<SyncResult> | undefined>(undefined);

  const show = useCallback(
    async (manifest: ApiManifest | undefined, status: SiteState["status"], code: string | undefined) => {
      if (!manifest) return setState((current) => ({ ...current, status: status === "ready" ? "missing" : status }));
      const files = await readSiteFiles(storage, manifest, code ?? manifest.mainLanguage);
      setState({ manifest, files, media: await readMedia(storage), status: files ? status : "missing" });
    },
    [storage],
  );

  const refresh = useCallback(() => {
    running.current ??= syncSite({ site, storage, ...(keep && { keep }), ...(fetcher && { fetch: fetcher }) }).finally(
      () => {
        running.current = undefined;
      },
    );
    return running.current;
  }, [site, storage, keep, fetcher]);

  useEffect(() => {
    let current = true;
    // What the app kept shows at once; the copy is brought up to date behind it.
    (async () => {
      const text = await storage.read(MANIFEST_FILE);
      if (text && current) await show(JSON.parse(text) as ApiManifest, "ready", language);
      const result = await refresh();
      if (current) await show(result.manifest, result.problem ?? "ready", language);
    })();
    const subscription = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      refresh().then((result) => {
        if (current && result.changed.length + result.removed.length > 0) {
          show(result.manifest, result.problem ?? "ready", language);
        }
      });
    });
    return () => {
      current = false;
      subscription.remove();
    };
  }, [storage, refresh, show, language]);

  const navigate = props.onNavigate;
  const root = useMemo<SiteRoot>(
    () => ({
      site,
      storage,
      blocks: props.blocks,
      ...(props.fallback && { fallback: props.fallback }),
      state,
      language: language ?? state.manifest?.mainLanguage ?? "en",
      setLanguage,
      ...(colorScheme && { colorScheme }),
      setColorScheme,
      fonts: props.fonts ?? {},
      navigate: (path) => (navigate ? navigate(path) : Linking.openURL(siteAddress(site, state.manifest, path))),
      refresh,
      ...(fetcher && { fetch: fetcher }),
    }),
    [
      site,
      storage,
      props.blocks,
      props.fallback,
      props.fonts,
      state,
      language,
      colorScheme,
      navigate,
      refresh,
      fetcher,
    ],
  );
  return <RootContext.Provider value={root}>{props.children}</RootContext.Provider>;
}

/** A page of the site, from the app's copy, or downloaded when it's opened. `undefined` while it loads. */
export function usePage(path: string): { page?: ApiPageFile; status: "loading" | "ready" | "missing" } {
  const root = useSiteRoot();
  const { manifest } = root.state;
  const [found, setFound] = useState<{ path: string; page?: ApiPageFile; done: boolean }>({ path, done: false });
  useEffect(() => {
    if (!manifest) return;
    let current = true;
    const options = { site: root.site, storage: root.storage, ...(root.fetch && { fetch: root.fetch }) };
    loadPage(options, manifest, path).then((page) => {
      if (current) setFound({ path, ...(page && { page }), done: true });
    });
    return () => {
      current = false;
    };
  }, [manifest, path, root.site, root.storage, root.fetch]);
  if (found.path !== path || !found.done) return { status: "loading" };
  return found.page ? { page: found.page, status: "ready" } : { status: "missing" };
}

/** The address the app has for a page, as the manifest lists it, or "Page not found"'s. */
export function pagePath(manifest: ApiManifest | undefined, path: string): string {
  return (manifest && findPage(manifest, path)?.path) ?? path;
}

/** Where anchors are, by heading id, for `scrollTo()`. */
export type Anchors = Map<string, () => Promise<number | undefined>>;

/**
 * The site as blocks read it for a page (or for the header and footer, with
 * no page), in the language shown, with the theme in the phone's colors or
 * the visitor's choice.
 */
export function useNativeSiteValue(
  page: ApiPageFile | undefined,
  layout: { richText: Record<string, Record<string, RichTextBlock[]>> }[],
  scroll: { scrollTo(y: number): void; anchors: Anchors },
): NativeSite | undefined {
  const root = useSiteRoot();
  const system = useColorScheme();
  const { files, manifest, media } = root.state;
  const collections = useMemo(() => nativeCollections(files?.collections), [files?.collections]);
  if (!files) return undefined;
  const settings = files.site.settings;
  const scheme = root.colorScheme ?? (system === "dark" ? "dark" : "light");
  const entryPage = page?.entry;
  const collection = entryPage && collections.find((candidate) => candidate.id === entryPage.collection);
  const entry = entryPage && collection?.entries.find((candidate) => candidate.slug === entryPage.slug);
  const richText = (block: string, prop: string) =>
    page?.richText[block]?.[prop] ?? layout.find((part) => part.richText[block]?.[prop])?.richText[block]?.[prop];
  return {
    site: root.site,
    settings,
    menus: files.site.menus,
    collections,
    pages: files.site.pages,
    path: page?.path ?? "",
    ...(entry && { entry }),
    ...(collection && { collection }),
    ...(page?.view && { view: page.view }),
    ...(page?.languages && { languages: page.languages }),
    home: settings.language === manifest?.mainLanguage ? "/" : languagePrefix(settings.language),
    theme: nativeTheme(settings, scheme === "dark", root.fonts),
    richText,
    open: (href) => {
      if (href.startsWith("#")) return void scrollToAnchor(scroll, href.slice(1));
      if (isPageAddress(href)) return root.navigate(href);
      const url = href.startsWith("/") ? siteAddress(root.site, manifest, href) : href;
      if (/^(https?:|mailto:|tel:|webcal:)/i.test(url)) Linking.openURL(url);
    },
    media: (address) => media.get(address.split(/[?#]/)[0] ?? address) ?? siteAddress(root.site, manifest, address),
    address: (href) => siteAddress(root.site, manifest, href),
    scrollTo: (id) => void scrollToAnchor(scroll, id),
    anchor: (id, measure) => {
      scroll.anchors.set(id, measure);
      return () => {
        if (scroll.anchors.get(id) === measure) scroll.anchors.delete(id);
      };
    },
    setLanguage: root.setLanguage,
    setColorScheme: root.setColorScheme,
    ...(root.colorScheme && { colorScheme: root.colorScheme }),
  };
}

async function scrollToAnchor(scroll: { scrollTo(y: number): void; anchors: Anchors }, id: string): Promise<void> {
  const y = await scroll.anchors.get(id)?.();
  if (y !== undefined) scroll.scrollTo(y);
}
