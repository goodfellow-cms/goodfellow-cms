import {
  type Collection,
  type FileChange,
  type PageFile,
  type PageView,
  pageView,
  serializeContent,
  todayIn,
} from "@goodfellow-cms/core";
import {
  type AdminLinkProps,
  type AdminPlace,
  cx,
  mediaFieldKind,
  type SiteContextValue,
  SiteProvider,
  siteMetadata,
} from "@goodfellow-cms/react";
import {
  type Config,
  type Data,
  type FieldProps,
  migrate,
  type Plugin,
  Puck,
  Render,
  registerOverlayPortal,
  type UiState,
} from "@puckeditor/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { aiPlugin } from "./ai-panel.js";
import { storedData } from "./changes.js";
import { MediaChooser } from "./media-library.js";
import { usePreviewStyles } from "./preview.js";
import { navigate, SETTINGS_SECTIONS, useUnsavedChanges } from "./router.js";
import { useStrings } from "./strings.js";
import { Button, ErrorMessage, PublishedNotice } from "./ui.js";

/** Pages and templates are shown between the header and footer; entries supply their own `config`. */
export type EditorKind = "page" | "header" | "footer" | "template" | "entry";

function Iframe({ children, document, site }: { children: ReactNode; document?: Document; site: SiteContextValue }) {
  const { content } = useSiteContent();
  const styles = useMemo(
    () => ({ theme: site.settings.theme, customCss: content.customCss }),
    [site, content.customCss],
  );
  usePreviewStyles(document, styles);
  return <>{children}</>;
}

/** The site's header and footer, read-only, around a page's content, the way the live site shows them. */
export function SiteFrame({
  layoutConfig,
  header,
  footer,
  site,
  className,
  children,
}: {
  layoutConfig: Config;
  header: Data;
  footer: Data;
  site: SiteContextValue;
  className?: string;
  children: ReactNode;
}) {
  const metadata = siteMetadata(site);
  return (
    <>
      {header.content.length > 0 && (
        <header className="gf-header" inert>
          <Render config={layoutConfig} data={header} metadata={metadata} />
        </header>
      )}
      <main className={cx("gf-main", className)}>{children}</main>
      {footer.content.length > 0 && (
        <footer className="gf-footer" inert>
          <Render config={layoutConfig} data={footer} metadata={metadata} />
        </footer>
      )}
    </>
  );
}

/**
 * Wraps the editor's canvas the way the live site wraps it, so custom CSS
 * targeting `.gf-header`, `.gf-main` or `.gf-footer` previews correctly. Pages
 * also show the site's header and footer, read-only, for context.
 */
function editorConfig(
  kind: EditorKind,
  config: Config,
  layoutConfig: Config,
  header: Data,
  footer: Data,
  site: SiteContextValue,
): Config {
  const render =
    kind === "page" || kind === "template"
      ? ({ children, className }: { children?: ReactNode; className?: string }) => (
          <SiteFrame layoutConfig={layoutConfig} header={header} footer={footer} site={site} className={className}>
            {children}
          </SiteFrame>
        )
      : ({ children }: { children?: ReactNode }) =>
          kind === "header" ? (
            <header className="gf-header">{children}</header>
          ) : (
            <footer className="gf-footer">{children}</footer>
          );

  return { ...config, root: { ...config.root, render } } as Config;
}

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

/** Where in the admin panel blocks' notes link to. */
const ADMIN_PLACES: Record<AdminPlace, string> = {
  settings: "#/settings/general",
  "contact-settings": `#/settings/general?section=${SETTINGS_SECTIONS.contact}`,
  "forms-settings": `#/settings/general?section=${SETTINGS_SECTIONS.forms}`,
  "theme-settings": "#/settings/theme",
};

