import {
  AiError,
  type AiRequest,
  type AiTask,
  buildRequest,
  CLAUDE_MODELS,
  listModels,
  manualPrompt,
  PROVIDERS,
  type ProviderId,
  parseAnswer,
  runRequest,
  type SiteSummary,
  type StockPhotoError,
  stockPhotoQueries,
  toContent,
  toValues,
  withStockPhotos,
} from "@goodfellow-cms/ai";
import {
  allPages,
  type Collection,
  entryTitle,
  hasLanguages,
  mainLanguage,
  pageLanguage,
  pageTranslations,
  pathLanguage,
  type SiteContent,
  siteLanguages,
} from "@goodfellow-cms/core";
import type { ComponentData, Config, Data, Fields } from "@puckeditor/core";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { allowedProviders, useAiSettings, useStockPhotoChoice } from "./ai-settings.js";
import { mediaFileChange, pageTitle } from "./changes.js";
import { inSentence } from "./collection-screen.js";
import type { EditorChange } from "./frame/protocol.js";
import { allMedia, fileName, siteImages } from "./media.js";
import { findStockPhotos, stockPhotoChanges } from "./stock-photos.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, ErrorMessage, Field, TextField } from "./ui.js";

/** What's being edited, as the editor's frame reports it, and a way to change it there. */
export interface AiEditor {
  data: Data;
  selected: ComponentData | null;
  /** Puck's config as JSON: the blocks' and settings' fields. */
  config: Config;
  /** Makes a change in the editor, where Undo can take it back. */
  apply(change: EditorChange): Promise<void>;
}

/** Which editor the panel is in, which decides what it can do. */
export interface AiContext {
  kind: "page" | "header" | "footer" | "template" | "entry";
  path: string;
  title: string;
  collection?: Collection;
  /** The language of what's being edited. */
  language?: string;
}

type Mode = "add" | "edit" | "fill";

const claudeModelLabels: Record<string, StringKey> = {
  "claude-opus-5-5": "ai.model.claude-opus-5-5",
  "claude-sonnet-5-5": "ai.model.claude-sonnet-5-5",
  "claude-haiku-4-5": "ai.model.claude-haiku-4-5",
};

function siteSummary(content: SiteContent, media: string[], stockPhotos: boolean, language: string): SiteSummary {
  return {
    title: content.settings.title,
    description: content.settings.description,
    // The language of the page being edited, which may be one of the site's other languages.
    language,
    pages: allPages(content)
      .slice(0, 200)
      .map((page) => {
        const found = page.entry && content.collections.find((collection) => collection.id === page.entry?.collection);
        const entry = found?.entries.find((candidate) => candidate.slug === page.entry?.slug);
        return { path: page.path, title: entry ? entryTitle(entry) : pageTitle(page) };
      }),
    collections: content.collections.map((collection) => ({
      id: collection.id,
      name: collection.settings.name,
      fields: collection.settings.fields.map(({ name, label }) => ({ name, label })),
    })),
    images: siteImages(media),
    contact: content.settings.contact,
    ...(stockPhotos && { stockPhotos }),
  };
}

function newId(type: string): string {
  return `${type}-${crypto.randomUUID()}`;
}

/** What happened to the photos the AI asked for. */
interface PhotoReport {
  /** The names of the photos added. */
  added: string[];
  missing: number;
  /** Why Openverse couldn't be asked for them all. */
  problem?: StockPhotoError;
  /** Why the photos found couldn't be added to the media library. */
  failure?: unknown;
}

type Status =
  | { type: "idle" }
  | { type: "working"; characters: number }
  | { type: "photos" }
  | { type: "done"; photos?: PhotoReport }
  | { type: "failed"; error: unknown }
  | { type: "manual"; prompt: string; task: AiTask };

export function problemKey(error: unknown): StringKey {
  if (error instanceof AiError) return `ai.error.${error.problem}` as StringKey;
  if (error instanceof SyntaxError) return "ai.error.answer";
  return "ai.error.service";
}

