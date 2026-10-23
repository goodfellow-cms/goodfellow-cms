/**
 * The page, header, footer, template and item editors, in the admin panel's
 * page. Puck and the site's blocks run in a sandboxed frame (`frame/editor.tsx`);
 * this draws the editor's header around it, with Publish, which only this page
 * can do, and the AI assistant, which keeps editors' keys out of the frame.
 */
import { type Collection, type FileChange, serializeContent } from "@goodfellow-cms/core";
import { cx } from "@goodfellow-cms/react";
import type { Config, Data, UiState } from "@puckeditor/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "./admin-context.js";
import { AiPanel } from "./ai-panel.js";
import { storedData } from "./changes.js";
import { type FrameClient, useFrame, useFrameUpdates } from "./frame/host.js";
import type { EditorChange, EditorOpen, EditorState } from "./frame/protocol.js";
import { useUnsavedChanges } from "./router.js";
import { useStrings } from "./strings.js";
import { Button, ErrorMessage, PublishedNotice } from "./ui.js";

/** Pages and templates are shown between the header and footer; items show their page. */
export type EditorKind = EditorOpen["kind"];

export interface PuckEditorProps {
  kind: EditorKind;
  /** The page's address, or `/` for the header and footer (for menus that highlight the current page). */
  path: string;
  title: string;
  data: Data;
  /** The collection whose template or entry is being edited. */
  collection?: Collection;
  /** The item being edited, by its name, with `kind: "entry"`. */
  entry?: string;
  /** Returns why `data` can't be published yet, as text to show, or `undefined` if it can. */
  validate?: (data: Data) => string | undefined;
  /** The changes that publish `data`, and the save's description. */
  toChanges: (data: Data) => { changes: FileChange[]; message: string };
  actions?: ReactNode;
  /** Shown above the editor, such as help for the screen. */
  notice?: ReactNode;
  /** The language of the item being edited, on a site in several languages; pages' come from their address. */
  language?: string;
}

/** Where the editors' sidebars' widths are remembered: items' fields have a wider one of their own. */
const WIDTHS_KEY = "goodfellow-editor-sidebar-widths";
const ENTRY_WIDTHS_KEY = "goodfellow-entry-sidebar-widths";

type Widths = Pick<UiState, "leftSideBarWidth" | "rightSideBarWidth">;

function readWidths(key: string): Partial<Widths> {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(saved).filter(
        ([name, value]) =>
          (name === "leftSideBarWidth" || name === "rightSideBarWidth") && typeof value === "number" && value > 0,
      ),
    );
  } catch {
    return {};
  }
}

function writeWidths(key: string, widths: Partial<Widths>) {
  try {
    localStorage.setItem(key, JSON.stringify(widths));
  } catch {
    // Without storage, widths just aren't remembered.
  }
}

/** The widths the editor previews pages at: the editor's own, a tablet's and a phone's. */
const VIEWPORTS = [
  { width: null, label: "editor.viewport.full" },
  { width: 768, label: "editor.viewport.tablet" },
  { width: 360, label: "editor.viewport.phone" },
] as const;

