import {
  type EditorLimits,
  mainLanguage,
  type Permissions,
  pathLanguage,
  permissionsFileChange,
} from "@goodfellow-cms/core";
import { useId, useMemo, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { useStrings } from "./strings.js";
import { Button, Dialog, TextField } from "./ui.js";

/** Limits a new person starts with: nothing, until the owner ticks what they may change. */
const NO_LIMITS: EditorLimits = { pages: [], collections: [] };

/** The page sections an owner can choose from: every page, then each page at the top of the main language's addresses. */
function pageSections(content: ReturnType<typeof useSiteContent>["content"]): string[] {
  const main = mainLanguage(content.settings);
  const sections = new Set<string>();
  for (const page of content.pages) {
    if (pathLanguage(content.settings, page.path) !== main) continue;
    const first = page.path.split("/")[1];
    if (first) sections.add(`/${first}`);
  }
  return ["/", ...[...sections].sort()];
}

function toggled(list: readonly string[] | undefined, value: string, on: boolean): string[] {
  const without = (list ?? []).filter((item) => item !== value);
  return on ? [...without, value] : without;
}

/**
 * What each limited person may change, and who reviews the rest, written to
 * `content/permissions.json`. Anyone it doesn't list may change everything.
 */
export function PermissionsSection() {
  const t = useStrings();
  const { publish, account } = useAdmin();
  const { content } = useSiteContent();
  const permissions: Permissions = content.permissions ?? { people: {} };
  const [editing, setEditing] = useState<{ login: string; limits: EditorLimits }>();
  const [login, setLogin] = useState("");
  const [busy, setBusy] = useState(false);
  const [reviewers, setReviewers] = useState((permissions.reviewers ?? []).join(", "));
  const people = Object.entries(permissions.people).sort(([a], [b]) => a.localeCompare(b));

  const save = async (next: Permissions, message: string) => {
    setBusy(true);
    const result = await publish([permissionsFileChange(next)], message, { checks: false });
    setBusy(false);
    return result.ok;
  };
  const remove = (person: string) => {
    const { [person]: _, ...rest } = permissions.people;
    void save({ ...permissions, people: rest }, t("permissions.removeMessage", { name: person }));
  };
  const named = reviewers
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean);

  return (
    <section className="gfa-form" aria-labelledby="gfa-permissions-title">
      <h2 id="gfa-permissions-title" className="gfa-section-title">
        {t("permissions.title")}
      </h2>
      <p className="gfa-hint">{t("permissions.intro")}</p>
      <p className="gfa-hint">
        {account?.role
          ? t("permissions.whereServer")
          : t("permissions.where", { host: account?.hostName || t("permissions.host") })}
      </p>
      {people.length > 0 && (
        <ul className="gfa-check-list">
          {people.map(([person, limits]) => (
            <li key={person}>
              <strong>{person}</strong> <span className="gfa-hint">{describeLimits(t, limits)}</span>{" "}
              <Button variant="ghost" disabled={busy} onClick={() => setEditing({ login: person, limits })}>
                {t("permissions.change")}
              </Button>
              <Button variant="ghost" disabled={busy} onClick={() => remove(person)}>
                {t("permissions.remove")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="gfa-form"
        onSubmit={(event) => {
          event.preventDefault();
          const name = login.trim();
          if (!name) return;
          setEditing({ login: name, limits: permissions.people[name] ?? NO_LIMITS });
        }}
      >
        <TextField
          label={t("permissions.person")}
          hint={t("permissions.personHint")}
          value={login}
          autoComplete="off"
          onChange={setLogin}
        />
        <div>
          <Button type="submit" disabled={busy || !login.trim()}>
            {t("permissions.add")}
          </Button>
        </div>
      </form>
      <form
        className="gfa-form"
        onSubmit={(event) => {
          event.preventDefault();
          const { reviewers: _, ...rest } = permissions;
          void save(named.length > 0 ? { ...rest, reviewers: named } : rest, t("permissions.reviewersMessage"));
        }}
      >
        <TextField
          label={t("permissions.reviewers")}
          hint={t("permissions.reviewersHint")}
          value={reviewers}
          autoComplete="off"
          onChange={setReviewers}
        />
        <div>
          <Button type="submit" disabled={busy || named.join(",") === (permissions.reviewers ?? []).join(",")}>
            {t("permissions.saveReviewers")}
          </Button>
        </div>
      </form>
      {editing && (
        <LimitsEditor
          login={editing.login}
          limits={editing.limits}
          busy={busy}
          onClose={() => setEditing(undefined)}
          onSave={async (limits) => {
            const ok = await save(
              { ...permissions, people: { ...permissions.people, [editing.login]: limits } },
              t("permissions.message", { name: editing.login }),
            );
            if (ok) {
              setEditing(undefined);
              setLogin("");
            }
          }}
        />
      )}
    </section>
  );
}

/** Someone's limits in a few words, for the list. */
function describeLimits(t: ReturnType<typeof useStrings>, limits: EditorLimits): string {
  const parts = [
    ...(limits.pages ?? []).map((section) => (section === "/" ? t("permissions.allPages") : section)),
    ...(limits.collections ?? []),
    ...(limits.media ? [t("limits.media")] : []),
    ...(limits.layout ? [t("limits.layout")] : []),
    ...(limits.menus ? [t("limits.menus")] : []),
  ];
  const text = parts.length > 0 ? parts.join(", ") : t("permissions.nothing");
  return limits.languages ? `${text} (${limits.languages.join(", ")})` : text;
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (on: boolean) => void }) {
  return (
    <label className="gfa-checkbox">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      {label}
    </label>
  );
}

function LimitsEditor({
  login,
  limits: initial,
  busy,
  onClose,
  onSave,
}: {
  login: string;
  limits: EditorLimits;
  busy: boolean;
  onClose: () => void;
  onSave: (limits: EditorLimits) => Promise<void>;
}) {
  const t = useStrings();
  const { content } = useSiteContent();
  const [limits, setLimits] = useState(initial);
  const id = useId();
  const sections = useMemo(() => {
    const found = pageSections(content);
    return [...found, ...(initial.pages ?? []).filter((section) => !found.includes(section))];
  }, [content, initial.pages]);
  const languages = [{ code: mainLanguage(content.settings), name: undefined }, ...(content.settings.languages ?? [])];
  const set = (change: Partial<EditorLimits>) => setLimits((current) => ({ ...current, ...change }));

  return (
    <Dialog title={t("permissions.editTitle", { name: login })} onClose={onClose}>
      <p>{t("permissions.editIntro")}</p>
      <fieldset className="gfa-fieldset" aria-describedby={`${id}-pages`}>
        <legend>{t("permissions.pages")}</legend>
        <p id={`${id}-pages`} className="gfa-hint">
          {t("permissions.pagesHint")}
        </p>
        {sections.map((section) => (
          <Check
            key={section}
            label={section === "/" ? t("permissions.allPages") : section}
            checked={(limits.pages ?? []).includes(section)}
            onChange={(on) => set({ pages: toggled(limits.pages, section, on) })}
          />
        ))}
      </fieldset>
      {content.collections.length > 0 && (
        <fieldset className="gfa-fieldset">
          <legend>{t("permissions.collections")}</legend>
          {content.collections.map((collection) => (
            <Check
              key={collection.id}
              label={collection.settings.name}
              checked={(limits.collections ?? []).includes(collection.id)}
              onChange={(on) => set({ collections: toggled(limits.collections, collection.id, on) })}
            />
          ))}
        </fieldset>
      )}
      <fieldset className="gfa-fieldset">
        <legend>{t("permissions.more")}</legend>
        <Check label={t("limits.media")} checked={limits.media === true} onChange={(on) => set({ media: on })} />
        <Check label={t("limits.layout")} checked={limits.layout === true} onChange={(on) => set({ layout: on })} />
        <Check label={t("limits.menus")} checked={limits.menus === true} onChange={(on) => set({ menus: on })} />
      </fieldset>
      {languages.length > 1 && (
        <fieldset className="gfa-fieldset">
          <legend>{t("permissions.languages")}</legend>
          <Check
            label={t("permissions.everyLanguage")}
            checked={!limits.languages}
            onChange={(on) => setLimits(({ languages: _, ...rest }) => (on ? rest : { ...rest, languages: [] }))}
          />
          {limits.languages !== undefined &&
            languages.map(({ code, name }) => (
              <Check
                key={code}
                label={name ? `${name} (${code})` : code}
                checked={limits.languages?.includes(code) === true}
                onChange={(on) => set({ languages: toggled(limits.languages, code, on) })}
              />
            ))}
        </fieldset>
      )}
      <div className="gfa-dialog-actions">
        <Button onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="primary" disabled={busy} onClick={() => void onSave(cleaned(limits))}>
          {t(busy ? "publish.publishing" : "permissions.save")}
        </Button>
      </div>
    </Dialog>
  );
}

/** Limits as the file keeps them: no `false`, and no empty lists but pages and collections. */
function cleaned(limits: EditorLimits): EditorLimits {
  return {
    pages: limits.pages ?? [],
    collections: limits.collections ?? [],
    ...(limits.media && { media: true }),
    ...(limits.layout && { layout: true }),
    ...(limits.menus && { menus: true }),
    ...(limits.languages && { languages: limits.languages }),
  };
}
