/**
 * Editing a language's admin text by hand, one string at a time: each with
 * its English, what the admin panel shows now, a box to change it and a mark
 * for someone who speaks the language having read it. For a language the site
 * translated itself, an empty box goes back to English; for Goodfellow's own
 * languages, it goes back to Goodfellow's words, so the file holds only what
 * the owner changed. Everything is published together, in one publish.
 */
import type { AdminTextSource } from "@goodfellow-cms/ai";
import { type AdminTextFile, adminTextFileChange, adminTextProblem } from "@goodfellow-cms/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "./admin-context.js";
import {
  type AdminTextEdit,
  entryOf,
  filterSources,
  type SourceFilter,
  sourceState,
  withEdits,
} from "./admin-text-sources.js";
import { useUnsavedChanges } from "./router.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, ErrorMessage, PublishedNotice } from "./ui.js";
import { AppLink } from "./use-link.js";

/** How many strings show at first, and how many more each Show more adds. */
const PAGE = 50;

const FILTERS: SourceFilter[] = ["all", "missing", "outdated", "unusable", "unreviewed"];

const TABLE_NAMES: Record<NonNullable<AdminTextSource["table"]>, StringKey> = {
  strings: "adminText.table.strings",
  puck: "adminText.table.puck",
  labels: "adminText.table.labels",
};

type Status = { type: "idle" | "publishing" | "done" } | { type: "failed"; reason: string; error: unknown };

