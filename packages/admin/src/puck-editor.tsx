/**
 * The page, header, footer, template and item editors, in the admin panel's
 * page. Puck and the site's blocks run in a sandboxed frame (`frame/editor.tsx`);
 * this draws the editor's header around it, with Publish, which only this page
 * can do, and the AI assistant, which keeps editors' keys out of the frame.
 */
import {
  type Collection,
  checkEditedData,
  checkPuckData,
  describedConfig,
  type EditedDataProblem,
  type FileChange,
  type PluginEditorKind,
  serializeContent,
} from "@goodfellow-cms/core";
import { cx } from "@goodfellow-cms/react";
import type { Config, Data, UiState } from "@puckeditor/core";
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAdmin, useCanChangeSettings } from "./admin-context.js";
import { AiPanel } from "./ai-panel.js";
import { storedData } from "./changes.js";
import { applyEditorChange, findBlock } from "./editor-change.js";
import { type FrameClient, useFrame, useFrameUpdates } from "./frame/host.js";
import type { EditorChange, EditorOpen, EditorState } from "./frame/protocol.js";
import { editKeeper, type KeptEdit, keptEditKey } from "./kept-edits.js";
import { useMayChange } from "./limits.js";
import {
  type PluginEditorChange,
  PluginEditorFrame,
  type PluginEditorHandle,
  useEditorChoice,
} from "./plugin-editor.js";
import { useUnsavedChanges } from "./router.js";
import { type Translate, useStrings } from "./strings.js";
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
/** One thing an editor plugin gave back that the site can't keep, in words: the block and setting, then what's wrong. */
function problemLine(t: Translate, problem: EditedDataProblem): string {
  const where = problem.block ?? t("editor.plugin.pageSettings");
  return problem.field
    ? t("editor.plugin.problemField", { block: where, field: problem.field, message: problem.message })
    : t("editor.plugin.problem", { block: where, message: problem.message });
}

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

/** When unpublished changes were kept, as the computer writes dates and times. */
function keptTime(savedAt: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(savedAt);
}

