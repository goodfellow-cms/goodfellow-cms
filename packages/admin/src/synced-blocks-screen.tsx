/**
 * Synced blocks: blocks kept once, in `content/synced-blocks/`, which pages,
 * collections' designs, the header and the footer place with the Synced block
 * block, so changing one changes every page in one publish. The Synced blocks
 * screen lists them, makes new ones, renames and deletes them; each opens in
 * an editor of its own, like the header's; and the page editors save a block
 * as one, or put a synced block's own blocks in place of its Synced block
 * (Detach).
 */
import {
  expandSyncedBlocks,
  findSyncedBlock,
  isAddressSegment,
  mainLanguage,
  pathLanguage,
  type SiteContent,
  SYNCED_BLOCK,
  SYNCED_BLOCK_PROP,
  type SyncedBlock,
  type SyncedBlockUse,
  siteLanguages,
  syncedBlockUses,
} from "@goodfellow-cms/core";
import type { ComponentData, Data } from "@puckeditor/core";
import { type FormEvent, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { deleteSyncedBlockChanges, pageTitle, slugify, syncedBlockFileChange, uniqueName } from "./changes.js";
import { findBlock } from "./editor-change.js";
import type { EditorChange, EditorState } from "./frame/protocol.js";
import { useMayChange } from "./limits.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { PuckEditor } from "./puck-editor.js";
import { navigate, syncedBlockEditorHref } from "./router.js";
import { type Translate, useStrings } from "./strings.js";
import { Button, Dialog, TextField } from "./ui.js";
import { AppLink } from "./use-link.js";
import { VersionsLink } from "./versions-screen.js";

const EMPTY: Data = { root: { props: {} }, content: [] };

/** Where a synced block is placed, in words. */
export function placeText(t: Translate, content: SiteContent, use: SyncedBlockUse): string {
  switch (use.kind) {
    case "page": {
      const page = content.pages.find((candidate) => candidate.path === use.path);
      return page ? pageTitle(page) : use.path;
    }
    case "template":
      return t("checks.place.design", { collection: use.name });
    case "header":
    case "footer": {
      const part = t(use.kind === "header" ? "layout.header" : "layout.footer");
      const language = use.language && siteLanguages(content.settings).find((found) => found.code === use.language);
      return language ? `${part} (${language.name})` : part;
    }
  }
}

/** A new synced block's name, from its title: one no other synced block has. */
export function newSyncedBlockName(title: string, content: Pick<SiteContent, "syncedBlocks">): string {
  return uniqueName(
    slugify(title),
    (content.syncedBlocks ?? []).map((block) => block.name),
    "synced-block",
  );
}

/** Asks for a synced block's title, for a new one, one saved from a block, or renaming one. */
function TitleDialog({
  title,
  initial = "",
  action,
  busy,
  failure,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: string;
  action: string;
  busy: boolean;
  failure: Failure;
  onSubmit: (title: string) => void;
  onClose: () => void;
}) {
  const t = useStrings();
  const [value, setValue] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const error = value.trim() ? undefined : t("field.required");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!error) onSubmit(value.trim());
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="gfa-form" noValidate>
        <TextField
          label={t("synced.title")}
          hint={t("synced.titleHint")}
          value={value}
          error={submitted ? error : undefined}
          autoFocus
          onChange={setValue}
        />
        <PublishFailure failure={failure} />
        <div className="gfa-dialog-actions">
          <Button onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("publish.publishing") : action}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteDialog({ block, onClose }: { block: SyncedBlock; onClose: () => void }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const uses = syncedBlockUses(content, block.name);
  const remove = async () => {
    setBusy(true);
    const result = await publish(
      deleteSyncedBlockChanges(block),
      t("synced.deleteMessage", { title: block.content.title }),
    );
    setBusy(false);
    if (result.ok) onClose();
    else setFailure(result);
  };
  return (
    <Dialog title={t("synced.deleteTitle", { title: block.content.title })} onClose={onClose}>
      {uses.length > 0 ? (
        <>
          <p>{t("synced.deleteUsed")}</p>
          <ul>
            {uses.map((use) => (
              <li key={use.file}>{placeText(t, content, use)}</li>
            ))}
          </ul>
          <div className="gfa-dialog-actions">
            <Button onClick={onClose}>{t("action.close")}</Button>
          </div>
        </>
      ) : (
        <>
          <p>{t("synced.deleteBody")}</p>
          <PublishFailure failure={failure} />
          <div className="gfa-dialog-actions">
            <Button onClick={onClose}>{t("action.cancel")}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              {busy ? t("publish.publishing") : t("synced.delete")}
            </Button>
          </div>
        </>
      )}
    </Dialog>
  );
}