export function AdminTextEditor({
  code,
  name,
  file,
  sources,
  defaults,
  builtIn,
}: {
  code: string;
  name: string;
  file: AdminTextFile | undefined;
  sources: readonly AdminTextSource[];
  /** What each string shows without the file's text, by `sourceKey()`: Goodfellow's words in the language, else English. */
  defaults: ReadonlyMap<string, string>;
  /** Whether Goodfellow ships the language, so the file only changes some of its words. */
  builtIn: boolean;
}) {
  const t = useStrings();
  const { publish } = useAdmin();
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<SourceFilter>("all");
  const [shown, setShown] = useState(PAGE);
  const [edits, setEdits] = useState<Map<string, AdminTextEdit>>(new Map());
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const dirty = edits.size > 0;
  useUnsavedChanges(dirty);
  const hidePublished = useCallback(() => setStatus((now) => (now.type === "done" ? { type: "idle" } : now)), []);
  useEffect(() => {
    if (dirty) hidePublished();
  }, [dirty, hidePublished]);

  const found = useMemo(() => filterSources(file, sources, { query, show }), [file, sources, query, show]);
  const fallback = builtIn ? t("adminText.editor.fallbackOwn") : t("adminText.editor.fallbackEnglish");
  const english = useMemo(() => new Map(sources.map((source) => [source.key, source.english])), [sources]);
  const problems = [...edits].filter(
    ([key, edit]) => edit.text.trim() && adminTextProblem(edit.text, english.get(key)),
  );

  const edit = (key: string, change: Partial<AdminTextEdit>) => {
    setEdits((before) => {
      const entry = entryOf(file, key);
      const current = before.get(key) ?? { text: entry?.text ?? "", reviewed: entry?.reviewed === true };
      const next = { ...current, ...change };
      const map = new Map(before);
      // Back to what the file has: nothing to publish for it.
      if (next.text === (entry?.text ?? "") && next.reviewed === (entry?.reviewed === true)) map.delete(key);
      else map.set(key, next);
      return map;
    });
  };

  const onPublish = async () => {
    setStatus({ type: "publishing" });
    const result = await publish(
      [adminTextFileChange(code, withEdits(file, name, edits, sources))],
      t("adminText.editor.message", { language: name }),
      { checks: false },
    );
    if (result.ok) {
      setEdits(new Map());
      setStatus({ type: "done" });
    } else setStatus({ type: "failed", reason: result.reason, error: result.error });
  };

  return (
    <div className="gfa-screen">
      <p>
        <AppLink href="#/settings/admin-languages">{t("adminText.editor.back")}</AppLink>
      </p>
      <div className="gfa-screen-header">
        <h1>{t("adminText.editor.title", { language: name })}</h1>
        <div className="gfa-header-actions">
          <Button
            variant="primary"
            disabled={!dirty || problems.length > 0 || status.type === "publishing"}
            onClick={() => void onPublish()}
          >
            {status.type === "publishing" ? t("publish.publishing") : t("publish.button")}
          </Button>
          {status.type === "done" && <PublishedNotice onHide={hidePublished} />}
        </div>
      </div>
      <p className="gfa-hint">{t(builtIn ? "adminText.editor.introOwn" : "adminText.editor.intro", { fallback })}</p>
      {problems.length > 0 && (
        <ErrorMessage message={t("adminText.editor.problems", { count: String(problems.length) })} />
      )}
      {status.type === "failed" && status.reason !== "checks" && (
        <ErrorMessage
          message={t(status.reason === "conflict" ? "publish.conflict" : "publish.error")}
          error={status.error}
        />
      )}

      <div className="gfa-row-actions">
        <label className="gfa-field">
          <span className="gfa-label">{t("adminText.editor.search")}</span>
          <input
            type="search"
            className="gfa-input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setShown(PAGE);
            }}
          />
        </label>
        <label className="gfa-field">
          <span className="gfa-label">{t("adminText.editor.show")}</span>
          <select
            className="gfa-input"
            value={show}
            onChange={(event) => {
              setShow(event.target.value as SourceFilter);
              setShown(PAGE);
            }}
          >
            {FILTERS.map((filter) => (
              <option key={filter} value={filter}>
                {t(`adminText.editor.show.${filter}` as StringKey)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="gfa-hint" role="status">
        {t("adminText.editor.count", { shown: String(Math.min(shown, found.length)), total: String(found.length) })}
      </p>

      {found.length === 0 ? (
        <p>{t("adminText.editor.none")}</p>
      ) : (
        <table className="gfa-table">
          <thead>
            <tr>
              <th>{t("adminText.editor.english")}</th>
              <th>{t("adminText.editor.shown", { language: name })}</th>
            </tr>
          </thead>
          <tbody>
            {found.slice(0, shown).map((source) => {
              const entry = entryOf(file, source.key);
              const value = edits.get(source.key) ?? { text: entry?.text ?? "", reviewed: entry?.reviewed === true };
              const state = sourceState(file, source);
              const problem = value.text.trim() ? adminTextProblem(value.text, source.english) : undefined;
              const label = `${source.english} (${source.key})`;
              return (
                <tr key={source.key}>
                  <td>
                    <div lang="en">{source.english}</div>
                    <div className="gfa-hint">
                      {source.table && t(TABLE_NAMES[source.table])} ·{" "}
                      <code>{source.key.slice(source.key.indexOf(":") + 1)}</code>
                    </div>
                  </td>
                  <td>
                    <textarea
                      className="gfa-input"
                      lang={code}
                      rows={Math.min(6, Math.ceil(Math.max(source.english.length, value.text.length) / 60) || 1)}
                      aria-label={label}
                      placeholder={defaults.get(source.key) ?? source.english}
                      value={value.text}
                      onChange={(event) => edit(source.key, { text: event.target.value })}
                    />
                    {problem && (
                      <p className="gfa-error" role="alert">
                        {t(`adminText.problem.${problem}` as StringKey)}
                      </p>
                    )}
                    {!edits.has(source.key) && state !== "current" && state !== "missing" && (
                      <p className="gfa-hint">{t(`adminText.editor.state.${state}` as StringKey, { fallback })}</p>
                    )}
                    {value.text.trim() !== "" && (
                      <label className="gfa-checkbox">
                        <input
                          type="checkbox"
                          checked={value.reviewed}
                          onChange={(event) => edit(source.key, { reviewed: event.target.checked })}
                        />{" "}
                        {t("adminText.editor.reviewed")}
                      </label>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {found.length > shown && (
        <Button onClick={() => setShown((now) => now + PAGE)}>{t("adminText.editor.more")}</Button>
      )}
    </div>
  );
}
