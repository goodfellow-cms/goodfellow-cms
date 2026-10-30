/**
 * Site Settings' Admin panel languages screen: the languages the site has the
 * admin panel's text in (`content/admin-text/<code>.json`), how much of it
 * each says, and translating what's missing or out of date with the AI
 * service the editor chose (`translateAdminText()` in `@goodfellow-cms/ai`,
 * a batch at a time with its glossary), publishing what came back in one
 * publish, even when the service stopped part way, so it's never asked for
 * twice. Every string is checked again as it's used (`composeAdminText()`).
 */
import { translateAdminText } from "@goodfellow-cms/ai";
import {
  type AdminTextFile,
  adminTextFile,
  adminTextFileChange,
  isLanguageCode,
  readAdminText,
} from "@goodfellow-cms/core";
import { useEffect, useRef, useState } from "react";
import { useAdmin } from "./admin-context.js";
import { ADMIN_LANGUAGES } from "./admin-language.js";
import {
  adminTextSources,
  type LanguageStatus,
  labelSources,
  languageStatus,
  sourcesToTranslate,
  withTranslations,
} from "./admin-text-sources.js";
import { problemKey, ServiceSettings, useAiService } from "./ai-panel.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, TextField } from "./ui.js";

type Status =
  | { type: "idle" }
  | { type: "working"; code: string; done: number; total: number }
  | { type: "done"; count: number; left: number; error?: unknown };

/** Every English string the admin panel shows here, labels of the built-in blocks' groups included. */
async function siteSources(description: Parameters<typeof labelSources>[0]) {
  // The Spanish labels' keys are the built-in blocks' English labels and groups, which the description lacks.
  const { labels } = await import("./languages/es-labels.js");
  return adminTextSources(labelSources(description, Object.keys(labels)));
}

