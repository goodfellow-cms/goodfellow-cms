import {
  allPages,
  isLanguageHome,
  type Page,
  type Schedule,
  scheduleOf,
  scheduleProblem,
  withSchedule,
} from "@goodfellow-cms/core";
import type { Data } from "@puckeditor/core";
import { type FormEvent, useState } from "react";
import { useAdmin, useCanChangeSettings, useSiteContent } from "./admin-context.js";
import {
  type AddressProblem,
  checkPageAddress,
  duplicatePageData,
  movePageChanges,
  newPageData,
  pageFileChange,
  pageTitle,
  slugify,
} from "./changes.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { navigate, pageEditorHref } from "./router.js";
import { ComingUp, ScheduleFields, ScheduleStatus, scheduleSettingsChanges } from "./schedule.js";
import { type StringKey, useStrings } from "./strings.js";
import { PageTranslations, unlinkTranslations } from "./translations.js";
import { Button, Dialog, TextField } from "./ui.js";

const addressErrors: Record<AddressProblem, StringKey> = {
  invalid: "address.invalid",
  reserved: "address.reserved",
  taken: "address.taken",
};

/**
 * Makes a page: an empty one, or, given `from`, a copy of that page's blocks
 * and settings, in the same folder. A copy is a page of its own: shown at
 * once, and not a translation, whatever the page it copies is.
 */