/** Puck in the site's frame, set up for one page, header, footer, template or item, with publishing. */
export function PuckEditor({
  kind,
  path,
  title,
  data,
  collection,
  entry,
  validate,
  toChanges,
  actions,
  notice,
  language,
}: PuckEditorProps) {
  const t = useStrings();
  const { site, publish, reload } = useAdmin();
  const [status, setStatus] = useState<
    | { type: "idle" | "publishing" | "done" }
    | { type: "invalid"; message: string }
    | { type: "failed"; reason: "conflict" | "error"; error: unknown }
  >({ type: "idle" });

  // What's published, as the editor's frame opened it: files saved by older versions of Puck are upgraded there.
  const published = useRef<string>(undefined);
  const [state, setState] = useState<EditorState>();
  const [config, setConfig] = useState<Config>();
  const [viewport, setViewport] = useState<number | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const widthsKey = kind === "entry" ? ENTRY_WIDTHS_KEY : WIDTHS_KEY;

  // What the frame opens with, and opens again with if it starts again, such as when the dev server reloads it.
  const latest = useRef({ data, viewport });
  latest.current.viewport = viewport;
  const open = useMemo<EditorOpen>(
    () => ({
      kind,
      path,
      title,
      data,
      ...(collection && { collection: collection.id }),
      ...(entry && { entry }),
      ...(language && { language }),
    }),
    [kind, path, title, data, collection, entry, language],
  );
  const onConnect = useCallback(
    async (client: FrameClient) => {
      client.on("editor.state", (next) => {
        setState(next);
        latest.current.data = next.data;
        const { leftSideBarWidth, rightSideBarWidth } = next;
        const widths = readWidths(widthsKey);
        const changed =
          (leftSideBarWidth && leftSideBarWidth !== widths.leftSideBarWidth) ||
          (rightSideBarWidth && rightSideBarWidth !== widths.rightSideBarWidth);
        if (changed) {
          writeWidths(widthsKey, {
            ...widths,
            ...(leftSideBarWidth && { leftSideBarWidth: Math.round(leftSideBarWidth) }),
            ...(rightSideBarWidth && { rightSideBarWidth: Math.round(rightSideBarWidth) }),
          });
        }
      });
      const opened = await client.call("editor.open", {
        ...open,
        data: latest.current.data,
        ui: readWidths(widthsKey),
      });
      setConfig(opened.config);
      published.current ??= serializeContent(storedData(opened.data));
      if (latest.current.viewport) await client.call("editor.viewport", latest.current.viewport);
    },
    [open, widthsKey],
  );
  const { client, failed, frameProps } = useFrame({ mode: "editor", onConnect });
  useFrameUpdates(client);

  const dirty =
    state !== undefined &&
    published.current !== undefined &&
    serializeContent(storedData(state.data)) !== published.current;
  useUnsavedChanges(dirty);

  const onPublish = async () => {
    if (!state || !client) return;
    // As it is when Publish is pressed, even if the frame hasn't said so yet.
    const next = await client.call("editor.data").catch(() => state.data);
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
      setStatus({ type: "done" });
    } else if (result.reason === "checks") {
      setStatus({ type: "idle" });
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

  const showViewport = (width: number | null) => {
    setViewport(width);
    void client?.call("editor.viewport", width);
  };
  const apply = useCallback(
    async (change: EditorChange) => {
      if (!client) throw new Error("The editor isn't ready.");
      await client.call("editor.apply", change);
    },
    [client],
  );
  const aiOffered = site.ai !== false;

  return (
    <div className={cx("gfa-editor", `gfa-editor-${kind}`)}>
      {notice && <div className="gfa-editor-notice">{notice}</div>}
      <div className="gfa-editor-header">
        <div className="gfa-editor-tools">
          <Button
            variant="ghost"
            className="gfa-icon-button"
            aria-pressed={state?.leftSideBarVisible ?? false}
            title={t("editor.leftSidebar")}
            aria-label={t("editor.leftSidebar")}
            disabled={!state}
            onClick={() => void client?.call("editor.ui", { leftSideBarVisible: !state?.leftSideBarVisible })}
          >
            <PanelIcon side="left" />
          </Button>
          <Button
            variant="ghost"
            className="gfa-icon-button"
            aria-pressed={state?.rightSideBarVisible ?? false}
            title={t("editor.rightSidebar")}
            aria-label={t("editor.rightSidebar")}
            disabled={!state}
            onClick={() => void client?.call("editor.ui", { rightSideBarVisible: !state?.rightSideBarVisible })}
          >
            <PanelIcon side="right" />
          </Button>
        </div>
        <h2 className="gfa-editor-title">
          {title}
          {(kind === "page" || kind === "entry") && path && (
            <>
              {" "}
              <code>{path}</code>
            </>
          )}
        </h2>
        <fieldset className="gfa-editor-tools gfa-editor-viewports" aria-label={t("editor.viewport")}>
          {VIEWPORTS.map((option) => (
            <Button
              key={option.label}
              variant="ghost"
              aria-pressed={viewport === option.width}
              onClick={() => showViewport(option.width)}
            >
              {t(option.label)}
            </Button>
          ))}
        </fieldset>
        <div className="gfa-editor-tools">
          <Button variant="ghost" disabled={!state?.past} onClick={() => void client?.call("editor.undo")}>
            {t("action.undo")}
          </Button>
          <Button variant="ghost" disabled={!state?.future} onClick={() => void client?.call("editor.redo")}>
            {t("action.redo")}
          </Button>
        </div>
        <div className="gfa-header-actions">
          {actions}
          {aiOffered && (
            <Button aria-pressed={aiOpen} onClick={() => setAiOpen(!aiOpen)}>
              {t("ai.label")}
            </Button>
          )}
          <Button variant="primary" disabled={!state || status.type === "publishing"} onClick={() => void onPublish()}>
            {t("publish.button")}
          </Button>
          {status.type === "done" && <PublishedNotice onHide={hidePublished} />}
        </div>
      </div>
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
      <div className="gfa-editor-body">
        {aiOpen && aiOffered && (
          <aside className="gfa-editor-ai-panel" aria-label={t("ai.title")}>
            {state && config ? (
              <AiPanel
                context={{ kind, path, title, collection, language }}
                editor={{ data: state.data, selected: state.selected, config, apply }}
              />
            ) : (
              <p className="gfa-hint">{t("loading")}</p>
            )}
          </aside>
        )}
        <div className="gfa-editor-frame-wrap">
          {failed ? (
            <ErrorMessage message={t("editor.failed")} />
          ) : (
            <iframe className="gfa-editor-frame" title={t("editor.frame", { title })} {...frameProps} />
          )}
        </div>
      </div>
    </div>
  );
}

function PanelIcon({ side }: { side: "left" | "right" }) {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d={side === "left" ? "M9 4v16" : "M15 4v16"} />
    </svg>
  );
}
