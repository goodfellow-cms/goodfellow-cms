/**
 * Puck in the site's frame, for one page, header, footer, template or item.
 * Its own header isn't shown: the admin panel's page draws the title, Undo,
 * Redo and Publish outside the frame, and asks this one for what to show.
 */
import {
  allPages,
  type BlockIcon,
  contentInLanguage,
  describedIn,
  expandSyncedBlocks,
  findEntry,
  focusPosition,
  hasLanguages,
  languageHome,
  languageLinks,
  mainLanguage,
  type PageFile,
  type PageView,
  pageLinks,
  pageView,
  pathLanguage,
  todayIn,
} from "@goodfellow-cms/core";
import {
  type AdminLinkProps,
  type AdminPlace,
  blockIcon,
  mediaFieldKind,
  pageHeadings,
  type SiteContextValue,
  SiteProvider,
  siteMetadata,
} from "@goodfellow-cms/react";
import {
  type Config,
  createUsePuck,
  type Data,
  type FieldProps,
  legacySideBarPlugin,
  migrate,
  Puck,
  registerOverlayPortal,
  type UiState,
  useGetPuck,
} from "@puckeditor/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin, useSiteContent } from "../admin-context.js";
import { storedData } from "../changes.js";
import { withBlocksInPlace } from "../editor-change.js";
import { useEditorText } from "../editor-text.js";
import { MediaChooser } from "../media-library.js";
import { showMediaInPreview } from "../media-previews.js";
import { SETTINGS_SECTIONS } from "../router.js";
import { SharePreview } from "../share-preview.js";
import { useDarkMode } from "../theme.js";
import { drawerItemWithIcon } from "./block-icon.js";
import { BlockSearch, searchableBlocks } from "./block-search.js";
import { useCanvasStyles } from "./canvas-styles.js";
import type { Channel } from "./channel.js";
import { entryConfig } from "./entry-fields.js";
import { useAdminClient, useFrameCode } from "./frame-site.js";
import { withLabels } from "./labels.js";
import { withOwnersOnlyLocked } from "./owners-only.js";
import { type ShownSettings, shownSettings } from "./page-settings.js";
import type { EditorChange, EditorOpen, EditorOpened, EditorState } from "./protocol.js";
import { SiteFrame } from "./site-frame.js";
import { withStyleFields } from "./style-field.js";
import { withSyncedBlockDrawing } from "./synced-block.js";
import { withTableFields } from "./table-field.js";

const usePuck = createUsePuck();

/** Where in the admin panel blocks' notes link to. */
const ADMIN_PLACES: Record<AdminPlace, string> = {
  settings: "#/settings/general",
  "contact-settings": `#/settings/general?section=${SETTINGS_SECTIONS.contact}`,
  "forms-settings": `#/settings/general?section=${SETTINGS_SECTIONS.forms}`,
  "theme-settings": "#/settings/theme",
  "language-settings": "#/settings/languages",
  "comments-settings": "#/settings/comments",
};

/** Puck's text field, with the media library's chooser below it for fields that hold a media address. */
function TextFieldWithMedia({
  field,
  value,
  onChange,
  readOnly,
  children,
}: FieldProps<{ type: string; metadata?: unknown }> & { children: ReactNode }) {
  const kind = mediaFieldKind(field);
  if (!kind || readOnly) return <>{children}</>;
  return (
    <div className="gfa-media-puck-field">
      {children}
      <MediaChooser value={typeof value === "string" ? value : ""} kind={kind} onChange={(url) => onChange(url)} />
    </div>
  );
}

/**
 * Wraps the editor's canvas the way the live site wraps it, so custom CSS
 * targeting `.gf-header`, `.gf-main` or `.gf-footer` previews correctly, in
 * `.gf-canvas`, which the site's CSS is scoped to. Pages also show the site's
 * header and footer, read-only, for context.
 */
function canvasConfig(
  kind: EditorOpen["kind"],
  config: Config,
  layoutConfig: Config,
  header: Data,
  footer: Data,
  site: SiteContextValue,
): Config {
  const render =
    kind === "page" || kind === "template"
      ? ({ children, className }: { children?: ReactNode; className?: string }) => (
          <div className="gf-canvas">
            <SiteFrame layoutConfig={layoutConfig} header={header} footer={footer} site={site} className={className}>
              {children}
            </SiteFrame>
          </div>
        )
      : ({ children }: { children?: ReactNode }) => (
          <div className="gf-canvas">
            {kind === "header" ? (
              <header className="gf-header">{children}</header>
            ) : kind === "footer" ? (
              <footer className="gf-footer">{children}</footer>
            ) : (
              <main className="gf-main">{children}</main>
            )}
          </div>
        );
  return { ...config, root: { ...config.root, render } } as Config;
}

