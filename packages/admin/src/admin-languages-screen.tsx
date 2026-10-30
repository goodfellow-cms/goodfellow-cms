/**
 * Site Settings' Admin panel languages screen: the languages the site has the
 * admin panel's text in (`content/admin-text/<code>.json`), how much of it
 * each says, and translating what's missing or out of date with the AI
 * service the editor chose (`translateAdminText()` in `@goodfellow-cms/ai`,
 * a batch at a time with its glossary), publishing what came back in one
 * publish, even when the service stopped part way, so it's never asked for
 * twice. Every string is checked again as it's used (`composeAdminText()`).
 * Each language, Goodfellow's own included, opens in `AdminTextEditor` at
 * `#/settings/admin-languages/<code>`, to change its words by hand, and
 * languages can come from language packs on npm (`LanguagePacks`).
 */
import { translateAdminText } from "@goodfellow-cms/ai";
import {
  type AdminTextFile,
  adminTextFile,
  adminTextFileChange,
  isLanguageCode,
  readAdminText,
} from "@goodfellow-cms/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdmin } from "./admin-context.js";
import { ADMIN_LANGUAGES, type AdminText } from "./admin-language.js";
import { AdminTextEditor } from "./admin-text-editor.js";
import {
  adminTextSources,
  type LanguageStatus,
  labelSources,
  languageStatus,
  sourceKey,
  sourcesToTranslate,
  withTranslations,
} from "./admin-text-sources.js";
import { problemKey, ServiceSettings, useAiService } from "./ai-panel.js";
import { LanguagePacks } from "./language-packs.js";
import { PUCK_ENGLISH } from "./languages/en-puck.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { useRoute } from "./router.js";
import { defaultStrings, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, TextField } from "./ui.js";
import { AppLink } from "./use-link.js";

const isBuiltIn = (code: string) => ADMIN_LANGUAGES.some((language) => language.code === code);

/** What each string shows in one of Goodfellow's languages, by `sourceKey()`, before the site changes any. */
function shippedDefaults(text: AdminText | undefined): Map<string, string> {
  const strings = text?.strings ?? defaultStrings;
  return new Map<string, string>([
    ...Object.entries(strings).map(([key, value]) => [sourceKey("strings", key), value] as [string, string]),
    ...Object.entries({ ...PUCK_ENGLISH, ...text?.puck }).map(
      ([key, value]) => [sourceKey("puck", key), value] as [string, string],
    ),
    ...Object.entries(text?.labels ?? {}).map(([key, value]) => [sourceKey("labels", key), value] as [string, string]),
  ]);
}

/** The defaults the editor shows for a language: Goodfellow's words where it ships the language, else English. */
function useDefaults(code: string | undefined): Map<string, string> | undefined {
  const [spanish, setSpanish] = useState<AdminText>();
  useEffect(() => {
    if (code !== "es" || spanish) return;
    let live = true;
    void import("./languages/es.js").then((module) => live && setSpanish(module.spanish));
    return () => {
      live = false;
    };
  }, [code, spanish]);
  return useMemo(() => {
    if (code === "es") return spanish && shippedDefaults(spanish);
    return shippedDefaults(undefined);
  }, [code, spanish]);
}

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
  const { segments } = useRoute();
  const editing = segments[0] === "settings" && segments[1] === "admin-languages" ? segments[2] : undefined;
  const defaults = useDefaults(editing);
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

  const languages = Object.entries(files ?? {})
    .filter(([languageCode]) => !isBuiltIn(languageCode))
    .sort(([a], [b]) => a.localeCompare(b));

  // A language's words, opened from its row.
  if (editing && files && sources && defaults) {
    const builtIn = ADMIN_LANGUAGES.find((language) => language.code === editing);
    const file = files[editing];
    const languageName = builtIn?.name ?? file?.name;
    if (languageName) {
      return (
        <AdminTextEditor
          key={editing}
          code={editing}
          name={languageName}
          file={file}
          sources={sources}
          defaults={defaults}
          builtIn={Boolean(builtIn)}
        />
      );
    }
  }

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
                {...(file.pack && { pack: file.pack })}
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
        <h2 className="gfa-section-title">{t("adminText.own.title")}</h2>
        <p className="gfa-hint">{t("adminText.own.intro")}</p>
        <table className="gfa-table">
          <tbody>
            {ADMIN_LANGUAGES.map((language) => {
              const file = files?.[language.code];
              const changed = file
                ? Object.keys(file.strings).length + Object.keys(file.puck).length + Object.keys(file.labels).length
                : 0;
              return (
                <tr key={language.code}>
                  <td>
                    <strong lang={language.code}>{language.name}</strong> <code>{language.code}</code>
                  </td>
                  <td>{changed > 0 && t("adminText.own.changed", { count: String(changed) })}</td>
                  <td className="gfa-row-actions">
                    <AppLink
                      href={`#/settings/admin-languages/${language.code}`}
                      className="gfa-button gfa-button-secondary"
                    >
                      {t("adminText.own.change")}
                    </AppLink>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {files && sources && <LanguagePacks files={files} sources={sources} />}

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
  pack,
  status,
  disabled,
  onTranslate,
  onRemove,
}: {
  code: string;
  name: string;
  /** The language pack it came from, where it did. */
  pack?: { name: string; release: string };
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
        {pack && <div className="gfa-hint">{t("adminText.pack.from", { name: pack.name, version: pack.release })}</div>}
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
        <AppLink href={`#/settings/admin-languages/${code}`} className="gfa-button gfa-button-secondary">
          {t("adminText.edit")}
        </AppLink>
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