export function AdminLanguagesScreen() {
  const t = useStrings();
  const { site, state, readFile, listFiles, publish } = useAdmin();
  const ai = useAiService();
  const revision = state.status === "ready" ? state.revision : undefined;
  const [files, setFiles] = useState<Record<string, AdminTextFile>>();
  const [sources, setSources] = useState<Awaited<ReturnType<typeof siteSources>>>();
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const [failure, setFailure] = useState<Failure>(null);
  const [instruction, setInstruction] = useState("");
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [addError, setAddError] = useState<string>();
  const [removing, setRemoving] = useState<{ code: string; name: string }>();
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!revision) return;
    let live = true;
    readAdminText({ read: readFile, list: listFiles }).then(
      (read) => live && setFiles(read.files),
      () => live && setFiles({}),
    );
    return () => {
      live = false;
    };
  }, [revision, readFile, listFiles]);
  useEffect(() => {
    let live = true;
    void siteSources(site.description).then((found) => live && setSources(found));
    return () => {
      live = false;
    };
  }, [site.description]);
  useEffect(() => () => controller.current?.abort(), []);

  const working = status.type === "working";
  const canAsk = ai.ready && ai.settings.provider !== "manual";

  const translate = async (language: { code: string; name: string }, options: { outdated?: boolean } = {}) => {
    if (!sources || !files) return;
    const file = files[language.code];
    const todo = sourcesToTranslate(file, sources, options);
    setFailure(null);
    if (todo.length === 0) {
      setStatus({ type: "done", count: 0, left: 0 });
      return;
    }
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setStatus({ type: "working", code: language.code, done: 0, total: todo.length });
    const result = await translateAdminText(
      ai.settings,
      { language, strings: todo, ...(instruction.trim() && { instruction }) },
      {
        ...ai.runOptions,
        signal: current.signal,
        onBatch: ({ done, total }) => setStatus({ type: "working", code: language.code, done, total }),
      },
    );
    const stopped = current.signal.aborted;
    // What came back is published, even part way, so it's never asked for again.
    if (result.translated.size > 0) {
      const next = withTranslations(file, language.name, result.translated, sources);
      const published = await publish(
        [adminTextFileChange(language.code, next)],
        t("adminText.message", { language: language.name }),
        { checks: false },
      );
      if (!published.ok) {
        setFailure(published);
        setStatus({ type: "idle" });
        return;
      }
    }
    setStatus({
      type: "done",
      count: result.translated.size,
      left: result.left.length,
      ...(result.error !== undefined && !stopped && { error: result.error }),
    });
  };

  const add = () => {
    const trimmed = code.trim();
    if (!isLanguageCode(trimmed)) return setAddError(t("adminText.add.badCode"));
    if (!name.trim()) return setAddError(t("adminText.add.noName"));
    if (ADMIN_LANGUAGES.some((language) => language.code === trimmed) || files?.[trimmed]) {
      return setAddError(t("adminText.add.exists"));
    }
    setAddError(undefined);
    setCode("");
    setName("");
    void translate({ code: trimmed, name: name.trim() });
  };

  const remove = async (language: { code: string; name: string }) => {
    setFailure(null);
    const result = await publish(
      [{ path: adminTextFile(language.code), delete: true }],
      t("adminText.removeMessage", { language: language.name }),
      { checks: false },
    );
    if (result.ok) setRemoving(undefined);
    else setFailure(result);
  };

  const languages = Object.entries(files ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.tab.adminLanguages")}</h1>
      </div>
      <p>{t("adminText.intro")}</p>
      <p className="gfa-hint">{t("adminText.machine")}</p>

      {!files || !sources ? (
        <p>{t("loading")}</p>
      ) : languages.length === 0 ? (
        <p>{t("adminText.empty")}</p>
      ) : (
        <table className="gfa-table">
          <thead>
            <tr>
              <th>{t("adminText.column.language")}</th>
              <th>{t("adminText.column.translated")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {languages.map(([languageCode, file]) => (
              <LanguageRow
                key={languageCode}
                code={languageCode}
                name={file.name}
                status={languageStatus(file, sources)}
                disabled={working || !canAsk}
                onTranslate={(outdated) => void translate({ code: languageCode, name: file.name }, { outdated })}
                onRemove={() => setRemoving({ code: languageCode, name: file.name })}
              />
            ))}
          </tbody>
        </table>
      )}

      {status.type === "working" && (
        <div role="status" className="gfa-notice">
          <p>{t("adminText.translating", { done: String(status.done), total: String(status.total) })}</p>
          <progress max={status.total} value={status.done} />
          <div>
            <Button onClick={() => controller.current?.abort()}>{t("adminText.stop")}</Button>
          </div>
        </div>
      )}
      {status.type === "done" &&
        (status.error !== undefined ? (
          <ErrorMessage message={`${t("adminText.failed")} ${t(problemKey(status.error))}`} error={status.error} />
        ) : (
          <div role="status" className="gfa-notice">
            <p>
              {status.count === 0 && status.left === 0
                ? t("adminText.nothing")
                : t("adminText.done", { count: String(status.count) })}
            </p>
            {status.left > 0 && <p>{t("adminText.left", { count: String(status.left) })}</p>}
          </div>
        ))}
      <PublishFailure failure={failure} />

      <section>
        <h2 className="gfa-section-title">{t("adminText.add.title")}</h2>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <TextField
            label={t("adminText.add.code")}
            hint={t("adminText.add.codeHint")}
            value={code}
            onChange={setCode}
            autoComplete="off"
            spellCheck={false}
          />
          <TextField
            label={t("adminText.add.name")}
            hint={t("adminText.add.nameHint")}
            value={name}
            onChange={setName}
          />
          {addError && <ErrorMessage message={addError} />}
          <Button type="submit" variant="primary" disabled={working || !canAsk || !sources}>
            {t("adminText.add.submit")}
          </Button>
        </form>
      </section>

      <section>
        <h2 className="gfa-section-title">{t("adminText.service")}</h2>
        {!ai.ready && <p>{t("adminText.noService")}</p>}
        {ai.settings.provider === "manual" && <p>{t("adminText.manual")}</p>}
        <ServiceSettings
          providers={ai.providers}
          settings={ai.chosen}
          onChange={ai.updateSettings}
          {...(ai.siteAi && { siteAi: ai.siteAi })}
        />
        <TextField
          label={t("adminText.instruction")}
          hint={t("adminText.instructionHint")}
          value={instruction}
          onChange={setInstruction}
        />
      </section>

      {removing && (
        <Dialog title={t("adminText.removeTitle", { language: removing.name })} onClose={() => setRemoving(undefined)}>
          <p>{t("adminText.removeBody", { language: removing.name })}</p>
          <PublishFailure failure={failure} />
          <div className="gfa-dialog-actions">
            <Button onClick={() => setRemoving(undefined)}>{t("action.cancel")}</Button>
            <Button variant="danger" onClick={() => void remove(removing)}>
              {t("adminText.remove")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

function LanguageRow({
  code,
  name,
  status,
  disabled,
  onTranslate,
  onRemove,
}: {
  code: string;
  name: string;
  status: LanguageStatus;
  disabled: boolean;
  onTranslate: (outdated: boolean) => void;
  onRemove: () => void;
}) {
  const t = useStrings();
  return (
    <tr>
      <td>
        <strong lang={code}>{name}</strong> <code>{code}</code>
      </td>
      <td>
        {t("adminText.status", { current: String(status.current), total: String(status.total) })}
        {status.outdated > 0 && (
          <div className="gfa-hint">{t("adminText.outdated", { count: String(status.outdated) })}</div>
        )}
        {status.unusable > 0 && (
          <div className="gfa-hint">{t("adminText.unusable", { count: String(status.unusable) })}</div>
        )}
        {status.reviewed > 0 && (
          <div className="gfa-hint">{t("adminText.reviewed", { count: String(status.reviewed) })}</div>
        )}
      </td>
      <td className="gfa-row-actions">
        {status.missing + status.unusable > 0 && (
          <Button variant="primary" disabled={disabled} onClick={() => onTranslate(false)}>
            {t("adminText.translate")}
          </Button>
        )}
        {status.outdated > 0 && (
          <Button disabled={disabled} onClick={() => onTranslate(true)}>
            {t("adminText.translateOutdated")}
          </Button>
        )}
        <Button variant="danger" onClick={onRemove}>
          {t("adminText.remove")}
        </Button>
      </td>
    </tr>
  );
}
