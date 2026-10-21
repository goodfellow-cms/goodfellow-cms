import { allPages, type Collection, type Entry, entryAddress, entryTitle } from "@goodfellow-cms/core";
import type { Data } from "@puckeditor/core";
import { type FormEvent, type ReactNode, useState } from "react";
import { useAdmin, useCanChangeSettings, useSiteContent } from "./admin-context.js";
import {
  checkEntrySlug,
  collectionFileChange,
  type EntryNameProblem,
  entryFileChange,
  moveEntryChanges,
  slugify,
  uniqueName,
} from "./changes.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { PuckEditor } from "./puck-editor.js";
import { type CollectionTab, collectionHref, entryEditorHref, navigate } from "./router.js";
import { ScheduleStatus } from "./schedule.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, TextField } from "./ui.js";
import { AppLink } from "./use-link.js";

const nameErrors: Record<EntryNameProblem, StringKey> = {
  invalid: "entryName.invalid",
  reserved: "entryName.reserved",
  taken: "entryName.taken",
};

/** A collection's item name for use mid-sentence: "Video" → "video", but "FAQ" stays "FAQ". */
export function inSentence(word: string): string {
  return word.length > 1 && word[1] === word[1]?.toLowerCase() ? word.charAt(0).toLowerCase() + word.slice(1) : word;
}

/** The tabs shared by a collection's screens, above the screen itself. */
export function CollectionLayout({
  collection,
  tab,
  children,
}: {
  collection: Collection;
  tab: CollectionTab;
  children: ReactNode;
}) {
  const t = useStrings();
  const owner = useCanChangeSettings();
  const tabs: Array<[CollectionTab, StringKey]> = [
    ["entries", "collection.tab.entries"],
    ...(owner && collection.settings.path
      ? [["template", "collection.tab.template"] as [CollectionTab, StringKey]]
      : []),
    ...(owner ? [["settings", "collection.tab.settings"] as [CollectionTab, StringKey]] : []),
  ];
  return (
    <div className="gfa-layout-screen">
      <nav className="gfa-tabs" aria-label={collection.settings.name}>
        <AppLink href="#/collections" className="gfa-tab">
          ← {t("collection.back")}
        </AppLink>
        <span className="gfa-tabs-title">{collection.settings.name}</span>
        {tabs.map(([name, label]) => (
          <AppLink
            key={name}
            href={collectionHref(collection.id, name)}
            className="gfa-tab"
            aria-current={name === tab ? "page" : undefined}
          >
            {t(label)}
          </AppLink>
        ))}
      </nav>
      <div className="gfa-layout-body">{children}</div>
    </div>
  );
}