/** How long typing has to stop before what's edited is kept in the browser. */
const KEEP_AFTER_MS = 1000;

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
  const { site, siteUrl, publish, reload, drafts } = useAdmin();
  const editable = useMayChange(
    kind === "page"
      ? { kind, path }
      : kind === "entry"
        ? { kind, collection: collection?.id ?? "", entry: entry ?? "" }
        : kind === "template"
          ? { kind, collection: collection?.id ?? "" }
          : { kind, ...(language && { language }) },
  );
  const readOnly = !editable;
  // An editor plugin chosen in this browser, for what it edits, in place of Puck.
  const editors = useEditorChoice(site.description, kind);
  const plugin = editors.chosen;
  const editorName = plugin?.editor?.title ?? plugin?.title ?? "";
  const [pluginEditor, setPluginEditor] = useState<{ handle: PluginEditorHandle; opened: Data }>();
  const [status, setStatus] = useState<
    | { type: "idle" | "publishing" | "done" }
    | { type: "invalid"; message: string; details?: string }
    | { type: "failed"; reason: "conflict" | "error"; error: unknown }
    // Someone else's version is open after a conflict, and this editor's own is kept to put back.
    | { type: "reloaded" }
    // Changes this browser kept that weren't published, offered back; `theirs` when someone has published since.
    | { type: "kept"; edit: KeptEdit; theirs: boolean }
  >({ type: "idle" });

  // What's published, as the editor's frame opened it: files saved by older versions of Puck are upgraded there.
  const published = useRef<string>(undefined);
  const [state, setState] = useState<EditorState>();
  const [config, setConfig] = useState<Config>();
  const [viewport, setViewport] = useState<number | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const widthsKey = kind === "entry" ? ENTRY_WIDTHS_KEY : WIDTHS_KEY;
  // Settings only owners may change, such as Custom HTML used as written, which full-stack sites' servers refuse from editors.
  const owner = useCanChangeSettings();
  // Where changes are kept in this browser as they're made, until they're published: the screen opens again for
  // another draft, so this stays the same while it's open.
  const keptKey = keptEditKey(
    siteUrl,
    {
      kind,
      path,
      ...(collection && { collection: collection.id }),
      ...(entry && { entry }),
      ...(language && { language }),
    },
    drafts.current?.name,
  );
  // Whether changes kept before have been looked for, which keeping new ones waits for, and whether any have been kept since.
  const [keptChecked, setKeptChecked] = useState(false);
  const lookedForKept = useRef(false);
  const keptSaved = useRef(false);
  /** Offers changes kept from before, once, when what's edited first opens as `opened` is published. */
  const offerKept = useCallback(
    async (opened: string) => {
      if (lookedForKept.current) return;
      lookedForKept.current = true;
      const edit = readOnly
        ? undefined
        : await editKeeper()
            .load(keptKey)
            .catch(() => undefined);
      if (edit && serializeContent(storedData(edit.data)) !== opened) {
        setStatus({ type: "kept", edit, theirs: edit.published !== opened });
      } else if (edit) {
        await editKeeper()
          .remove(keptKey)
          .catch(() => undefined);
      }
      setKeptChecked(true);
    },
    [readOnly, keptKey],
  );
  const offerKeptOnOpen = useRef(offerKept);
  offerKeptOnOpen.current = offerKept;

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
      ...(readOnly && { readOnly }),
      ...(!owner && { ownersOnlyLocked: true }),
    }),
    [kind, path, title, data, collection, entry, language, readOnly, owner],
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
      void offerKeptOnOpen.current(published.current);
      if (latest.current.viewport) await client.call("editor.viewport", latest.current.viewport);
    },
    [open, widthsKey],
  );
  const { client, failed, frameProps } = useFrame({ mode: "editor", onConnect });
  useFrameUpdates(client);

  // After someone else changed what's edited: how many times the editor has opened again, what it had before, and
  // whether the site's content is on its way.
  const reopened = useRef(0);
  const [pluginOpening, setPluginOpening] = useState(0);
  const kept = useRef<Data>(undefined);
  const reopening = useRef(false);

  /**
   * Opens what's edited again with `next`: the site's version (`theirs`), which then counts as published, or this
   * editor's own, kept from before, which is then a change to publish over theirs.
   */
  const reopen = useCallback(
    async (next: Data, theirs: boolean) => {
      latest.current.data = next;
      if (theirs) published.current = undefined;
      reopened.current += 1;
      if (plugin) {
        setPluginOpening(reopened.current);
        return;
      }
      if (!client) return;
      const opened = await client.call("editor.open", {
        ...open,
        data: next,
        reopened: reopened.current,
        ui: readWidths(widthsKey),
      });
      setConfig(opened.config);
      if (theirs) published.current = serializeContent(storedData(opened.data));
    },
    [plugin, client, open, widthsKey],
  );

  // The site's content after a conflict: what's edited opens again as it is now.
  useEffect(() => {
    if (!reopening.current) return;
    reopening.current = false;
    void reopen(data, true);
  }, [data, reopen]);

  /** Loads the site as someone else left it, keeping this editor's version to offer back. */
  const reloadAfterConflict = async () => {
    kept.current =
      plugin || !client ? latest.current.data : await client.call("editor.data").catch(() => latest.current.data);
    reopening.current = true;
    await reload();
    setStatus({ type: "reloaded" });
  };

  const dirty =
    state !== undefined &&
    published.current !== undefined &&
    serializeContent(storedData(state.data)) !== published.current;
  useUnsavedChanges(dirty);

  // Keeps what's edited in this browser once typing stops, and forgets it once nothing is left to publish. Not while
  // changes from before are offered, or this editor's own are kept to put back after someone else's were loaded.
  const keepPaused = status.type === "kept" || status.type === "reloaded";
  useEffect(() => {
    if (!keptChecked || keepPaused || readOnly || !state) return;
    const from = published.current;
    if (!dirty || from === undefined) {
      if (keptSaved.current) {
        keptSaved.current = false;
        void editKeeper()
          .remove(keptKey)
          .catch(() => undefined);
      }
      return;
    }
    const edited = state.data;
    const timer = setTimeout(() => {
      keptSaved.current = true;
      void editKeeper()
        .save(keptKey, { data: edited, published: from, savedAt: Date.now() })
        .catch(() => undefined);
    }, KEEP_AFTER_MS);
    return () => clearTimeout(timer);
  }, [keptChecked, keepPaused, readOnly, state, dirty, keptKey]);

  /** Opens the changes kept from before, if they're still something the site can publish. */
  const putKeptBack = (edit: KeptEdit) => {
    const checked = checkPuckData(edit.data, { description: site.description, kind });
    if (!checked.ok) {
      void editKeeper()
        .remove(keptKey)
        .catch(() => undefined);
      setStatus({
        type: "invalid",
        message: t("kept.invalid", { time: keptTime(edit.savedAt) }),
        details: checked.problems.map((problem) => `${problem.path}: ${problem.message}`).join("\n"),
      });
      return;
    }
    // Kept again as soon as the editor has them, in case they change nothing more.
    keptSaved.current = true;
    setStatus({ type: "idle" });
    void reopen(checked.data, false);
  };

  const throwKeptAway = () => {
    void editKeeper()
      .remove(keptKey)
      .catch(() => undefined);
    setStatus({ type: "idle" });
  };

  /** What an editor plugin has now, if it's something the site can publish, or why not. */
  const pluginData = useCallback(
    async (given: { handle: PluginEditorHandle; opened: Data }, fallback: Data) => {
      const edited = await given.handle.data().catch(() => fallback);
      return checkEditedData(edited, {
        description: site.description,
        kind: kind as PluginEditorKind,
        opened: given.opened,
      });
    },
    [site.description, kind],
  );

  const onPluginOpen = useCallback((handle: PluginEditorHandle, opened: Data) => {
    setPluginEditor({ handle, opened });
    published.current ??= serializeContent(storedData(opened));
    void offerKeptOnOpen.current(published.current);
    latest.current.data = opened;
    setState({
      data: opened,
      selected: null,
      past: false,
      future: false,
      leftSideBarVisible: false,
      rightSideBarVisible: false,
    });
  }, []);
  const onPluginChange = useCallback((change: PluginEditorChange) => {
    latest.current.data = change.data;
    setState({
      data: change.data,
      selected: findBlock(change.data, change.selected),
      past: change.past,
      future: change.future,
      leftSideBarVisible: false,
      rightSideBarVisible: false,
    });
  }, []);

  /**
   * Changes editor, keeping what's edited: from Puck, as it is when the choice is made, even if its frame hasn't
   * said so yet; from an editor plugin, only what the site can publish, and where some of it can't be, only once
   * the editor has agreed to leave those changes behind.
   */
  const chooseEditor = async (name: string | undefined) => {
    if (plugin && pluginEditor) {
      const checked = await pluginData(pluginEditor, latest.current.data);
      if (!checked.ok) {
        const problems = checked.problems.map((problem) => problemLine(t, problem)).join("\n");
        if (!window.confirm(t("editor.plugin.switchLoses", { editor: editorName, problems }))) return;
      }
      latest.current.data = checked.ok ? checked.data : pluginEditor.opened;
    } else if (!plugin && client) {
      latest.current.data = await client.call("editor.data").catch(() => latest.current.data);
    }
    setPluginEditor(undefined);
    editors.choose(name);
  };

  /** Publishes, or with `draft`, starts a draft with the change instead, where none is open (with one, every publish goes into it). */
  const onPublish = async (draft?: boolean) => {
    if (!state) return;
    let next: Data;
    if (plugin) {
      if (!pluginEditor) return;
      const checked = await pluginData(pluginEditor, state.data);
      if (!checked.ok) {
        setStatus({
          type: "invalid",
          message: t("editor.plugin.invalid", { editor: editorName }),
          details: checked.problems.map((problem) => problemLine(t, problem)).join("\n"),
        });
        return;
      }
      next = checked.data;
    } else {
      if (!client) return;
      // As it is when Publish is pressed, even if the frame hasn't said so yet.
      const edited = await client.call("editor.data").catch(() => state.data);
      // The frame runs the site's blocks' code, so what it hands back is checked as data before it's published.
      const checked = checkPuckData(edited, { description: site.description, kind });
      if (!checked.ok) {
        setStatus({
          type: "invalid",
          message: t("editor.invalid"),
          details: checked.problems.map((problem) => `${problem.path}: ${problem.message}`).join("\n"),
        });
        return;
      }
      next = checked.data;
    }
    const problem = validate?.(next);
    if (problem) {
      setStatus({ type: "invalid", message: problem });
      return;
    }
    setStatus({ type: "publishing" });
    const { changes, message } = toChanges(next);
    // Where the changes were kept: adding to a draft opens the screen again for it.
    const keptAt = keptKey;
    const result = await publish(changes, message, { draft });
    if (result.ok) {
      published.current = serializeContent(storedData(next));
      keptSaved.current = false;
      void editKeeper()
        .remove(keptAt)
        .catch(() => undefined);
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
      if (plugin) {
        const set = pluginEditor?.handle.set;
        if (!set) throw new Error("The editor isn't ready.");
        const next = applyEditorChange(latest.current.data, change);
        await set(next);
        onPluginChange({ data: next, past: true, future: false, selected: null });
        return;
      }
      if (!client) throw new Error("The editor isn't ready.");
      await client.call("editor.apply", change);
    },
    [client, plugin, pluginEditor, onPluginChange],
  );
  // Editor plugins give the AI assistant the blocks' fields from the site's description, and take its changes if they can.
  const aiConfig = useMemo(
    () =>
      plugin
        ? describedConfig(
            site.description,
            kind === "header" || kind === "footer" ? "layout" : kind === "template" ? "template" : "page",
          )
        : config,
    [plugin, site.description, kind, config],
  );
  const aiOffered = site.ai !== false && (!plugin || Boolean(pluginEditor?.handle.set));
  const undo = plugin ? pluginEditor?.handle.undo : () => void client?.call("editor.undo");
  const redo = plugin ? pluginEditor?.handle.redo : () => void client?.call("editor.redo");

  return (
    <div className={cx("gfa-editor", `gfa-editor-for-${kind}`)}>
      {notice && <div className="gfa-editor-notice">{notice}</div>}
      {readOnly && <div className="gfa-editor-notice">{t("limits.readOnly")}</div>}
      <div className="gfa-editor-header">
        <div className="gfa-editor-tools" hidden={Boolean(plugin)}>
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
        {editors.plugins.length > 0 && (
          <label className="gfa-inline-field gfa-editor-choice">
            {t("editor.choose")}
            <select
              className="gfa-input"
              value={plugin?.name ?? ""}
              onChange={(event) => void chooseEditor(event.target.value || undefined)}
            >
              <option value="">{t("editor.standard")}</option>
              {editors.plugins.map((option) => (
                <option key={option.name} value={option.name}>
                  {option.editor?.title ?? option.title}
                </option>
              ))}
            </select>
          </label>
        )}
        <fieldset
          className="gfa-editor-tools gfa-editor-viewports"
          aria-label={t("editor.viewport")}
          hidden={Boolean(plugin)}
        >
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
        <div className="gfa-editor-tools" hidden={!undo || !redo}>
          <Button variant="ghost" disabled={!state?.past} onClick={() => undo?.()}>
            {t("action.undo")}
          </Button>
          <Button variant="ghost" disabled={!state?.future} onClick={() => redo?.()}>
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
          {!drafts.current && !readOnly && (
            <Button
              title={t("draft.addHint")}
              disabled={!state || status.type === "publishing"}
              onClick={() => void onPublish(true)}
            >
              {t("draft.add")}
            </Button>
          )}
          {!readOnly && (
            <Button
              variant="primary"
              disabled={!state || status.type === "publishing"}
              onClick={() => void onPublish()}
            >
              {t("publish.button")}
            </Button>
          )}
          {status.type === "done" && <PublishedNotice onHide={hidePublished} />}
        </div>
      </div>
      {status.type !== "idle" && status.type !== "done" && (
        <div className="gfa-editor-status">
          {status.type === "publishing" && <p className="gfa-notice">{t("publish.publishing")}</p>}
          {status.type === "invalid" && (
            <ErrorMessage
              message={status.message}
              error={status.details}
              action={<Button onClick={() => setStatus({ type: "idle" })}>{t("action.close")}</Button>}
            />
          )}
          {status.type === "kept" && (
            <div className="gfa-notice" role="status">
              <p>{t("kept.found", { time: keptTime(status.edit.savedAt) })}</p>
              {status.theirs && <p>{t("kept.theirs")}</p>}
              <div className="gfa-dialog-actions">
                <Button onClick={() => putKeptBack(status.edit)}>{t("kept.putBack")}</Button>
                <Button variant="secondary" onClick={throwKeptAway}>
                  {t("kept.throwAway")}
                </Button>
              </div>
            </div>
          )}
          {status.type === "reloaded" && (
            <div className="gfa-notice" role="status">
              <p>{t("publish.reloaded")}</p>
              <div className="gfa-dialog-actions">
                {kept.current && (
                  <Button
                    onClick={() => {
                      const mine = kept.current;
                      kept.current = undefined;
                      setStatus({ type: "idle" });
                      if (mine) void reopen(mine, false);
                    }}
                  >
                    {t("publish.putMineBack")}
                  </Button>
                )}
                <Button variant="secondary" onClick={() => setStatus({ type: "idle" })}>
                  {t("action.close")}
                </Button>
              </div>
            </div>
          )}
          {status.type === "failed" && (
            <ErrorMessage
              message={t(status.reason === "conflict" ? "publish.conflict" : "publish.error")}
              error={status.error}
              action={
                status.reason === "conflict" ? (
                  <Button onClick={() => void reloadAfterConflict()}>{t("action.reload")}</Button>
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
            {state && aiConfig ? (
              <AiPanel
                context={{ kind, path, title, collection, language }}
                editor={{ data: state.data, selected: state.selected, config: aiConfig, apply }}
              />
            ) : (
              <p className="gfa-hint">{t("loading")}</p>
            )}
          </aside>
        )}
        <div className="gfa-editor-frame-wrap">
          {plugin && (kind === "page" || kind === "header" || kind === "footer" || kind === "template") ? (
            <PluginEditorFrame
              key={`${plugin.name} ${pluginOpening}`}
              plugin={plugin}
              target={{ kind, path, title, ...(language && { language }), ...(collection && { collection }) }}
              data={() => latest.current.data}
              onOpen={onPluginOpen}
              onChange={onPluginChange}
            />
          ) : failed ? (
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