export function SyncedBlocksScreen() {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const editable = useMayChange({ kind: "synced" });
  const [dialog, setDialog] = useState<
    { type: "new" } | { type: "rename"; block: SyncedBlock } | { type: "delete"; block: SyncedBlock }
  >();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const blocks = [...(content.syncedBlocks ?? [])].sort((a, b) => a.content.title.localeCompare(b.content.title));

  const close = () => {
    setDialog(undefined);
    setFailure(null);
  };
  const create = async (title: string) => {
    setBusy(true);
    const name = newSyncedBlockName(title, content);
    const result = await publish([syncedBlockFileChange(name, title, EMPTY)], t("synced.newMessage", { title }));
    setBusy(false);
    if (!result.ok) return setFailure(result);
    close();
    navigate(syncedBlockEditorHref(name), () => true);
  };
  // Renaming changes only the title: content places a synced block by its name, which never changes.
  const rename = async (block: SyncedBlock, title: string) => {
    setBusy(true);
    const result = await publish(
      [syncedBlockFileChange(block.name, title, block.content.data as Data)],
      t("synced.renameMessage", { title }),
    );
    setBusy(false);
    if (result.ok) close();
    else setFailure(result);
  };

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("synced.screenTitle")}</h1>
        {editable && (
          <Button variant="primary" onClick={() => setDialog({ type: "new" })}>
            {t("synced.new")}
          </Button>
        )}
      </div>
      <p className="gfa-hint">{t("synced.intro")}</p>
      {blocks.length === 0 ? (
        <p>{t("synced.empty")}</p>
      ) : (
        <table className="gfa-table">
          <thead>
            <tr>
              <th>{t("synced.column.title")}</th>
              <th>{t("synced.column.used")}</th>
              {editable && <th />}
            </tr>
          </thead>
          <tbody>
            {blocks.map((block) => {
              const uses = syncedBlockUses(content, block.name);
              return (
                <tr key={block.name}>
                  <td>
                    <AppLink href={syncedBlockEditorHref(block.name)} className="gfa-link-strong">
                      {block.content.title}
                    </AppLink>
                  </td>
                  <td>
                    {uses.length === 0 ? t("synced.unused") : uses.map((use) => placeText(t, content, use)).join(", ")}
                  </td>
                  {editable && (
                    <td className="gfa-table-actions">
                      <Button variant="ghost" onClick={() => setDialog({ type: "rename", block })}>
                        {t("synced.rename")}
                      </Button>
                      <Button variant="ghost" onClick={() => setDialog({ type: "delete", block })}>
                        {t("synced.delete")}
                      </Button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {dialog?.type === "new" && (
        <TitleDialog
          title={t("synced.newTitle")}
          action={t("synced.create")}
          busy={busy}
          failure={failure}
          onSubmit={(title) => void create(title)}
          onClose={close}
        />
      )}
      {dialog?.type === "rename" && (
        <TitleDialog
          title={t("synced.renameTitle")}
          initial={dialog.block.content.title}
          action={t("synced.rename")}
          busy={busy}
          failure={failure}
          onSubmit={(title) => void rename(dialog.block, title)}
          onClose={close}
        />
      )}
      {dialog?.type === "delete" && <DeleteDialog block={dialog.block} onClose={close} />}
    </div>
  );
}

/** A synced block in its own editor, in the main language or, on a site in several, in one of the others. */
export function SyncedBlockEditorScreen({ name, language }: { name: string; language?: string }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const block = isAddressSegment(name) ? findSyncedBlock(content, name) : undefined;
  if (!block) {
    return (
      <div className="gfa-screen">
        <p>{t("synced.notFound")}</p>
        <AppLink href="#/synced-blocks">{t("synced.back")}</AppLink>
      </div>
    );
  }
  const languages = siteLanguages(content.settings);
  const chosen = languages.find((candidate) => candidate.code === language && !candidate.main);
  const own = chosen ? block.languages?.[chosen.code] : undefined;
  const shown = own?.content ?? block.content;
  const file = own?.file ?? (chosen ? undefined : block.file);
  const uses = syncedBlockUses(content, block.name);

  /** Gives a language a version of its own, starting as a copy of the main language's, or takes it away. */
  const change = async (copy: boolean) => {
    if (!chosen) return;
    setBusy(true);
    const result = await publish(
      copy
        ? [syncedBlockFileChange(block.name, block.content.title, block.content.data as Data, chosen.code)]
        : own
          ? [{ path: own.file, delete: true }]
          : [],
      t(copy ? "synced.languageCopyMessage" : "synced.languageRemoveMessage", {
        title: block.content.title,
        language: chosen.name,
      }),
    );
    setBusy(false);
    if (!result.ok) setFailure(result);
  };

  return (
    <div className="gfa-layout-screen">
      <div className="gfa-layout-bar">
        <AppLink href="#/synced-blocks">{t("synced.back")}</AppLink>
        {languages.length > 1 && (
          <label className="gfa-inline-field">
            {t("menus.language")}
            <select
              className="gfa-input"
              value={chosen?.code ?? ""}
              onChange={(event) =>
                navigate(syncedBlockEditorHref(block.name, event.target.value || undefined), () =>
                  window.confirm(t("unsaved.confirm")),
                )
              }
            >
              {languages.map((candidate) => (
                <option key={candidate.code} value={candidate.main ? "" : candidate.code}>
                  {candidate.name}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {chosen && !own ? (
        <div className="gfa-screen">
          <p>{t("synced.languageShared", { language: chosen.name })}</p>
          <PublishFailure failure={failure} />
          <Button variant="primary" disabled={busy} onClick={() => void change(true)}>
            {busy ? t("publish.publishing") : t("synced.languageCopy", { language: chosen.name })}
          </Button>
        </div>
      ) : (
        <PuckEditor
          key={`${block.name}-${chosen?.code ?? ""}`}
          kind="synced"
          path={chosen ? chosen.prefix : "/"}
          title={chosen ? `${shown.title} (${chosen.name})` : shown.title}
          data={shown.data as Data}
          entry={block.name}
          {...(chosen && { language: chosen.code })}
          notice={
            <p className="gfa-hint gfa-editor-notice">
              {uses.length === 0
                ? t("synced.editorUnused")
                : t("synced.editorUsed", { places: uses.map((use) => placeText(t, content, use)).join(", ") })}
            </p>
          }
          actions={
            <>
              {chosen && (
                <Button variant="ghost" disabled={busy} onClick={() => void change(false)}>
                  {t("synced.languageRemove")}
                </Button>
              )}
              {file && <VersionsLink file={file} />}
            </>
          }
          toChanges={(data) => ({
            changes: [syncedBlockFileChange(block.name, shown.title, data, chosen?.code)],
            message: t("synced.message", { title: shown.title }),
          })}
        />
      )}
    </div>
  );
}

/**
 * The page editors' buttons for the block chosen on the canvas: **Save as
 * synced block**, which publishes it as a new synced block and puts a Synced
 * block in its place, and, for a Synced block, **Detach**, which puts the
 * synced block's own blocks in its place, to change on this page alone. Both
 * are changes in the editor, which Undo takes back and Publish publishes.
 */
export function SyncedBlockButtons({
  kind,
  path,
  language,
  state,
  apply,
}: {
  kind: "page" | "header" | "footer" | "template";
  path: string;
  language?: string;
  state: EditorState;
  apply: (change: EditorChange) => Promise<void>;
}) {
  const t = useStrings();
  const { site, publish } = useAdmin();
  const { content } = useSiteContent();
  const [saving, setSaving] = useState<ComponentData>();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const id = state.selected?.props?.id;
  const selected = typeof id === "string" ? findBlock(state.data, id) : null;
  if (!selected || !(SYNCED_BLOCK in site.description.blocks)) return null;
  const shownIn = language ?? (kind === "page" ? pathLanguage(content.settings, path) : mainLanguage(content.settings));

  if (selected.type === SYNCED_BLOCK) {
    const name = selected.props[SYNCED_BLOCK_PROP];
    if (typeof name !== "string" || !findSyncedBlock(content, name)) return null;
    const detach = () =>
      void apply({
        type: "detach",
        id: selected.props.id,
        blocks: expandSyncedBlocks([selected], content, shownIn) as ComponentData[],
      });
    return (
      <Button variant="ghost" title={t("synced.detachHint")} onClick={detach}>
        {t("synced.detach")}
      </Button>
    );
  }

  const save = async (title: string) => {
    if (!saving) return;
    setBusy(true);
    const name = newSyncedBlockName(title, content);
    const result = await publish(
      [syncedBlockFileChange(name, title, { root: { props: {} }, content: [saving] })],
      t("synced.newMessage", { title }),
    );
    setBusy(false);
    if (!result.ok) return setFailure(result);
    await apply({
      type: "replace",
      id: saving.props.id,
      block: { type: SYNCED_BLOCK, props: { id: saving.props.id, [SYNCED_BLOCK_PROP]: name } },
    });
    setSaving(undefined);
  };
  return (
    <>
      <Button variant="ghost" title={t("synced.saveHint")} onClick={() => setSaving(selected)}>
        {t("synced.save")}
      </Button>
      {saving && (
        <TitleDialog
          title={t("synced.saveTitle")}
          action={t("synced.saveAction")}
          busy={busy}
          failure={failure}
          onSubmit={(title) => void save(title)}
          onClose={() => {
            setSaving(undefined);
            setFailure(null);
          }}
        />
      )}
    </>
  );
}
