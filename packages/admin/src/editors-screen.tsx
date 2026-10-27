import { type EditorList, type EditorRole, EditorsError, type SiteEditor } from "@goodfellow-cms/core";
import { useCallback, useEffect, useState } from "react";
import { useAdmin, useCanChangeSettings } from "./admin-context.js";
import { OwnerTokenActive, OwnerTokenForm } from "./owner-token.js";
import { PermissionsSection } from "./permissions-section.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, Field, TextField } from "./ui.js";

type Role = Exclude<EditorRole, "viewer">;

const ROLE_LABELS: Record<EditorRole, StringKey> = {
  owner: "editors.role.owner",
  editor: "editors.role.editor",
  viewer: "editors.role.viewer",
};

/** Plain words for why a change to the editors didn't work. */
function problemText(error: unknown): StringKey {
  return error instanceof EditorsError ? `editors.error.${error.problem}` : "editors.error.other";
}

/** Who edits the site: inviting people, changing what they can do, and removing them. */
export function EditorsScreen() {
  const t = useStrings();
  const { editors, demo, limits } = useAdmin();
  // Limits are site settings: people who can't change those, or who have limits of their own, only see them at work.
  const owner = useCanChangeSettings() && !limits;

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.tab.editors")}</h1>
      </div>
      <div className="gfa-form">
        <p>{t("editors.intro")}</p>
        {demo ? <p>{t("editors.demo")}</p> : editors ? <EditorsPanel /> : <p>{t("editors.local")}</p>}
      </div>
      {owner && <PermissionsSection />}
    </div>
  );
}

function EditorsPanel() {
  const t = useStrings();
  const { editors, ownerAccess, account } = useAdmin();
  const host = account?.hostName ?? "";
  const [list, setList] = useState<EditorList>();
  const [error, setError] = useState<unknown>();
  const [problem, setProblem] = useState<unknown>();
  const [removing, setRemoving] = useState<SiteEditor>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!editors) return;
    try {
      setList(await editors.list());
      setError(undefined);
    } catch (caught) {
      setError(caught);
    }
  }, [editors]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Runs a change, then shows the list as it is now. Returns whether the change worked. */
  const change = async (run: () => Promise<void>): Promise<boolean> => {
    setBusy(true);
    setProblem(undefined);
    let ok = true;
    try {
      await run();
    } catch (caught) {
      setProblem(caught);
      ok = false;
    }
    await load();
    setBusy(false);
    return ok;
  };

  if (!editors) return null;
  if (error) return <ErrorMessage message={t("editors.error.load")} error={error} />;
  if (!list) return <p role="status">{t("editors.loading")}</p>;
  const manage = list.manage === "yes";

  return (
    <>
      <p className="gfa-hint">{t("editors.roles")}</p>
      <OwnerTokenActive onForget={() => void load()} />
      {list.manage === "token" && ownerAccess && !ownerAccess.active && <OwnerTokenForm onReady={() => void load()} />}
      {list.manage === "no" && <p className="gfa-hint">{t("editors.onlyOwners")}</p>}
      {!list.editorsCanPublish && (
        <div className="gfa-notice" role="status">
          <p>{t("editors.cantPublish", { host })}</p>
          {manage && editors.letEditorsPublish && (
            <Button
              disabled={busy}
              onClick={() => void change(() => editors.letEditorsPublish?.() ?? Promise.resolve())}
            >
              {t("editors.letPublish")}
            </Button>
          )}
        </div>
      )}
      {problem !== undefined && <ErrorMessage message={t(problemText(problem), { host })} error={problem} />}

      <table className="gfa-table gfa-editors">
        <thead>
          <tr>
            <th>{t("editors.person")}</th>
            <th>{t("editors.role")}</th>
            <th>
              <span className="gfa-visually-hidden">{t("editors.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {list.editors.map((editor) => {
            const name = editor.name ?? editor.login ?? editor.email ?? "";
            const changeable = manage && !editor.self && !editor.inherited;
            return (
              <tr key={editor.id}>
                <td>
                  <div className="gfa-editor-person">
                    <strong>{name}</strong>
                    <span className="gfa-hint">
                      {[
                        editor.login && editor.login !== name ? editor.login : undefined,
                        editor.self ? t("editors.you") : undefined,
                        editor.invited ? t("editors.invited") : undefined,
                        editor.inherited ? t("editors.inherited", { host }) : undefined,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>
                </td>
                <td>
                  {changeable && editor.role !== "viewer" ? (
                    <select
                      className="gfa-input"
                      aria-label={t("editors.roleFor", { name })}
                      value={editor.role}
                      disabled={busy}
                      onChange={(event) => void change(() => editors.setRole(editor, event.target.value as Role))}
                    >
                      <option value="editor">{t("editors.role.editor")}</option>
                      <option value="owner">{t("editors.role.owner")}</option>
                    </select>
                  ) : (
                    t(ROLE_LABELS[editor.role])
                  )}
                </td>
                <td>
                  {changeable && (
                    <Button variant="ghost" disabled={busy} onClick={() => setRemoving(editor)}>
                      {t(editor.invited ? "editors.withdraw" : "editors.remove")}
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {manage && <InviteForm busy={busy} onInvite={(who, role) => change(() => editors.invite(who, role))} />}

      {removing && (
        <Dialog
          title={t(removing.invited ? "editors.withdrawTitle" : "editors.removeTitle", {
            name: removing.name ?? removing.login ?? removing.email ?? "",
          })}
          onClose={() => setRemoving(undefined)}
        >
          <p>{t(removing.invited ? "editors.withdrawBody" : "editors.removeBody", { host })}</p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setRemoving(undefined)}>{t("action.cancel")}</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                const editor = removing;
                setRemoving(undefined);
                void change(() => editors.remove(editor));
              }}
            >
              {t(removing.invited ? "editors.withdraw" : "editors.remove")}
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

function InviteForm({ busy, onInvite }: { busy: boolean; onInvite: (who: string, role: Role) => Promise<boolean> }) {
  const t = useStrings();
  const { editors, account } = useAdmin();
  const host = account?.hostName ?? "";
  const [who, setWho] = useState("");
  const [role, setRole] = useState<Role>("editor");
  const byEmail = editors?.invitesByEmail === true;

  return (
    <form
      className="gfa-form"
      onSubmit={(event) => {
        event.preventDefault();
        void onInvite(who, role).then((ok) => ok && setWho(""));
      }}
    >
      <h2 className="gfa-section-title">{t("editors.invite.title")}</h2>
      <TextField
        label={t(byEmail ? "editors.invite.fieldEmail" : "editors.invite.field", { host })}
        hint={t(
          byEmail
            ? "editors.invite.hintEmail"
            : editors?.membersOnly
              ? "editors.invite.hintMembers"
              : "editors.invite.hint",
          { host },
        )}
        value={who}
        autoComplete="off"
        onChange={setWho}
      />
      <Field label={t("editors.role")}>
        {(props) => (
          <select
            {...props}
            className="gfa-input"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
          >
            <option value="editor">{t("editors.role.editor")}</option>
            <option value="owner">{t("editors.role.owner")}</option>
          </select>
        )}
      </Field>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !who.trim()}>
          {t("editors.invite.submit")}
        </Button>
      </div>
    </form>
  );
}
