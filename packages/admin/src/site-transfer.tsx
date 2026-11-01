import {
  CONTENT_DIR,
  type FetchJson,
  type FileChange,
  GOODFELLOW_REGISTRY,
  INSTALLED_PLUGINS_FILE,
  INSTALLED_RECORD_FILE,
  MAX_UPLOAD_BYTES,
  MEDIA_DIR,
  mediaKind,
  parseInstalledRecord,
  planBlockChanges,
  planSiteImport,
  type SiteImport,
  type SiteImportConflict,
  SiteImportError,
  type SiteImportNote,
  transferPaths,
} from "@goodfellow-cms/core";
import { useEffect, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { fileName, mediaUrl } from "./media.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { type DownloadProgress, downloadName, siteCopyArchive } from "./site-download.js";
import { type StringKey, type Translate, useStrings } from "./strings.js";
import { Button, ErrorMessage } from "./ui.js";
import { AppLink } from "./use-link.js";

const fetchJson: FetchJson = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return response.json();
};

/** Saves zip pieces as a download. */
function saveZip(chunks: Uint8Array[], name: string): void {
  const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "application/zip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  // Browsers start the download from the address before it's let go.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Downloads the site's content and media as one zip, with its manifest, for another Goodfellow site to import. */
export function SiteExportSection() {
  const t = useStrings();
  const { listFiles, readBytes } = useAdmin();
  const { content } = useSiteContent();
  const [progress, setProgress] = useState<DownloadProgress>();
  const [error, setError] = useState<unknown>();
  const stored = Object.keys(content.mediaStorage?.files ?? {}).length > 0;

  const download = async () => {
    setError(undefined);
    setProgress({ done: 0, total: 0 });
    try {
      saveZip(
        await siteCopyArchive(listFiles, readBytes, content, setProgress),
        downloadName(content.settings.title, new Date()),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setProgress(undefined);
    }
  };

  return (
    <section aria-labelledby="gfa-site-export-title">
      <h2 id="gfa-site-export-title" className="gfa-section-title">
        {t("siteTransfer.export.title")}
      </h2>
      <p>{t("siteTransfer.export.intro")}</p>
      {stored && <p className="gfa-hint">{t("siteTransfer.export.stored")}</p>}
      <p className="gfa-import-actions">
        <Button onClick={() => void download()} disabled={progress !== undefined}>
          {t("siteTransfer.export.button")}
        </Button>
      </p>
      {progress && progress.total > 0 && (
        <p role="status">
          {t("siteTransfer.export.working", { done: String(progress.done), total: String(progress.total) })}
        </p>
      )}
      {error !== undefined && <ErrorMessage message={t("siteTransfer.export.error")} error={error} />}
    </section>
  );
}

/** The file chosen, unpacked, with what's known about it before planning. */
interface Loaded {
  name: string;
  /** Each of the export's files' bytes, by its path in the site. */
  files: Map<string, Uint8Array>;
  /** The site's own files in the content and media folders. */
  siteFiles: string[];
  /** Media both have with the same bytes. */
  same: Set<string>;
  /** Media that can't be uploaded: too large, or of a kind uploads refuse. */
  uncopied: Set<string>;
  /** The plugins the site has. */
  plugins: string[];
}

interface Choices {
  replace: boolean;
  menus: boolean;
  settings: boolean;
  layout: boolean;
  redirects: boolean;
  withoutMissingBlocks: boolean;
  take: Set<string>;
  /** Blocks to add from Goodfellow's registry, by name. */
  install: Set<string>;
}

const NO_CHOICES: Choices = {
  replace: false,
  menus: false,
  settings: false,
  layout: false,
  redirects: false,
  withoutMissingBlocks: false,
  take: new Set(),
  install: new Set(),
};

const decoder = new TextDecoder();

/** The export's files, as `planSiteImport()` reads them. */
function transferFiles(files: Map<string, Uint8Array>) {
  return {
    paths: [...files.keys()],
    read: (path: string) => {
      const bytes = files.get(path);
      return bytes && decoder.decode(bytes);
    },
  };
}

function listed(t: Translate, items: string[]): string {
  const shown = items.slice(0, 3).join(", ");
  return items.length > 3 ? t("import.note.more", { items: shown, count: String(items.length - 3) }) : shown;
}

function noteText(t: Translate, note: SiteImportNote, blockName: (name: string) => string): string {
  switch (note.kind) {
    case "missing-block":
      return t("siteTransfer.note.missingBlock", { name: blockName(note.name), items: listed(t, note.items) });
    case "left-out":
      return t("siteTransfer.note.leftOut", { items: listed(t, note.items) });
    case "without-blocks":
      return t("siteTransfer.note.withoutBlocks", { items: listed(t, note.items) });
    case "taken":
      return t("siteTransfer.note.taken", { items: listed(t, note.items) });
    case "collection-differs":
      return t("siteTransfer.note.collectionDiffers", { collections: listed(t, note.collections) });
    case "uncopied":
      return t("siteTransfer.note.uncopied", { items: listed(t, note.files) });
    case "stored-media":
      return t(note.merged ? "siteTransfer.note.storedMerged" : "siteTransfer.note.stored", {
        count: String(note.count),
      });
    case "languages":
      return t("siteTransfer.note.languages", { codes: note.codes.join(", ") });
    case "plugins":
      return t("siteTransfer.note.plugins", { names: listed(t, note.names) });
    case "code":
      return t("siteTransfer.note.code");
    case "kept":
      return t("siteTransfer.note.kept", {
        things: note.things.map((thing) => t(`siteTransfer.kept.${thing}` as StringKey)).join(", "),
      });
  }
}

function conflictText(t: Translate, conflict: SiteImportConflict): string {
  const values = { name: conflict.name, detail: conflict.detail ?? "" };
  switch (conflict.kind) {
    case "page":
      return t("siteTransfer.conflict.page", values);
    case "item":
      return t("siteTransfer.conflict.item", values);
    case "collection":
      return t("siteTransfer.conflict.collection", values);
    case "synced-block":
      return t("siteTransfer.conflict.syncedBlock", values);
    case "media":
      return t("siteTransfer.conflict.media", values);
  }
}

function problemText(t: Translate, error: unknown): string {
  if (error instanceof SiteImportError) {
    if (error.problem === "not-a-site") return t("siteTransfer.error.notASite");
    if (error.problem === "newer") return t("siteTransfer.error.newer");
    return t("siteTransfer.error.invalid");
  }
  return t("siteTransfer.error.other");
}

/**
 * Brings another Goodfellow site's export into this one with
 * `planSiteImport()`: added to its content, with a choice for each thing both
 * have differently, or in place of it, then published in one go, with blocks
 * from Goodfellow's registry it lacks added in the same publish where the
 * site's code can be changed from here.
 */
export function SiteImportSection() {
  const t = useStrings();
  const { blocks, publish, mediaPreviews, listFiles, readBytes, readFile, registries } = useAdmin();
  const { contentOnly, demo, account, site } = useAdmin();
  const { content } = useSiteContent();
  const [loaded, setLoaded] = useState<Loaded>();
  const [choices, setChoices] = useState<Choices>(NO_CHOICES);
  const [plan, setPlan] = useState<SiteImport>();
  const [reading, setReading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [done, setDone] = useState<string>();
  const [problem, setProblem] = useState<{ message: string; error?: unknown }>();
  const [failure, setFailure] = useState<Failure>(null);
  // Blocks are code: added only where this page may publish code, and not where a developer reviews it.
  const mayInstall = !contentOnly && !demo && !account?.codeReview;
  const blockName = (name: string) => blocks[name]?.label ?? name;

  useEffect(() => {
    if (!loaded) return;
    let current = true;
    planSiteImport(
      transferFiles(loaded.files),
      { content, files: loaded.siteFiles, read: readFile },
      {
        ...choices,
        blocks: Object.keys(blocks),
        installing: [...choices.install],
        plugins: loaded.plugins,
        sameMedia: loaded.same,
        uncopied: loaded.uncopied,
      },
    ).then(
      (next) => current && setPlan(next),
      (error: unknown) => {
        if (!current) return;
        setProblem({ message: problemText(t, error), error });
        setLoaded(undefined);
        setPlan(undefined);
      },
    );
    return () => {
      current = false;
    };
  }, [loaded, choices, content, blocks, readFile, t]);

  const choose = async (file: File) => {
    setProblem(undefined);
    setFailure(null);
    setDone(undefined);
    setPlan(undefined);
    setReading(true);
    try {
      const { unzipSync } = await import("fflate");
      const archive = unzipSync(new Uint8Array(await file.arrayBuffer()));
      const paths = transferPaths(Object.keys(archive));
      if (paths.size === 0) throw new SiteImportError("not-a-site");
      const files = new Map<string, Uint8Array>();
      for (const [path, at] of paths) {
        const bytes = archive[at];
        if (bytes) files.set(path, bytes);
      }
      const siteFiles = [...(await listFiles(CONTENT_DIR)), ...(await listFiles(MEDIA_DIR))];
      const same = new Set<string>();
      const uncopied = new Set<string>();
      const mine = new Set(siteFiles);
      for (const [path, bytes] of files) {
        if (!path.startsWith(`${MEDIA_DIR}/`)) continue;
        if (bytes.length > MAX_UPLOAD_BYTES || !mediaKind(fileName(path))) uncopied.add(path);
        else if (mine.has(path)) {
          const own = await readBytes(path);
          if (own && own.length === bytes.length && own.every((byte, index) => byte === bytes[index])) same.add(path);
        }
      }
      let plugins = (site.description.plugins ?? []).map((plugin) => plugin.name);
      try {
        const text = await readFile(INSTALLED_PLUGINS_FILE);
        if (text) plugins = [...plugins, ...Object.keys((JSON.parse(text) as { plugins?: object }).plugins ?? {})];
      } catch {
        // A record that can't be read names no plugins.
      }
      setChoices(NO_CHOICES);
      setLoaded({ name: file.name, files, siteFiles, same, uncopied, plugins });
    } catch (error) {
      setProblem({ message: problemText(t, error), error });
    } finally {
      setReading(false);
    }
  };

  const importNow = async () => {
    if (!loaded || !plan) return;
    setPublishing(true);
    setFailure(null);
    setProblem(undefined);
    try {
      let blockChanges: FileChange[] = [];
      const install = plan.installable.filter((block) => choices.install.has(block.name));
      if (install.length > 0) {
        try {
          const record = parseInstalledRecord(await readFile(INSTALLED_RECORD_FILE));
          blockChanges = (
            await planBlockChanges({
              changes: install.map((block) => ({ add: block.source })),
              // Only Goodfellow's own registry, whatever else the site trusts.
              registries: { [GOODFELLOW_REGISTRY]: registries[GOODFELLOW_REGISTRY] as string },
              fetchJson,
              readFile,
              record,
              blocks: Object.keys(blocks),
              content,
            })
          ).changes;
        } catch (error) {
          setProblem({ message: t("siteTransfer.error.blocks"), error });
          setPublishing(false);
          return;
        }
      }
      const media: FileChange[] = plan.media.flatMap((path) => {
        const bytes = loaded.files.get(path);
        return bytes ? [{ path, bytes }] : [];
      });
      for (const file of media) if ("bytes" in file) mediaPreviews.remember(mediaUrl(file.path), file.bytes);
      const title = plan.summary.title || loaded.name;
      const result = await publish(
        [...plan.changes, ...media, ...blockChanges],
        t("siteTransfer.import.message", { title }),
      );
      if (result.ok) {
        setDone(title);
        setLoaded(undefined);
        setPlan(undefined);
      } else {
        setFailure(result);
      }
    } finally {
      setPublishing(false);
    }
  };

  const toggle = (key: "menus" | "settings" | "layout" | "redirects" | "withoutMissingBlocks", label: StringKey) => (
    <label className="gfa-checkbox">
      <input
        type="checkbox"
        checked={choices[key]}
        disabled={publishing}
        onChange={(event) => setChoices({ ...choices, [key]: event.target.checked })}
      />
      {t(label)}
    </label>
  );
  const setTake = (keys: Iterable<string>) => setChoices({ ...choices, take: new Set(keys) });
  const leftOut = plan?.notes.some((note) => note.kind === "left-out" || note.kind === "without-blocks");
  const nothing =
    plan !== undefined && plan.changes.length === 0 && plan.media.length === 0 && choices.install.size === 0;

  return (
    <section aria-labelledby="gfa-site-import-title">
      <h2 id="gfa-site-import-title" className="gfa-section-title">
        {t("siteTransfer.import.title")}
      </h2>
      {done && (
        <>
          <p role="status" className="gfa-notice gfa-notice-success">
            {t("siteTransfer.import.done", { title: done })}
          </p>
          <p className="gfa-import-actions">
            <AppLink href="#/pages" className="gfa-button gfa-button-primary">
              {t("import.viewPages")}
            </AppLink>
          </p>
        </>
      )}
      {!loaded ? (
        <>
          <p>{t("siteTransfer.import.intro")}</p>
          {problem && <ErrorMessage message={problem.message} error={problem.error} />}
          <label className="gfa-field">
            <span className="gfa-label">{t("siteTransfer.import.file")}</span>
            <input
              type="file"
              className="gfa-input"
              accept=".zip,application/zip"
              disabled={reading}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (chosen) void choose(chosen);
              }}
            />
            <span className="gfa-hint">{t("siteTransfer.import.fileHint")}</span>
          </label>
          {reading && <p role="status">{t("siteTransfer.import.reading")}</p>}
        </>
      ) : (
        <>
          <p>{t("siteTransfer.import.ready", { title: plan?.summary.title || loaded.name })}</p>
          <fieldset className="gfa-fieldset">
            <legend>{t("siteTransfer.import.mode")}</legend>
            <label className="gfa-checkbox">
              <input
                type="radio"
                name="gfa-site-import-mode"
                checked={!choices.replace}
                disabled={publishing}
                onChange={() => setChoices({ ...choices, replace: false })}
              />
              {t("siteTransfer.import.mode.add")}
            </label>
            <label className="gfa-checkbox">
              <input
                type="radio"
                name="gfa-site-import-mode"
                checked={choices.replace}
                disabled={publishing}
                onChange={() => setChoices({ ...choices, replace: true })}
              />
              {t("siteTransfer.import.mode.replace")}
            </label>
          </fieldset>
          {choices.replace ? (
            <p className="gfa-notice gfa-notice-warning">{t("siteTransfer.import.replaceWarning")}</p>
          ) : (
            <fieldset className="gfa-fieldset">
              <legend>{t("siteTransfer.import.also")}</legend>
              {toggle("menus", "siteTransfer.import.menus")}
              {toggle("settings", "siteTransfer.import.settings")}
              {toggle("layout", "siteTransfer.import.layout")}
              {toggle("redirects", "siteTransfer.import.redirects")}
            </fieldset>
          )}
          {plan && mayInstall && plan.installable.length > 0 && (
            <fieldset className="gfa-fieldset">
              <legend>{t("siteTransfer.import.blocks")}</legend>
              {plan.installable.map((block) => (
                <label key={block.name} className="gfa-checkbox">
                  <input
                    type="checkbox"
                    checked={choices.install.has(block.name)}
                    disabled={publishing}
                    onChange={(event) => {
                      const install = new Set(choices.install);
                      if (event.target.checked) install.add(block.name);
                      else install.delete(block.name);
                      setChoices({ ...choices, install });
                    }}
                  />
                  {t("siteTransfer.import.install", { title: block.title })}
                </label>
              ))}
              <p className="gfa-hint">{t("siteTransfer.import.installHint")}</p>
            </fieldset>
          )}
          {leftOut && toggle("withoutMissingBlocks", "siteTransfer.import.withoutBlocks")}
          {plan && plan.conflicts.length > 0 && (
            <fieldset className="gfa-fieldset">
              <legend>{t("siteTransfer.import.conflicts")}</legend>
              <p className="gfa-hint">{t("siteTransfer.import.conflictsHint")}</p>
              <p className="gfa-import-actions">
                <Button onClick={() => setTake(plan.conflicts.map((conflict) => conflict.key))} disabled={publishing}>
                  {t("siteTransfer.import.useAllTheirs")}
                </Button>
                <Button onClick={() => setTake([])} disabled={publishing}>
                  {t("siteTransfer.import.useAllMine")}
                </Button>
              </p>
              {plan.conflicts.map((conflict) => (
                <label key={conflict.key} className="gfa-checkbox">
                  <input
                    type="checkbox"
                    checked={choices.take.has(conflict.key)}
                    disabled={publishing}
                    onChange={(event) => {
                      const take = new Set(choices.take);
                      if (event.target.checked) take.add(conflict.key);
                      else take.delete(conflict.key);
                      setTake(take);
                    }}
                  />
                  {t("siteTransfer.import.useTheirs", { what: conflictText(t, conflict) })}
                </label>
              ))}
            </fieldset>
          )}
          {plan && (
            <>
              {nothing ? (
                <p className="gfa-notice">{t("siteTransfer.summary.nothing")}</p>
              ) : (
                <ul className="gfa-import-summary">
                  <li>{t("siteTransfer.summary.pages", { count: String(plan.summary.pages) })}</li>
                  <li>{t("siteTransfer.summary.items", { count: String(plan.summary.items) })}</li>
                  {plan.summary.collections > 0 && (
                    <li>{t("siteTransfer.summary.collections", { count: String(plan.summary.collections) })}</li>
                  )}
                  {plan.summary.syncedBlocks > 0 && (
                    <li>{t("siteTransfer.summary.syncedBlocks", { count: String(plan.summary.syncedBlocks) })}</li>
                  )}
                  <li>{t("siteTransfer.summary.media", { count: String(plan.summary.media) })}</li>
                  {plan.summary.menus && <li>{t("siteTransfer.summary.menus")}</li>}
                  {plan.summary.settings && <li>{t("siteTransfer.summary.settings")}</li>}
                  {plan.summary.layout && <li>{t("siteTransfer.summary.layout")}</li>}
                  {plan.summary.redirects && <li>{t("siteTransfer.summary.redirects")}</li>}
                  {plan.summary.removed > 0 && (
                    <li>{t("siteTransfer.summary.removed", { count: String(plan.summary.removed) })}</li>
                  )}
                </ul>
              )}
              {plan.notes.length > 0 && (
                <>
                  <h3 className="gfa-section-title">{t("import.check")}</h3>
                  <ul className="gfa-import-notes">
                    {plan.notes.map((note) => (
                      <li key={JSON.stringify(note)}>{noteText(t, note, blockName)}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
          {problem && <ErrorMessage message={problem.message} error={problem.error} />}
          <PublishFailure failure={failure} />
          {publishing ? (
            <p role="status">{t("import.publishing")}</p>
          ) : (
            <p className="gfa-import-actions">
              <Button variant="primary" onClick={() => void importNow()} disabled={!plan || nothing}>
                {t("import.start")}
              </Button>
              <Button
                onClick={() => {
                  setLoaded(undefined);
                  setPlan(undefined);
                }}
              >
                {t("siteTransfer.import.another")}
              </Button>
            </p>
          )}
        </>
      )}
    </section>
  );
}