function NewEntryDialog({ collection, onClose }: { collection: Collection; onClose: () => void }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugEdited, setSlugEdited] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const { settings } = collection;
  const entry = inSentence(settings.entryName);

  // Entries without pages get a file name from their title, since nobody sees it.
  const name = settings.path
    ? slug
    : uniqueName(
        slugify(title),
        collection.entries.map((existing) => existing.slug),
        slugify(settings.entryName),
      );
  const check = checkEntrySlug(
    name,
    collection,
    allPages(content).map((page) => page.path),
  );
  const titleError = submitted && !title.trim() ? t("field.required") : undefined;
  const slugError = submitted && !check.ok ? t(nameErrors[check.problem]) : undefined;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!title.trim() || !check.ok) return;
    setBusy(true);
    const result = await publish(
      [entryFileChange(collection, check.slug, { title: title.trim() }, undefined)],
      t("newEntry.message", { entry, title: title.trim() }),
    );
    setBusy(false);
    if (result.ok) {
      onClose();
      navigate(entryEditorHref(collection.id, check.slug), () => true);
    } else {
      setFailure(result);
    }
  };

  return (
    <Dialog title={t("newEntry.title", { entry })} onClose={onClose}>
      <form onSubmit={onSubmit} className="gfa-form" noValidate>
        <TextField
          label={t("newEntry.entryTitle")}
          value={title}
          error={titleError}
          autoFocus
          onChange={(value) => {
            setTitle(value);
            if (!slugEdited) setSlug(slugify(value));
          }}
        />
        {settings.path && (
          <TextField
            label={t("newEntry.address")}
            hint={t("newEntry.addressHint", { example: entryAddress(settings.path, slug || "easter-vigil") })}
            value={slug}
            error={slugError}
            onChange={(value) => {
              setSlug(value);
              setSlugEdited(true);
            }}
          />
        )}
        {!settings.path && slugError && <p className="gfa-error-text">{slugError}</p>}
        <PublishFailure failure={failure} />
        <div className="gfa-dialog-actions">
          <Button onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("publish.publishing") : t("newEntry.title", { entry })}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MoveEntryDialog({
  collection,
  entry,
  onClose,
}: {
  collection: Collection;
  entry: Entry;
  onClose: () => void;
}) {
  const t = useStrings();
  const { config, publish } = useAdmin();
  const { content } = useSiteContent();
  const [slug, setSlug] = useState(entry.slug);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const title = entryTitle(entry);
  const pattern = collection.settings.path ?? "/{slug}";

  const check = checkEntrySlug(
    slug,
    collection,
    allPages(content).map((page) => page.path),
    entry,
  );
  const slugError = submitted && !check.ok ? t(nameErrors[check.problem]) : undefined;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!check.ok) return;
    if (check.slug === entry.slug) return onClose();
    setBusy(true);
    const result = await publish(
      moveEntryChanges(content, collection, entry, check.slug, check.path, config.blocks),
      t("moveEntry.message", {
        entry: inSentence(collection.settings.entryName),
        title,
        from: entry.path ?? entry.slug,
        to: check.path ?? check.slug,
      }),
    );
    setBusy(false);
    if (result.ok) onClose();
    else setFailure(result);
  };

  return (
    <Dialog title={t("movePage.title", { title })} onClose={onClose}>
      <form onSubmit={onSubmit} className="gfa-form" noValidate>
        <TextField
          label={t("movePage.address")}
          hint={t("newEntry.addressHint", { example: entryAddress(pattern, slug || entry.slug) })}
          value={slug}
          error={slugError}
          autoFocus
          onChange={setSlug}
        />
        <p className="gfa-hint">{t("movePage.links")}</p>
        <p className="gfa-hint">{t("movePage.warning")}</p>
        <PublishFailure failure={failure} />
        <div className="gfa-dialog-actions">
          <Button onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("publish.publishing") : t("movePage.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeleteEntryDialog({
  collection,
  entry,
  onClose,
}: {
  collection: Collection;
  entry: Entry;
  onClose: () => void;
}) {
  const t = useStrings();
  const { publish } = useAdmin();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const title = entryTitle(entry);
  const name = collection.settings.name;

  const onDelete = async () => {
    setBusy(true);
    const result = await publish(
      [{ path: entry.file, delete: true }],
      t("deleteEntry.message", { entry: inSentence(collection.settings.entryName), title }),
    );
    setBusy(false);
    if (result.ok) onClose();
    else setFailure(result);
  };

  return (
    <Dialog title={t("deletePage.title", { title })} onClose={onClose}>
      <p>
        {entry.path
          ? t("deleteEntry.bodyPage", { title, name, path: entry.path })
          : t("deleteEntry.body", { title, name })}
      </p>
      <PublishFailure failure={failure} />
      <div className="gfa-dialog-actions">
        <Button onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="danger" disabled={busy} onClick={() => void onDelete()}>
          {busy ? t("publish.publishing") : t("pages.delete")}
        </Button>
      </div>
    </Dialog>
  );
}

type DialogState = { type: "new" } | { type: "move"; entry: Entry } | { type: "delete"; entry: Entry } | null;