export interface PuckEditorProps {
  kind: EditorKind;
  /** The page's address, or `/` for the header and footer (for menus that highlight the current page). */
  path: string;
  title: string;
  data: Data;
  /** The collection whose template or entry is being edited. */
  collection?: Collection;
  /** Replaces the Puck config `kind` would choose. */
  config?: Config;
  /** Returns why `data` can't be published yet, as text to show, or `undefined` if it can. */
  validate?: (data: Data) => string | undefined;
  /** The changes that publish `data`, and the save's description. */
  toChanges: (data: Data) => { changes: FileChange[]; message: string };
  actions?: ReactNode;
  /** Shown above the editor, such as help for the screen. */
  notice?: ReactNode;
  ui?: Partial<UiState>;
  plugins?: Plugin[];
  /**
   * Gives the right sidebar its own width, remembered under `key`, instead of
   * the width Puck shares between every editor.
   */
  rightSideBar?: { key: string; width: number };
}

/** Where Puck remembers the sidebars' widths for every editor. */
const PUCK_WIDTHS = "puck-sidebar-widths";

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Without storage, widths just aren't remembered.
  }
}

/**
 * A right sidebar width of this editor's own: the one it was left at, or `width`.
 * Puck saves every resize as the width for all editors, so the shared setting is
 * put back afterwards.
 */
function useOwnRightSideBar(own: PuckEditorProps["rightSideBar"]) {
  const [initial] = useState(() => {
    if (!own) return undefined;
    const saved = Number(readStorage(own.key));
    return Number.isFinite(saved) && saved > 0 ? saved : own.width;
  });
  const shared = useRef(readStorage(PUCK_WIDTHS));
  const onAction = useCallback(
    (action: { type: string; ui?: unknown }) => {
      if (!own || action.type !== "setUi" || typeof action.ui !== "object" || action.ui === null) return;
      const width = (action.ui as Partial<UiState>).rightSideBarWidth;
      if (typeof width !== "number") return;
      writeStorage(own.key, String(Math.round(width)));
      // Puck saves the width right after this action; then the shared one goes back to what it was.
      setTimeout(() => {
        const saved = readStorage(PUCK_WIDTHS);
        let widths: Record<string, unknown> = {};
        try {
          widths = saved ? JSON.parse(saved) : {};
        } catch {}
        let before: Record<string, unknown> = {};
        try {
          before = shared.current ? JSON.parse(shared.current) : {};
        } catch {}
        const { right: _ours, ...rest } = widths;
        const restored = before.right === undefined ? rest : { ...rest, right: before.right };
        writeStorage(PUCK_WIDTHS, Object.keys(restored).length > 0 ? JSON.stringify(restored) : null);
      }, 0);
    },
    [own],
  );
  return { width: initial, onAction: own ? onAction : undefined };
}

