/**
 * Puck in the site's frame, for one page, header, footer, template or item.
 * Its own header isn't shown: the admin panel's page draws the title, Undo,
 * Redo and Publish outside the frame, and asks this one for what to show.
 */
import {
  allPages,
  contentInLanguage,
  findEntry,
  hasLanguages,
  languageHome,
  languageLinks,
  mainLanguage,
  type PageFile,
  type PageView,
  pageView,
  pathLanguage,
  todayIn,
} from "@goodfellow-cms/core";
import {
  type AdminLinkProps,
  type AdminPlace,
  mediaFieldKind,
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
import { MediaChooser } from "../media-library.js";
import { showMediaInPreview } from "../media-previews.js";
import { SETTINGS_SECTIONS } from "../router.js";
import { SharePreview } from "../share-preview.js";
import { useDarkMode } from "../theme.js";
import { useCanvasStyles } from "./canvas-styles.js";
import type { Channel } from "./channel.js";
import { entryConfig } from "./entry-fields.js";
import { useAdminClient, useFrameCode } from "./frame-site.js";
import type { EditorChange, EditorOpen, EditorOpened, EditorState } from "./protocol.js";
import { SiteFrame } from "./site-frame.js";

const usePuck = createUsePuck();

/** Where in the admin panel blocks' notes link to. */
const ADMIN_PLACES: Record<AdminPlace, string> = {
  settings: "#/settings/general",
  "contact-settings": `#/settings/general?section=${SETTINGS_SECTIONS.contact}`,
  "forms-settings": `#/settings/general?section=${SETTINGS_SECTIONS.forms}`,
  "theme-settings": "#/settings/theme",
  "language-settings": "#/settings/languages",
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
            ) : (
              <footer className="gf-footer">{children}</footer>
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
function Bridge({ channel }: { channel: Channel }) {
  const getPuck = useGetPuck();
  const data = usePuck((state) => state.appState.data);
  const selected = usePuck((state) => state.selectedItem);
  const past = usePuck((state) => state.history.hasPast);
  const future = usePuck((state) => state.history.hasFuture);
  const ui = usePuck((state) => state.appState.ui);

  useEffect(() => {
    const state: EditorState = {
      data,
      selected: selected ?? null,
      past,
      future,
      leftSideBarVisible: ui.leftSideBarVisible,
      rightSideBarVisible: ui.rightSideBarVisible,
      leftSideBarWidth: ui.leftSideBarWidth,
      rightSideBarWidth: ui.rightSideBarWidth,
    };
    channel.emit("editor.state", state);
  }, [channel, data, selected, past, future, ui]);

  useEffect(() => {
    const stops = [
      channel.handle("editor.data", () => getPuck().appState.data),
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
          dispatch({ type: "replaceRoot", root: { ...appState.data.root, props: change.props } });
        } else if (change.type === "translate") {
          dispatch({
            type: "setData",
            data: (previous) => ({
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
        }
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [channel, getPuck]);
  return null;
}

/** The item editor's sidebars: no blocks, so the left one starts closed; the fields' one starts wider. */
const ENTRY_UI: Partial<UiState> = { leftSideBarVisible: false, rightSideBarWidth: 520 };
const entryPlugins = [legacySideBarPlugin()];

/** Puck, set up for one page, header, footer, template or item: site context, previews and the bridge. */
export function FrameEditor({ open, onOpened }: { open: EditorOpen; onOpened: (opened: EditorOpened) => void }) {
  const client = useAdminClient();
  const { config: siteConfig, pageConfig, layoutConfig, templateConfig } = useFrameCode();
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
  useCanvasStyles(preview, canvasStyles);
  useEffect(() => showMediaInPreview(document, mediaPreviews), [mediaPreviews]);
  // Links on the canvas don't go anywhere, so the frame never leaves the editor; blocks' notes go through the admin panel.
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if ((event.target as Element | null)?.closest?.(".gf-canvas a[href]")) event.preventDefault();
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // Puck works with current data; files saved by older versions of Puck are upgraded first.
  const initialData = useMemo(() => migrate(data), [data]);

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
  const updateView = (next: Data) => {
    const found = viewOf(next);
    setView((current) => (current?.block === found?.block ? current : found));
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

  const site = useMemo<SiteContextValue>(
    () => ({
      settings: content.settings,
      menus: content.menus,
      path,
      collections: content.collections,
      collection,
      ...(view && { view }),
      ...(languages && { languages, home: languageHome(loaded, language) }),
      adminLink,
    }),
    [content, loaded, language, path, collection, view, languages, adminLink],
  );
  const entry = kind === "entry" && collection && open.entry ? findEntry(loaded, collection.id, open.entry) : undefined;
  const config = useMemo(() => {
    if (kind === "entry") {
      if (!collection || !entry) throw new Error("The item isn't in the site.");
      return entryConfig(collection, entry.entry, content, { templateConfig, layoutConfig });
    }
    return canvasConfig(
      kind,
      kind === "page" ? pageConfig : kind === "template" ? templateConfig : layoutConfig,
      layoutConfig,
      content.header.data as Data,
      content.footer.data as Data,
      site,
    );
  }, [kind, collection, entry, pageConfig, templateConfig, layoutConfig, content, site]);

  const described = useMemo(() => describeConfig(config), [config]);
  const told = useRef<Config>(undefined);
  useEffect(() => {
    if (told.current === described) return;
    told.current = described;
    onOpened({ config: described, data: initialData });
  }, [described, initialData, onOpened]);

  const ui = useMemo(() => ({ ...(kind === "entry" ? ENTRY_UI : {}), ...open.ui }), [kind, open.ui]);
  const overrides = useMemo(
    () => ({
      header: () => <Bridge channel={client.channel} />,
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
    [client, kind, path],
  );

  return (
    <div className={`gfa-editor-puck gfa-editor-for-${kind}`}>
      <SiteProvider value={site}>
        <Puck
          config={config}
          data={initialData}
          metadata={siteMetadata(site)}
          headerTitle={title}
          height="100%"
          iframe={{ enabled: false }}
          ui={ui}
          {...(kind === "entry" && { plugins: entryPlugins })}
          overrides={overrides}
          onChange={updateView}
        />
      </SiteProvider>
    </div>
  );
}