/** A collection's items, with buttons to add, edit, rename and delete them. */
export function EntriesScreen({ collection }: { collection: Collection }) {
  const { content } = useSiteContent();
  const t = useStrings();
  const { siteUrl } = useAdmin();
  const [dialog, setDialog] = useState<DialogState>(null);
  const close = () => setDialog(null);
  const { settings } = collection;
  const entry = inSentence(settings.entryName);

  return (
    <CollectionLayout collection={collection} tab="entries">
      <div className="gfa-screen">
        <div className="gfa-screen-header">
          <h1>{settings.name}</h1>
          <Button variant="primary" onClick={() => setDialog({ type: "new" })}>
            {t("entries.add", { entry })}
          </Button>
        </div>

        {collection.entries.length === 0 ? (
          <p>{t("entries.empty", { name: settings.name })}</p>
        ) : (
          <table className="gfa-table">
            <thead>
              <tr>
                <th>{t("entries.column.title")}</th>
                {settings.path && <th>{t("entries.column.address")}</th>}
                <th>
                  <span className="gfa-visually-hidden">{t("pages.edit")}</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {collection.entries.map((item) => (
                <tr key={item.slug}>
                  <td>
                    <a href={entryEditorHref(collection.id, item.slug)} className="gfa-link-strong">
                      {entryTitle(item)}
                    </a>
                    <ScheduleStatus schedule={item.content} content={content} />
                  </td>
                  {settings.path && (
                    <td>
                      <code>{item.path}</code>
                    </td>
                  )}
                  <td className="gfa-row-actions">
                    <a className="gfa-button gfa-button-secondary" href={entryEditorHref(collection.id, item.slug)}>
                      {t("pages.edit")}
                    </a>
                    {item.path && (
                      <>
                        <a
                          className="gfa-button gfa-button-ghost"
                          href={`${siteUrl.replace(/\/$/, "")}${item.path}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {t("pages.view")}
                        </a>
                        <Button variant="ghost" onClick={() => setDialog({ type: "move", entry: item })}>
                          {t("pages.move")}
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" onClick={() => setDialog({ type: "delete", entry: item })}>
                      {t("pages.delete")}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {dialog?.type === "new" && <NewEntryDialog collection={collection} onClose={close} />}
        {dialog?.type === "move" && <MoveEntryDialog collection={collection} entry={dialog.entry} onClose={close} />}
        {dialog?.type === "delete" && (
          <DeleteEntryDialog collection={collection} entry={dialog.entry} onClose={close} />
        )}
      </div>
    </CollectionLayout>
  );
}

/** Lists the placeholders a template can use. */
function TemplateHelp({ collection }: { collection: Collection }) {
  const t = useStrings();
  return (
    <div className="gfa-template-help">
      <p>{t("template.help")}</p>
      <ul>
        {collection.settings.fields.map((field) => (
          <li key={field.name} className="gfa-template-help-item">
            <code>{`{${field.name}}`}</code> {field.label}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The design every entry's page shares, edited in Puck. */
export function TemplateScreen({ collection }: { collection: Collection }) {
  const t = useStrings();
  const { settings } = collection;

  if (!settings.path) {
    return (
      <CollectionLayout collection={collection} tab="template">
        <div className="gfa-screen">
          <p>{t("template.noPages", { name: settings.name })}</p>
        </div>
      </CollectionLayout>
    );
  }

  return (
    <CollectionLayout collection={collection} tab="template">
      <PuckEditor
        key={collection.id}
        kind="template"
        path={collection.entries[0]?.path ?? "/"}
        title={`${settings.name}: ${t("collection.tab.template")}`}
        data={settings.template as Data}
        collection={collection}
        notice={<TemplateHelp collection={collection} />}
        toChanges={(data) => ({
          changes: [collectionFileChange(collection.id, { ...settings, template: data as typeof settings.template })],
          message: t("template.message", { name: settings.name }),
        })}
      />
    </CollectionLayout>
  );
}