/** Puck, set up for one page, header, footer, template or entry: site context, live preview styles and publishing. */
export function PuckEditor({
  kind,
  path,
  title,
  data,
  collection,
  config: customConfig,
  validate,
  toChanges,
  actions,
  notice,
  ui,
  plugins,
  rightSideBar,
}: PuckEditorProps) {
  const t = useStrings();
  const { config: siteConfig, pageConfig, layoutConfig, templateConfig, publish, reload } = useAdmin();
  const { content } = useSiteContent();
  const [status, setStatus] = useState<
    | { type: "idle" | "publishing" | "done" }
    | { type: "invalid"; message: string }
    | { type: "failed"; reason: "conflict" | "error"; error: unknown }
  >({ type: "idle" });

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
  // Puck's overlay, and leave the editor the usual way, asking first about unpublished changes.
  const confirmLeave = t("unsaved.confirm");
  const adminLink = useCallback(
    (place: AdminPlace): AdminLinkProps => {
      const href = ADMIN_PLACES[place];
      return {
        href,
        ref: (element) => registerOverlayPortal(element, { disableDrag: true }),
        onClick: (event) => {
          event.preventDefault();
          navigate(href, () => window.confirm(confirmLeave));
        },
      };
    },
    [confirmLeave],
  );

  const site = useMemo<SiteContextValue>(
    () => ({
      settings: content.settings,
      menus: content.menus,
      path,
      collections: content.collections,
      collection,
      ...(view && { view }),
      adminLink,
    }),
    [content, path, collection, view, adminLink],
  );
  const config = useMemo(
    () =>
      customConfig ??
      editorConfig(
        kind,
        kind === "page" ? pageConfig : kind === "template" ? templateConfig : layoutConfig,
        layoutConfig,
        content.header.data as Data,
        content.footer.data as Data,
        site,
      ),
    [customConfig, kind, pageConfig, templateConfig, layoutConfig, content, site],
  );

  const published = useRef(serializeContent(storedData(initialData)));
  const [dirty, setDirty] = useState(false);
  useUnsavedChanges(dirty);

  const onPublish = async (next: Data) => {
    const problem = validate?.(next);
    if (problem) {
      setStatus({ type: "invalid", message: problem });
      return;
    }
    setStatus({ type: "publishing" });
    const { changes, message } = toChanges(next);
    const result = await publish(changes, message);
    if (result.ok) {
      published.current = serializeContent(storedData(next));
      setDirty(false);
      setStatus({ type: "done" });
    } else {
      setStatus({ type: "failed", reason: result.reason, error: result.error });
    }
  };

  // "Published." goes after a few seconds, or as soon as anything changes.
  const hidePublished = useCallback(
    () => setStatus((current) => (current.type === "done" ? { type: "idle" } : current)),
    [],
  );
  useEffect(() => {
    if (dirty) hidePublished();
  }, [dirty, hidePublished]);
  const justPublished = status.type === "done";

  const ownSideBar = useOwnRightSideBar(rightSideBar);
  const puckUi = useMemo(
    () => (ownSideBar.width ? { ...ui, rightSideBarWidth: ownSideBar.width } : ui),
    [ui, ownSideBar.width],
  );

  const aiLabel = t("ai.label");
  const allPlugins = useMemo(
    () => [
      ...(plugins ?? []),
      ...(siteConfig.ai === false ? [] : [aiPlugin({ kind, path, title, collection }, aiLabel)]),
    ],
    [plugins, siteConfig.ai, kind, path, title, collection, aiLabel],
  );

  const overrides = useMemo(
    () => ({
      iframe: ({ children, document }: { children: ReactNode; document?: Document }) => (
        <Iframe document={document} site={site}>
          {children}
        </Iframe>
      ),
      headerActions: ({ children }: { children: ReactNode }) => (
        <div className="gfa-header-actions">
          {actions}
          {children}
          {justPublished && <PublishedNotice onHide={hidePublished} />}
        </div>
      ),
      fieldTypes: { text: TextFieldWithMedia },
    }),
    [site, actions, justPublished, hidePublished],
  );

  return (
    <div className={cx("gfa-editor", `gfa-editor-${kind}`, siteConfig.ai !== false && "gfa-editor-ai")}>
      {notice && <div className="gfa-editor-notice">{notice}</div>}
      {status.type !== "idle" && status.type !== "done" && (
        <div className="gfa-editor-status">
          {status.type === "publishing" && <p className="gfa-notice">{t("publish.publishing")}</p>}
          {status.type === "invalid" && (
            <ErrorMessage
              message={status.message}
              action={<Button onClick={() => setStatus({ type: "idle" })}>{t("action.close")}</Button>}
            />
          )}
          {status.type === "failed" && (
            <ErrorMessage
              message={t(status.reason === "conflict" ? "publish.conflict" : "publish.error")}
              error={status.error}
              action={
                status.reason === "conflict" ? (
                  <Button onClick={() => void reload()}>{t("action.reload")}</Button>
                ) : (
                  <Button onClick={() => setStatus({ type: "idle" })}>{t("action.close")}</Button>
                )
              }
            />
          )}
        </div>
      )}
      <div className="gfa-editor-puck">
        <SiteProvider value={site}>
          <Puck
            config={config}
            data={initialData}
            metadata={siteMetadata(site)}
            headerTitle={title}
            headerPath={kind === "page" || kind === "entry" ? path : undefined}
            height="100%"
            iframe={{ syncHostStyles: false }}
            ui={puckUi}
            plugins={allPlugins}
            onAction={ownSideBar.onAction}
            overrides={overrides}
            onChange={(next) => {
              setDirty(serializeContent(storedData(next)) !== published.current);
              updateView(next);
            }}
            onPublish={onPublish}
          />
        </SiteProvider>
      </div>
    </div>
  );
}