export function ServiceSettings({
  providers,
  settings,
  onChange,
  siteAi,
}: {
  providers: ProviderId[];
  settings: ReturnType<typeof useAiSettings>[0];
  onChange: ReturnType<typeof useAiSettings>[1];
  /** The services a full-stack site's server asks with keys of its own. */
  siteAi?: { server: string; services: string[]; fetch?: typeof fetch };
}) {
  const t = useStrings();
  const info = PROVIDERS[settings.provider];
  const sitePays = siteAi?.services.includes(settings.provider) ?? false;
  const service = serviceName(settings.provider, t);
  const [models, setModels] = useState<string[]>(info.models ?? []);
  const listId = useRef(`gfa-ai-models-${Math.random().toString(36).slice(2)}`).current;

  // Ask the service which models it has, once it can be asked.
  const { provider, apiKey, baseUrl } = settings;
  const server = sitePays ? siteAi?.server : undefined;
  const serverFetch = sitePays ? siteAi?.fetch : undefined;
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setModels(PROVIDERS[provider].models ?? []);
    const timer = setTimeout(() => {
      const asked = server ? { provider, server, model: "" } : { provider, apiKey, baseUrl, model: "" };
      listModels(asked, { signal: controller.signal, ...(serverFetch && { fetch: serverFetch }) })
        .then((found) => {
          if (!cancelled && found.length > 0) setModels(found);
        })
        .catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [provider, apiKey, baseUrl, server, serverFetch]);

  return (
    <div className="gfa-form gfa-ai-settings">
      <Field label={t("ai.provider")}>
        {(props) => (
          <select
            {...props}
            className="gfa-input"
            value={settings.provider}
            onChange={(event) => onChange({ provider: event.target.value as ProviderId })}
          >
            {providers.map((id) => (
              <option key={id} value={id}>
                {serviceName(id, t)}
                {siteAi?.services.includes(id)
                  ? ` ${t("ai.siteKey")}`
                  : !PROVIDERS[id].needsKey && id !== "manual" && id !== "custom"
                    ? ` ${t("ai.noKey")}`
                    : ""}
              </option>
            ))}
          </select>
        )}
      </Field>

      {sitePays && <p className="gfa-hint">{t("ai.siteKeyHint", { service })}</p>}

      {settings.provider === "custom" && !sitePays && (
        <TextField
          label={t("ai.baseUrl")}
          hint={t("ai.baseUrlHint")}
          type="url"
          value={settings.baseUrl ?? ""}
          onChange={(baseUrl) => onChange({ baseUrl })}
        />
      )}

      {settings.provider !== "manual" && !sitePays && (info.needsKey || settings.provider === "custom") && (
        <>
          <TextField
            label={t("ai.key")}
            hint={t("ai.keyHint", { service })}
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={settings.apiKey ?? ""}
            onChange={(apiKey) => onChange({ apiKey: apiKey.trim() || undefined })}
          />
          {info.keyUrl && (
            <a className="gfa-hint" href={info.keyUrl} target="_blank" rel="noreferrer">
              {t("ai.getKey", { service })}
            </a>
          )}
          <label className="gfa-checkbox">
            <input
              type="checkbox"
              checked={settings.remember}
              onChange={(event) => onChange({ remember: event.target.checked })}
            />
            {t("ai.remember")}
          </label>
          {info.needsKey && <p className="gfa-hint">{t("ai.costHint", { service })}</p>}
          {settings.apiKey && (
            <div>
              <Button variant="ghost" onClick={() => onChange({ apiKey: undefined })}>
                {t("ai.forget")}
              </Button>
            </div>
          )}
        </>
      )}

      {settings.provider === "anthropic" ? (
        <Field label={t("ai.model")}>
          {(props) => (
            <select
              {...props}
              className="gfa-input"
              value={settings.model}
              onChange={(event) => onChange({ model: event.target.value })}
            >
              {CLAUDE_MODELS.map((model) => (
                <option key={model} value={model}>
                  {claudeModelLabels[model] ? t(claudeModelLabels[model]) : model}
                </option>
              ))}
            </select>
          )}
        </Field>
      ) : (
        settings.provider !== "manual" && (
          <>
            <TextField
              label={t("ai.model")}
              hint={t("ai.modelHint")}
              list={listId}
              spellCheck={false}
              value={settings.model}
              onChange={(model) => onChange({ model: model.trim() })}
            />
            <datalist id={listId}>
              {models.map((model) => (
                <option key={model} value={model} />
              ))}
            </datalist>
          </>
        )
      )}
    </div>
  );
}

function serviceName(id: ProviderId, t: ReturnType<typeof useStrings>): string {
  if (id === "manual") return t("ai.provider.manual");
  if (id === "custom") return t("ai.provider.custom");
  return PROVIDERS[id].name;
}

/**
 * The AI panel: describe what to write, and it's added to the page, replaces
 * the selected block, or fills in the fields. It's in the admin panel's own
 * page, beside the editor's frame, so the site's blocks never see the editor's keys.
 */
/**
 * The AI service the editor chose, as the AI panel and the Admin languages
 * screen both use it: the site's services first, asked through its server
 * with its key where it has one, otherwise with the editor's own.
 */
export function useAiService() {
  const { site, account } = useAdmin();
  const siteAi = account?.ai;
  const providers = useMemo(() => {
    const allowed = allowedProviders(site.ai ? site.ai.providers : undefined);
    // The services the site pays for come first, so editors start with one that needs no key.
    const paid = allowed.filter((id) => siteAi?.services.includes(id));
    return [...paid, ...allowed.filter((id) => !paid.includes(id))];
  }, [site.ai, siteAi]);
  const [chosen, updateSettings] = useAiSettings(providers);
  const settings = useMemo(
    () =>
      siteAi?.services.includes(chosen.provider)
        ? { ...chosen, apiKey: undefined, baseUrl: undefined, server: siteAi.server }
        : chosen,
    [chosen, siteAi],
  );
  const ready =
    settings.provider === "manual" ||
    (Boolean(settings.model) &&
      (!PROVIDERS[settings.provider].needsKey || Boolean(settings.apiKey) || Boolean(settings.server)));
  /** What `runRequest()` needs besides the settings: the broker's `fetch`, where it sends requests on. */
  const runOptions = useMemo(
    () => (settings.server && siteAi?.fetch ? { fetch: siteAi.fetch } : {}),
    [settings.server, siteAi],
  );
  return { providers, chosen, updateSettings, settings, siteAi, ready, runOptions };
}

export function AiPanel({ context, editor }: { context: AiContext; editor: AiEditor }) {
  const t = useStrings();
  const { site, publish, mediaPreviews } = useAdmin();
  const { content, media } = useSiteContent();
  const selected = editor.selected;
  const { providers, chosen, updateSettings, settings, siteAi, ready } = useAiService();
  const [photosChosen, choosePhotos] = useStockPhotoChoice();
  const photosOffered = !(site.ai && site.ai.stockPhotos === false);
  const photosAllowed = photosOffered && photosChosen;
  const [instruction, setInstruction] = useState("");
  const [reply, setReply] = useState("");
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const controller = useRef<AbortController | null>(null);

  const mode: Mode = context.kind === "entry" ? "fill" : selected ? "edit" : "add";
  const service = serviceName(settings.provider, t);
  const blockName = (block: ComponentData | null) =>
    block ? (editor.config.components[block.type]?.label ?? block.type) : "";
  const itemName = inSentence(context.collection?.settings.entryName ?? "");
  // Open at first if the service isn't set up yet, and then wherever the editor leaves it.
  const [settingsOpen, setSettingsOpen] = useState(!ready);

  useEffect(() => () => controller.current?.abort(), []);

  const taskFor = (text: string): AiTask => {
    const { data, config: puckConfig, selected: selectedItem } = editor;
    const appState = { data };
    if (mode === "fill") {
      return {
        kind: "fill",
        name: itemName,
        fields: (puckConfig.root?.fields ?? {}) as Fields,
        values: { ...(appState.data.root.props ?? {}) },
        instruction: text,
      };
    }
    if (mode === "edit" && selectedItem) return { kind: "edit", block: selectedItem, instruction: text };
    return {
      kind: "add",
      page: { path: context.path, title: context.title },
      content: appState.data.content,
      ...(context.kind === "template" &&
        context.collection && {
          template: {
            name: context.collection.settings.name,
            fields: context.collection.settings.fields.map(({ name, label }) => ({ name, label })),
          },
        }),
      instruction: text,
    };
  };

  /** Puts the AI's answer into the editor, where Undo can take it back. */
  const apply = async (task: AiTask, answer: unknown) => {
    if (task.kind === "fill") {
      await editor.apply({ type: "root", props: toValues(answer, task.fields, task.values) });
      return;
    }
    const blocks = toContent(answer, editor.config, newId);
    const [first] = blocks;
    if (!first) throw new AiError("answer", "The answer didn't contain any blocks that could be used.");
    if (task.kind === "translate") {
      const root = answer && typeof answer === "object" ? (answer as { root?: unknown }).root : undefined;
      const props = toValues({ values: root }, task.rootFields, task.root);
      await editor.apply({ type: "translate", props, content: blocks });
      return;
    }
    if (task.kind === "edit") {
      await editor.apply({ type: "replace", id: String(task.block.props.id), block: first });
      return;
    }
    await editor.apply({ type: "append", blocks });
  };

  /**
   * Finds the photos the AI asked for, adds them to the media library with
   * their credits in one publish, and puts their addresses in the answer.
   * Fields whose photo wasn't found are left empty.
   */
  const addPhotos = async (answer: unknown, signal: AbortSignal) => {
    const queries = photosAllowed ? stockPhotoQueries(answer) : [];
    if (queries.length === 0) return { answer: withStockPhotos(answer, new Map()) };
    setStatus({ type: "photos" });
    const found = await findStockPhotos(queries, { taken: media.map(fileName), signal });
    let added = found.photos;
    let failure: unknown;
    if (added.length > 0 && !signal.aborted) {
      // Shown from memory until the live site has them.
      for (const photo of added) mediaPreviews.remember(photo.url, photo.bytes);
      const credits = { ...content.credits, ...Object.fromEntries(added.map((photo) => [photo.url, photo.credit])) };
      const result = await publish(
        [...stockPhotoChanges(added), mediaFileChange({ credits, descriptions: content.descriptions })],
        t("ai.photos.message", { names: added.map((photo) => fileName(photo.url)).join(", ") }),
        { checks: false },
      );
      if (!result.ok) {
        failure = result.error;
        added = [];
      }
    }
    const photos = new Map(added.map((photo) => [photo.query, photo.url]));
    const report: PhotoReport = {
      added: added.map((photo) => fileName(photo.url)),
      missing: queries.length - added.length,
      problem: found.problem,
      failure,
    };
    return { answer: withStockPhotos(answer, photos), photos: report };
  };

  // The language of the page or item being edited, and whether it's one to translate into.
  const language = context.language ?? pathLanguage(content.settings, context.path);
  const translating =
    hasLanguages(content.settings) && context.kind !== "template" && language !== mainLanguage(content.settings)
      ? siteLanguages(content.settings).find((candidate) => candidate.code === language)
      : undefined;

  /** Translates the whole page, or every field of the item, into the page's language. */
  const translationTask = (): AiTask | undefined => {
    if (!translating) return undefined;
    const { data, config: puckConfig } = editor;
    const appState = { data };
    const named = `${translating.name} (${translating.code})`;
    if (context.kind === "entry") {
      return {
        kind: "fill",
        name: itemName,
        fields: (puckConfig.root?.fields ?? {}) as Fields,
        values: { ...(appState.data.root.props ?? {}) },
        instruction: `Translate every value into ${named}. Keep addresses, image addresses, dates and times as they are.${
          instruction.trim() ? `\n\n${instruction.trim()}` : ""
        }`,
      };
    }
    // Links to pages that have a translation in this language go to it.
    const links = content.pages.flatMap((page) => {
      const translation = pageTranslations(content, page).get(language);
      return pageLanguage(content, page) === mainLanguage(content.settings) && translation
        ? [{ from: page.path, to: translation.path }]
        : [];
    });
    return {
      kind: "translate",
      page: { path: context.path, title: context.title },
      content: appState.data.content,
      rootFields: (puckConfig.root?.fields ?? {}) as Fields,
      root: Object.fromEntries(Object.entries(appState.data.root.props ?? {}).filter(([name]) => name !== "id")),
      language: named,
      links,
      ...(instruction.trim() && { instruction: instruction.trim() }),
    };
  };

  const run = async () => {
    const text = instruction.trim();
    if (!text) return;
    await runTask(taskFor(text));
  };

  const runTask = async (task: AiTask) => {
    const request: AiRequest = buildRequest(
      task,
      editor.config,
      siteSummary(content, allMedia(content, media), photosAllowed, language),
    );
    if (settings.provider === "manual") {
      setReply("");
      setCopied(false);
      setStatus({ type: "manual", prompt: manualPrompt(request), task });
      return;
    }
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setStatus({ type: "working", characters: 0 });
    try {
      const answer = await runRequest(settings, request, {
        signal: current.signal,
        ...(settings.server && siteAi?.fetch && { fetch: siteAi.fetch }),
        onProgress: (characters) => setStatus({ type: "working", characters }),
      });
      if (current.signal.aborted) return;
      const filled = await addPhotos(answer, current.signal);
      if (current.signal.aborted) return;
      await apply(task, filled.answer);
      setStatus({ type: "done", photos: filled.photos });
    } catch (error) {
      if (current.signal.aborted) setStatus({ type: "idle" });
      else setStatus({ type: "failed", error });
    }
  };

  const applyReply = async () => {
    if (status.type !== "manual") return;
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const { task } = status;
    try {
      const filled = await addPhotos(parseAnswer(reply), current.signal);
      if (current.signal.aborted) return;
      await apply(task, filled.answer);
      setStatus({ type: "done", photos: filled.photos });
    } catch (error) {
      if (current.signal.aborted) setStatus({ type: "idle" });
      else setStatus({ type: "failed", error });
    }
  };

  const working = status.type === "working" || status.type === "photos";

  return (
    <div className="gfa-ai">
      <h2 className="gfa-ai-title">{t("ai.title")}</h2>
      <p className="gfa-hint">
        {mode === "fill"
          ? t("ai.mode.fill", { item: itemName })
          : mode === "edit"
            ? t("ai.mode.edit", { block: blockName(selected) })
            : t("ai.mode.add")}
      </p>

      {translating && (
        <div className="gfa-ai-translate">
          <p className="gfa-hint">
            {t(context.kind === "entry" ? "ai.translate.entryHint" : "ai.translate.hint", {
              language: translating.name,
            })}
          </p>
          <Button
            variant="primary"
            disabled={working || !ready}
            onClick={() => {
              const task = translationTask();
              if (task) void runTask(task);
            }}
          >
            {t("ai.translate", { language: translating.name })}
          </Button>
        </div>
      )}

      <Field label={t("ai.instruction")}>
        {(props) => (
          <textarea
            {...props}
            className="gfa-input"
            rows={6}
            value={instruction}
            placeholder={t(
              mode === "fill" ? "ai.placeholder.fill" : mode === "edit" ? "ai.placeholder.edit" : "ai.placeholder.add",
            )}
            onChange={(event) => setInstruction(event.target.value)}
          />
        )}
      </Field>

      {photosOffered && (
        <div>
          <label className="gfa-checkbox">
            <input type="checkbox" checked={photosChosen} onChange={(event) => choosePhotos(event.target.checked)} />
            {t("ai.photos")}
          </label>
          <p className="gfa-hint">{t("ai.photosHint")}</p>
        </div>
      )}

      {!ready && <p className="gfa-hint">{t("ai.needsKey", { service })}</p>}

      <div className="gfa-ai-actions">
        <Button variant="primary" disabled={working || !ready || !instruction.trim()} onClick={() => void run()}>
          {t(mode === "fill" ? "ai.fill" : mode === "edit" ? "ai.change" : "ai.write")}
        </Button>
        {working && <Button onClick={() => controller.current?.abort()}>{t("ai.stop")}</Button>}
      </div>

      {status.type === "working" && (
        <p className="gfa-notice" role="status">
          {status.characters > 0 ? t("ai.progress", { count: String(status.characters) }) : t("ai.working")}
        </p>
      )}
      {status.type === "photos" && (
        <p className="gfa-notice" role="status">
          {t("ai.photos.finding")}
        </p>
      )}
      {status.type === "done" && (
        <>
          <p className="gfa-notice gfa-notice-success" role="status">
            {t("ai.done")}
            {status.photos?.added.length ? ` ${t("ai.photos.added", { names: status.photos.added.join(", ") })}` : null}
          </p>
          {status.photos && <PhotoProblems report={status.photos} />}
        </>
      )}
      {status.type === "failed" && (
        <ErrorMessage message={t(problemKey(status.error), { service })} error={status.error} />
      )}

      {status.type === "manual" && (
        <div className="gfa-form gfa-ai-manual">
          <Field label={t("ai.manual.step1")}>
            {(props) => <textarea {...props} className="gfa-input gfa-code" rows={5} readOnly value={status.prompt} />}
          </Field>
          <div>
            <Button
              onClick={() =>
                void navigator.clipboard?.writeText(status.prompt).then(
                  () => setCopied(true),
                  () => setCopied(false),
                )
              }
            >
              {copied ? t("ai.manual.copied") : t("ai.manual.copy")}
            </Button>
          </div>
          <Field label={t("ai.manual.step2")}>
            {(props) => (
              <textarea
                {...props}
                className="gfa-input gfa-code"
                rows={5}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
              />
            )}
          </Field>
          <div>
            <Button variant="primary" disabled={!reply.trim()} onClick={() => void applyReply()}>
              {t("ai.manual.use")}
            </Button>
          </div>
        </div>
      )}

      <p className="gfa-hint">{t("ai.check")}</p>

      <details
        className="gfa-ai-service"
        open={settingsOpen}
        onToggle={(event) => setSettingsOpen(event.currentTarget.open)}
      >
        <summary>{t("ai.settings", { service })}</summary>
        <ServiceSettings
          providers={providers}
          settings={chosen}
          onChange={updateSettings}
          {...(siteAi && { siteAi })}
        />
      </details>
    </div>
  );
}

/** Why some of the photos the AI asked for weren't added, if any weren't. */
function PhotoProblems({ report }: { report: PhotoReport }) {
  const t = useStrings();
  if (report.failure) return <ErrorMessage message={t("ai.photos.error.publish")} error={report.failure} />;
  if (report.problem) {
    return <ErrorMessage message={t(`ai.photos.error.${report.problem.problem}`)} error={report.problem} />;
  }
  if (report.missing > 0)
    return <p className="gfa-notice">{t("ai.photos.missing", { count: String(report.missing) })}</p>;
  return null;
}