function NewPageDialog({ from, onClose }: { from?: Page; onClose: () => void }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const fromTitle = from ? pageTitle(from) : "";
  // A copy goes beside its page; a copy of a language's home page stays in that language.
  const folder =
    !from || from.path === "/"
      ? ""
      : isLanguageHome(content.settings, from.path)
        ? from.path
        : from.path.slice(0, from.path.lastIndexOf("/"));
  const addressFor = (value: string) => `${folder}/${slugify(value)}`;
  const initialTitle = from ? t("duplicatePage.pageTitle", { title: fromTitle }) : "";
  const [title, setTitle] = useState(initialTitle);
  const [address, setAddress] = useState(from ? addressFor(initialTitle) : "/");
  const [addressEdited, setAddressEdited] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  // Entries' pages count too: a new page can't take an entry's address.
  const check = checkPageAddress(address, allPages(content));
  const titleError = submitted && !title.trim() ? t("field.required") : undefined;
  const addressError = submitted && !check.ok ? t(addressErrors[check.problem]) : undefined;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!title.trim() || !check.ok) return;
    setBusy(true);
    const data = from ? duplicatePageData(from.content.data as Data, title.trim()) : newPageData(title.trim());
    const result = await publish(
      [pageFileChange(check.path, data, undefined)],
      from
        ? t("duplicatePage.message", { title: title.trim(), from: fromTitle })
        : t("newPage.message", { title: title.trim() }),
    );
    setBusy(false);
    if (result.ok) {
      onClose();
      navigate(pageEditorHref(check.path), () => true);
    } else {
      setFailure(result);
    }
  };

  return (
    <Dialog title={from ? t("duplicatePage.title", { title: fromTitle }) : t("newPage.title")} onClose={onClose}>
      <form onSubmit={onSubmit} className="gfa-form" noValidate>
        <TextField
          label={t("newPage.pageTitle")}
          value={title}
          error={titleError}
          autoFocus
          onChange={(value) => {
            setTitle(value);
            if (!addressEdited) setAddress(addressFor(value));
          }}
        />
        <TextField
          label={t("newPage.address")}
          hint={t("newPage.addressHint")}
          value={address}
          error={addressError}
          onChange={(value) => {
            setAddress(value);
            setAddressEdited(true);
          }}
        />
        <PublishFailure failure={failure} />
        <div className="gfa-dialog-actions">
          <Button onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("publish.publishing") : from ? t("duplicatePage.create") : t("newPage.create")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function MovePageDialog({ page, onClose }: { page: Page; onClose: () => void }) {
  const t = useStrings();
  const { blocks, publish } = useAdmin();
  const { content } = useSiteContent();
  const owner = useCanChangeSettings();
  const [address, setAddress] = useState(page.path);
  // The home page has no old address to send visitors on from: another page takes it.
  // Redirects are in Site Settings, which only owners change on sites with their own sign-in.
  const canRedirect = page.path !== "/" && owner;
  const [redirect, setRedirect] = useState(canRedirect);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const title = pageTitle(page);

  const check = checkPageAddress(address, allPages(content), page.path);
  const addressError = submitted && !check.ok ? t(addressErrors[check.problem]) : undefined;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!check.ok) return;
    if (check.path === page.path) return onClose();
    setBusy(true);
    const result = await publish(
      movePageChanges(content, page, check.path, { blocks, redirect }),
      t("movePage.message", { title, from: page.path, to: check.path }),
    );
    setBusy(false);
    if (result.ok) onClose();
    else setFailure(result);
  };

  return (
    <Dialog title={t("movePage.title", { title })} onClose={onClose}>
      <form onSubmit={onSubmit} className="gfa-form" noValidate>
        <TextField label={t("movePage.address")} value={address} error={addressError} autoFocus onChange={setAddress} />
        <p className="gfa-hint">{t("movePage.links")}</p>
        {canRedirect && (
          <label className="gfa-checkbox">
            <input type="checkbox" checked={redirect} onChange={(event) => setRedirect(event.target.checked)} />
            {t("movePage.redirect", { from: page.path })}
          </label>
        )}
        <p className="gfa-hint">{t(redirect ? "movePage.redirectHint" : "movePage.warning")}</p>
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

function SchedulePageDialog({ page, onClose }: { page: Page; onClose: () => void }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [schedule, setSchedule] = useState<Schedule>(scheduleOf(page.content));
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const title = pageTitle(page);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (scheduleProblem(schedule)) return;
    setBusy(true);
    const result = await publish(
      [
        pageFileChange(page.path, page.content.data as Data, withSchedule(page.content, schedule)),
        ...scheduleSettingsChanges(content, schedule),
      ],
      t("schedulePage.message", { title }),
    );
    setBusy(false);
    if (result.ok) onClose();
    else setFailure(result);
  };

  return (
    <Dialog title={t("schedulePage.title", { title })} onClose={onClose}>
      <form onSubmit={onSubmit} className="gfa-form" noValidate>
        <ScheduleFields value={schedule} onChange={setSchedule} content={content} showErrors={submitted} />
        <PublishFailure failure={failure} />
        <div className="gfa-dialog-actions">
          <Button onClick={onClose}>{t("action.cancel")}</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? t("publish.publishing") : t("schedulePage.submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function DeletePageDialog({ page, onClose }: { page: Page; onClose: () => void }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const title = pageTitle(page);

  const onDelete = async () => {
    setBusy(true);
    // Its translations stay, as pages of their own.
    const result = await publish(
      [{ path: page.file, delete: true }, ...unlinkTranslations(content, page)],
      t("deletePage.message", { title }),
    );
    setBusy(false);
    if (result.ok) onClose();
    else setFailure(result);
  };

  return (
    <Dialog title={t("deletePage.title", { title })} onClose={onClose}>
      <p>{t("deletePage.body", { path: page.path })}</p>
      <PublishFailure failure={failure} />
      <div className="gfa-dialog-actions">
        <Button onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="danger" disabled={busy} onClick={() => void onDelete()}>
          {busy ? t("publish.publishing") : t("deletePage.submit")}
        </Button>
      </div>
    </Dialog>
  );
}

type DialogState =
  | { type: "new" }
  | { type: "move"; page: Page }
  | { type: "duplicate"; page: Page }
  | { type: "schedule"; page: Page }
  | { type: "delete"; page: Page }
  | null;

export function PagesScreen() {
  const t = useStrings();
  const { siteUrl } = useAdmin();
  const { content } = useSiteContent();
  const [dialog, setDialog] = useState<DialogState>(null);
  const close = () => setDialog(null);

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("pages.title")}</h1>
        <Button variant="primary" onClick={() => setDialog({ type: "new" })}>
          {t("pages.new")}
        </Button>
      </div>

      <ComingUp content={content} />

      {content.pages.length === 0 ? (
        <p>{t("pages.empty")}</p>
      ) : (
        <table className="gfa-table">
          <thead>
            <tr>
              <th>{t("pages.column.title")}</th>
              <th>{t("pages.column.address")}</th>
              <th>
                <span className="gfa-visually-hidden">{t("pages.edit")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {content.pages.map((page) => (
              <tr key={page.path}>
                <td>
                  <a href={pageEditorHref(page.path)} className="gfa-link-strong">
                    {pageTitle(page)}
                  </a>
                  <ScheduleStatus schedule={page.content} content={content} />
                  <PageTranslations page={page} />
                </td>
                <td>
                  <code>{page.path}</code>
                </td>
                <td className="gfa-row-actions">
                  <a className="gfa-button gfa-button-secondary" href={pageEditorHref(page.path)}>
                    {t("pages.edit")}
                  </a>
                  <a
                    className="gfa-button gfa-button-ghost"
                    href={`${siteUrl.replace(/\/$/, "")}${page.path}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("pages.view")}
                  </a>
                  <Button
                    variant="ghost"
                    onClick={() => setDialog({ type: "move", page })}
                    disabled={page.path === "/"}
                  >
                    {t("pages.move")}
                  </Button>
                  <Button variant="ghost" onClick={() => setDialog({ type: "duplicate", page })}>
                    {t("pages.duplicate")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDialog({ type: "schedule", page })}
                    disabled={page.path === "/"}
                  >
                    {t("pages.schedule")}
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setDialog({ type: "delete", page })}
                    disabled={page.path === "/"}
                    title={page.path === "/" ? t("pages.homeCantDelete") : undefined}
                  >
                    {t("pages.delete")}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {dialog?.type === "new" && <NewPageDialog onClose={close} />}
      {dialog?.type === "duplicate" && <NewPageDialog from={dialog.page} onClose={close} />}
      {dialog?.type === "move" && <MovePageDialog page={dialog.page} onClose={close} />}
      {dialog?.type === "schedule" && <SchedulePageDialog page={dialog.page} onClose={close} />}
      {dialog?.type === "delete" && <DeletePageDialog page={dialog.page} onClose={close} />}
    </div>
  );
}