/** Puck's fields and blocks as JSON, for the AI assistant in the admin panel's page. */
function describeConfig(config: Config): Config {
  return JSON.parse(
    JSON.stringify({
      components: Object.fromEntries(
        Object.entries(config.components).map(([name, component]) => [
          name,
          { label: component.label, fields: component.fields ?? {}, defaultProps: component.defaultProps },
        ]),
      ),
      root: { fields: config.root?.fields ?? {} },
    }),
  ) as Config;
}

/**
 * Tells the admin panel's page what Puck shows, as it changes, and does what it
 * asks: Undo, Redo, the sidebars, and the AI assistant's changes. Rendered in
 * place of Puck's header, so it's inside Puck.
 */
function Bridge({ channel, settings }: { channel: Channel; settings: ShownSettings }) {
  const getPuck = useGetPuck();
  const data = usePuck((state) => state.appState.data);
  const selected = usePuck((state) => state.selectedItem);
  const past = usePuck((state) => state.history.hasPast);
  const future = usePuck((state) => state.history.hasFuture);
  const ui = usePuck((state) => state.appState.ui);

  useEffect(() => {
    const state: EditorState = {
      data: settings.keep(data),
      selected: selected ?? null,
      past,
      future,
      leftSideBarVisible: ui.leftSideBarVisible,
      rightSideBarVisible: ui.rightSideBarVisible,
      leftSideBarWidth: ui.leftSideBarWidth,
      rightSideBarWidth: ui.rightSideBarWidth,
    };
    channel.emit("editor.state", state);
  }, [channel, settings, data, selected, past, future, ui]);

  useEffect(() => {
    const stops = [
      channel.handle("editor.data", () => settings.keep(getPuck().appState.data)),
      channel.handle("editor.undo", () => getPuck().history.back()),
      channel.handle("editor.redo", () => getPuck().history.forward()),
      channel.handle("editor.ui", (changes: Partial<UiState>) => {
        const next: Partial<UiState> = {};
        if (typeof changes?.leftSideBarVisible === "boolean") next.leftSideBarVisible = changes.leftSideBarVisible;
        if (typeof changes?.rightSideBarVisible === "boolean") next.rightSideBarVisible = changes.rightSideBarVisible;
        getPuck().dispatch({ type: "setUi", ui: next });
      }),
      channel.handle("editor.apply", (change: EditorChange) => {
        const { appState, dispatch, getSelectorForId } = getPuck();
        if (change.type === "root") {
          const { root } = settings.show({ ...appState.data, root: { ...appState.data.root, props: change.props } });
          dispatch({ type: "replaceRoot", root });
        } else if (change.type === "translate") {
          dispatch({
            type: "setData",
            data: (previous) =>
              settings.show({
                ...previous,
                root: { ...previous.root, props: { ...previous.root.props, ...change.props } },
                content: change.content,
              }),
          });
        } else if (change.type === "replace") {
          const selector = getSelectorForId(change.id);
          if (!selector) throw new Error("The block being changed is no longer on the page.");
          dispatch({
            type: "replace",
            destinationIndex: selector.index,
            destinationZone: selector.zone,
            // Puck replaces a block only if it keeps its id.
            data: { ...change.block, props: { ...change.block.props, id: change.id } },
            ui: { itemSelector: selector },
          });
        } else if (change.type === "append") {
          dispatch({
            type: "setData",
            data: (previous) => ({ ...previous, content: [...previous.content, ...change.blocks] }),
          });
        } else if (change.type === "detach") {
          if (!getSelectorForId(change.id)) throw new Error("The block being changed is no longer on the page.");
          dispatch({ type: "setData", data: (previous) => withBlocksInPlace(previous, change.id, change.blocks) });
        }
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [channel, settings, getPuck]);
  return null;
}

/** The item editor's sidebars: no blocks, so the left one starts closed; the fields' one starts wider. */
const ENTRY_UI: Partial<UiState> = { leftSideBarVisible: false, rightSideBarWidth: 520 };
const entryPlugins = [legacySideBarPlugin()];

/** Puck, set up for one page, header, footer, template or item: site context, previews and the bridge. */
/** Puck's permissions for something shown without editing: nothing can be changed, added, moved or removed. */
const READ_ONLY = { drag: false, duplicate: false, delete: false, edit: false, insert: false };

export function FrameEditor({ open, onOpened }: { open: EditorOpen; onOpened: (opened: EditorOpened) => void }) {
  const client = useAdminClient();
  const { config: siteConfig, pageConfig, layoutConfig, templateConfig, syncedConfig } = useFrameCode();
  const { preview, mediaPreviews } = useAdmin();
  const { content: loaded } = useSiteContent();
  const { kind, path, title, data } = open;
  const collection = open.collection
    ? loaded.collections.find((candidate) => candidate.id === open.collection)
    : undefined;
  // The site as the page's language shows it: its settings, menus, header, footer and items.
  const language =
    open.language ?? (kind === "page" ? pathLanguage(loaded.settings, path) : mainLanguage(loaded.settings));
  const content = useMemo(() => contentInLanguage(loaded, language), [loaded, language]);
  // On a site in several languages, where the page's language switch goes.
  const languages = useMemo(() => {
    if (!hasLanguages(loaded.settings)) return undefined;
    const page = kind === "page" ? allPages(loaded).find((candidate) => candidate.path === path) : undefined;
    const home = loaded.pages.find((candidate) => candidate.path === "/");
    const shown = page ?? home;
    return shown ? languageLinks(loaded, shown) : undefined;
  }, [loaded, kind, path]);

  // The site's look on the canvas, light or dark like the admin panel on sites with dark mode, with its media showing.
  const dark = useDarkMode();
  const canvasStyles = useMemo(
    () => ({ theme: loaded.settings.theme, customCss: loaded.customCss, scheme: dark ? "dark" : "light" }) as const,
    [loaded.settings.theme, loaded.customCss, dark],
  );
  useCanvasStyles(preview, canvasStyles, mediaPreviews);
  useEffect(() => showMediaInPreview(document, mediaPreviews), [mediaPreviews]);
  // Links on the canvas don't go anywhere, so the frame never leaves the editor; blocks' notes go through the admin panel.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.(".gf-canvas a[href]")) event.preventDefault();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Puck works with current data; files saved by older versions of Puck are upgraded first. Pages and
  // templates show their settings' defaults where they haven't chosen, which files leave out.
  const migrated = useMemo(() => migrate(data), [data]);
  const settings = useMemo<ShownSettings>(
    () =>
      kind === "page" || kind === "template"
        ? shownSettings(migrated, kind === "page" ? path : undefined)
        : { show: (shown) => shown, keep: (kept) => kept },
    [migrated, kind, path],
  );
  const initialData = useMemo(() => settings.show(migrated), [settings, migrated]);

  // Which block the page's added pages are for, as builds work it out, so the editor shows what the site will:
  // only that block links to its other pages. It's worked out again as the page changes.
  const viewOf = useCallback(
    (next: Data): PageView | undefined =>
      kind === "page" && path
        ? pageView(
            { path, file: "", content: { version: 1, data: storedData(next) } as PageFile },
            content,
            todayIn(content.settings.timeZone),
            siteConfig.blocks,
          )
        : undefined,
    [kind, path, content, siteConfig.blocks],
  );
  const [view, setView] = useState(() => viewOf(initialData));
  // Heading blocks' link names, which they render as their ids and On this page lists, as builds give them.
  const headingsOf = useCallback(
    (next: Data) =>
      kind === "entry" || kind === "header" || kind === "footer"
        ? []
        : pageHeadings(next, { components: siteConfig.blocks } as Config),
    [kind, siteConfig.blocks],
  );
  const [headings, setHeadings] = useState(() => headingsOf(initialData));
  const updateView = (next: Data) => {
    const found = viewOf(next);
    setView((current) => (current?.block === found?.block ? current : found));
    const listed = headingsOf(next);
    setHeadings((current) => (JSON.stringify(current) === JSON.stringify(listed) ? current : listed));
  };

  // Blocks' notes link to where they're fixed. Their links are in the canvas, so they take clicks through
  // Puck's overlay, and the admin panel's page leaves the editor, asking first about unpublished changes.
  const adminLink = useCallback(
    (place: AdminPlace): AdminLinkProps => {
      const href = ADMIN_PLACES[place];
      return {
        href,
        ref: (element) => registerOverlayPortal(element, { disableDrag: true }),
        onClick: (event) => {
          event.preventDefault();
          void client.call("navigate", href);
        },
      };
    },
    [client],
  );

  // Blocks a plugin adds can ask its services, which run in the plugin's own frame, through the admin panel's page.
  const callPlugin = useCallback(
    (plugin: string, method: string, ...args: unknown[]) => client.call("plugin.call", { plugin, method, args }),
    [client],
  );

  const site = useMemo<SiteContextValue>(
    () => ({
      settings: content.settings,
      menus: content.menus,
      path,
      collections: content.collections,
      pages: pageLinks(content),
      collection,
      ...(view && { view }),
      ...(headings.length > 0 && { headings }),
      ...(languages && { languages, home: languageHome(loaded, language) }),
      ...(content.descriptions && {
        descriptions: Object.fromEntries(
          Object.entries(content.descriptions).map(([url, description]) => [
            url,
            describedIn(description, content.settings.language),
          ]),
        ),
      }),
      ...(content.focus && {
        focus: Object.fromEntries(Object.entries(content.focus).map(([url, point]) => [url, focusPosition(point)])),
      }),
      ...(loaded.syncedBlocks && { syncedBlocks: loaded.syncedBlocks }),
      adminLink,
      callPlugin,
    }),
    [content, loaded, language, path, collection, view, headings, languages, adminLink, callPlugin],
  );
  const entry = kind === "entry" && collection && open.entry ? findEntry(loaded, collection.id, open.entry) : undefined;
  // Blocks' labels in the admin panel's language, which the block search and the AI assistant see too.
  const { puck: dictionary, labels } = useEditorText();
  // Synced blocks placed in what's edited, and in the header and footer around a page, are drawn in their place.
  const metadata = useMemo(() => siteMetadata(site), [site]);
  const drawn = useCallback(
    (config: Config) =>
      withSyncedBlockDrawing(config, {
        content: loaded,
        language,
        main: language === mainLanguage(loaded.settings),
        metadata,
        navigate: (href) => void client.call("navigate", href),
      }),
    [loaded, language, metadata, client],
  );
  const config = useMemo(() => {
    if (kind === "entry") {
      if (!collection || !entry) throw new Error("The item isn't in the site.");
      return withLabels(entryConfig(collection, entry.entry, content, { templateConfig, layoutConfig }), labels);
    }
    const edited =
      kind === "page"
        ? pageConfig
        : kind === "template"
          ? templateConfig
          : kind === "synced"
            ? syncedConfig
            : layoutConfig;
    return withLabels(
      withTableFields(
        canvasConfig(
          kind,
          drawn(edited),
          layoutConfig,
          expandSyncedBlocks(content.header.data as Data, loaded, language),
          expandSyncedBlocks(content.footer.data as Data, loaded, language),
          site,
        ),
      ),
      labels,
    );
  }, [
    kind,
    collection,
    entry,
    pageConfig,
    templateConfig,
    syncedConfig,
    layoutConfig,
    content,
    loaded,
    language,
    site,
    labels,
    drawn,
  ]);

  // Described with Style fields as the text they hold, which the AI assistant fills in.
  const described = useMemo(() => describeConfig(config), [config]);
  const puckConfig = useMemo(() => {
    const styled = kind === "entry" ? config : withStyleFields(config, content.settings.theme.colors);
    return open.ownersOnlyLocked ? withOwnersOnlyLocked(styled) : styled;
  }, [kind, config, content.settings.theme.colors, open.ownersOnlyLocked]);
  const told = useRef<Config>(undefined);
  useEffect(() => {
    if (told.current === described) return;
    told.current = described;
    onOpened({ config: described, data: migrated });
  }, [described, migrated, onOpened]);

  const ui = useMemo(() => ({ ...(kind === "entry" ? ENTRY_UI : {}), ...open.ui }), [kind, open.ui]);
  const searchable = useMemo(() => searchableBlocks(config, siteConfig), [config, siteConfig]);
  const drawerItem = useMemo(() => {
    const icons = new Map<string, BlockIcon>();
    for (const [name, block] of Object.entries(siteConfig.blocks)) {
      const icon = blockIcon(block);
      if (icon) icons.set(name, icon);
    }
    return drawerItemWithIcon(icons);
  }, [siteConfig]);
  const overrides = useMemo(
    () => ({
      header: () => <Bridge channel={client.channel} settings={settings} />,
      drawer: ({ children }: { children?: ReactNode }) => (
        <BlockSearch blocks={searchable} item={drawerItem}>
          {children}
        </BlockSearch>
      ),
      drawerItem,
      fieldTypes: { text: TextFieldWithMedia },
      // A page's own settings end with how links to it look when shared.
      ...(kind === "page" &&
        path && {
          fields: ({ children, itemSelector }: { children: ReactNode; itemSelector?: unknown }) => (
            <>
              {children}
              {!itemSelector && <SharePreview path={path} />}
            </>
          ),
        }),
    }),
    [client, settings, kind, path, searchable, drawerItem],
  );

  return (
    <div className={`gfa-editor-puck gfa-editor-for-${kind}`}>
      <SiteProvider value={site}>
        <Puck
          config={puckConfig}
          data={initialData}
          metadata={metadata}
          headerTitle={title}
          dictionary={dictionary}
          height="100%"
          iframe={{ enabled: false }}
          ui={ui}
          {...(kind === "entry" && { plugins: entryPlugins })}
          {...(open.readOnly && { permissions: READ_ONLY })}
          overrides={overrides}
          onChange={updateView}
        />
      </SiteProvider>
    </div>
  );
}
