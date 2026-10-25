import type { FileChange } from "@goodfellow-cms/core";
import type {
  WordPressExport,
  WordPressExportNote,
  WordPressImport,
  WordPressImportNames,
  WordPressImportNote,
  WordPressSite,
} from "@goodfellow-cms/core/wordpress";
import { useRef, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { fileName, mediaUrl } from "./media.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { type StringKey, type Translate, useStrings } from "./strings.js";
import { Button, ErrorMessage, Field } from "./ui.js";
import { prepareUpload } from "./upload.js";
import { AppLink } from "./use-link.js";

type WordPressModule = typeof import("@goodfellow-cms/core/wordpress");

/** How many media files are downloaded at once. */
const DOWNLOADS = 4;

type Stage =
  | { kind: "choose" }
  | { kind: "reading" }
  | { kind: "ready"; site: WordPressSite; plan: WordPressImport }
  | { kind: "copying"; site: WordPressSite; done: number; total: number }
  | { kind: "publishing"; site: WordPressSite }
  | { kind: "done"; site: WordPressSite; plan: WordPressImport };

const CONVERTED: Record<string, StringKey> = {
  block: "import.note.block",
  dropped: "import.note.dropped",
  shortcode: "import.note.shortcode",
  embed: "import.note.embed",
  form: "import.note.form",
  script: "import.note.script",
  table: "import.note.table",
  posts: "import.note.posts",
  video: "import.note.video",
};

const LEFT_OUT: Record<string, StringKey> = {
  drafts: "import.note.leftOut.drafts",
  private: "import.note.leftOut.private",
  trash: "import.note.leftOut.trash",
  comments: "import.note.leftOut.comments",
};

/** What the import couldn't bring across as it was, in words. */
function noteText(t: Translate, note: WordPressImportNote): string {
  switch (note.kind) {
    case "left-out":
      return t(LEFT_OUT[note.what] ?? "import.note.leftOut.other", { count: String(note.count), name: note.what });
    case "converted": {
      const shown = note.items.slice(0, 3).join(", ");
      const items =
        note.items.length > 3 ? t("import.note.more", { items: shown, count: String(note.items.length - 3) }) : shown;
      return t(CONVERTED[note.note] ?? "import.note.block", { name: note.name, items });
    }
    case "old-links":
      return t("import.note.oldLinks", { count: String(note.urls.length), url: note.urls[0] ?? "" });
    case "not-copied":
      return t("import.note.notCopied", { count: String(note.urls.length), url: note.urls[0] ?? "" });
    case "unused-media":
      return t("import.note.unusedMedia", { count: String(note.count) });
    case "no-menus":
      return t("import.note.noMenus");
  }
}

/** What an export couldn't bring across as it was, in words. */
function exportNoteText(t: Translate, note: WordPressExportNote, blockName: (name: string) => string): string {
  const listed = (items: string[]) => {
    const shown = items.slice(0, 3).join(", ");
    return items.length > 3 ? t("import.note.more", { items: shown, count: String(items.length - 3) }) : shown;
  };
  switch (note.kind) {
    case "left-out-block":
      return t("export.note.leftOutBlock", { name: blockName(note.name), items: listed(note.items) });
    case "no-pages":
      return t("export.note.noPages", { collections: listed(note.collections) });
    case "hidden":
      return t("export.note.hidden", { items: listed(note.items) });
    case "redirects":
      return t("export.note.redirects", { count: String(note.count) });
    case "no-address":
      return t("export.note.noAddress");
    case "layout":
      return t("export.note.layout");
  }
}

/** Saves text as a file on the editor's computer. */
function download(text: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/xml" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Writes the site as a WordPress export file, downloaded to the editor's computer. */
function ExportSection() {
  const t = useStrings();
  const { blocks } = useAdmin();
  const { content, media } = useSiteContent();
  const [result, setResult] = useState<WordPressExport>();
  const [problem, setProblem] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const blockName = (name: string) => blocks[name]?.label ?? name;

  const exportSite = async () => {
    setBusy(true);
    setProblem(undefined);
    try {
      const wordpress = await import("@goodfellow-cms/core/wordpress");
      const written = wordpress.wordPressExport(content, { mediaFiles: media });
      download(written.xml, wordpress.wordPressExportName(content));
      setResult(written);
    } catch (error) {
      setProblem(error ?? new Error("Export failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="gfa-export-title">
      <h2 id="gfa-export-title" className="gfa-section-title">
        {t("export.title")}
      </h2>
      <p>{t("export.intro")}</p>
      {problem !== undefined && <ErrorMessage message={t("export.error")} error={problem} />}
      <p className="gfa-import-actions">
        <Button onClick={() => void exportSite()} disabled={busy}>
          {t("export.download")}
        </Button>
      </p>
      {result && (
        <>
          <p role="status" className="gfa-notice gfa-notice-success">
            {t("export.done")}
          </p>
          <ul className="gfa-import-summary">
            <li>{t("export.summary.pages", { count: String(result.summary.pages) })}</li>
            <li>{t("export.summary.posts", { count: String(result.summary.posts) })}</li>
            {(result.summary.categories > 0 || result.summary.tags > 0) && (
              <li>
                {t("import.summary.terms", {
                  categories: String(result.summary.categories),
                  tags: String(result.summary.tags),
                })}
              </li>
            )}
            <li>{t("import.summary.menus", { count: String(result.summary.menus) })}</li>
            <li>{t("export.summary.media", { count: String(result.summary.media) })}</li>
          </ul>
          {result.notes.length > 0 && (
            <>
              <h3 className="gfa-section-title">{t("import.check")}</h3>
              <ul className="gfa-import-notes">
                {result.notes.map((note) => (
                  <li key={JSON.stringify(note)}>{exportNoteText(t, note, blockName)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}

function Summary({ plan }: { plan: WordPressImport }) {
  const t = useStrings();
  const { summary } = plan;
  return (
    <ul className="gfa-import-summary">
      <li>{t("import.summary.pages", { count: String(summary.pages.length) })}</li>
      {summary.collection && (
        <li>
          {t("import.summary.posts", {
            count: String(summary.posts),
            path: summary.collection.path,
            list: summary.listPath ?? "",
          })}
        </li>
      )}
      {(summary.categories > 0 || summary.tags > 0) && (
        <li>{t("import.summary.terms", { categories: String(summary.categories), tags: String(summary.tags) })}</li>
      )}
      {summary.menus.length > 0 && <li>{t("import.summary.menus", { count: String(summary.menus.length) })}</li>}
      {summary.redirects > 0 && <li>{t("import.summary.redirects", { count: String(summary.redirects) })}</li>}
      <li>{t("import.summary.media", { count: String(plan.media.length) })}</li>
    </ul>
  );
}

function Notes({ plan }: { plan: WordPressImport }) {
  const t = useStrings();
  if (plan.notes.length === 0) return null;
  return (
    <>
      <h2 className="gfa-section-title">{t("import.check")}</h2>
      <ul className="gfa-import-notes">
        {plan.notes.map((note) => (
          <li key={JSON.stringify(note)}>{noteText(t, note)}</li>
        ))}
      </ul>
    </>
  );
}

/** Downloads a media file and gets it ready as uploads are, or `undefined` where the WordPress site doesn't allow it. */
async function copyMedia(url: string, path: string): Promise<Uint8Array | undefined> {
  try {
    const response = await window.fetch(url);
    if (!response.ok) return undefined;
    const file = new File([await response.blob()], fileName(path));
    return (await prepareUpload(file)).bytes;
  } catch {
    return undefined;
  }
}

/**
 * Brings a WordPress site into this one: from its export file or its address,
 * with what will come across shown first, then published in one go. Media is
 * copied where the WordPress site lets browsers download it.
 */
export function ImportScreen() {
  const t = useStrings();
  const { blocks, publish, mediaPreviews } = useAdmin();
  const { content, media } = useSiteContent();
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [address, setAddress] = useState("");
  const [problem, setProblem] = useState<{ message: string; error?: unknown }>();
  const [failure, setFailure] = useState<Failure>(null);
  const module = useRef<WordPressModule>(undefined);
  const fileInput = useRef<HTMLInputElement>(null);

  const names: WordPressImportNames = {
    posts: t("import.names.posts"),
    post: t("import.names.post"),
    title: t("import.names.title"),
    date: t("import.names.date"),
    summary: t("import.names.summary"),
    image: t("import.names.image"),
    categories: t("import.names.categories"),
    tags: t("import.names.tags"),
    text: t("import.names.text"),
    allPosts: t("import.names.allPosts"),
  };
  const load = async () => {
    module.current ??= await import("@goodfellow-cms/core/wordpress");
    return module.current;
  };
  const plan = (wordpress: WordPressModule, site: WordPressSite, copied?: ReadonlySet<string>) =>
    wordpress.planWordPressImport(site, content, {
      mediaFiles: media,
      blocks: Object.keys(blocks),
      names,
      ...(copied && { copied }),
    });

  const describe = (wordpress: WordPressModule | undefined, error: unknown, from: string) => {
    if (wordpress && error instanceof wordpress.WordPressReadError) {
      const key: StringKey =
        error.problem === "not-export-file"
          ? "import.error.notExportFile"
          : error.problem === "not-wordpress"
            ? "import.error.notWordPress"
            : "import.error.unreachable";
      return { message: t(key, { address: from }), error };
    }
    if (wordpress && error instanceof wordpress.WordPressImportError) {
      return { message: t("import.error.blocks", { blocks: error.missingBlocks.join(", ") }), error };
    }
    return { message: t("import.error.other"), error };
  };

  const read = async (from: string, source: (wordpress: WordPressModule) => Promise<WordPressSite>) => {
    setProblem(undefined);
    setFailure(null);
    setStage({ kind: "reading" });
    let wordpress: WordPressModule | undefined;
    try {
      wordpress = await load();
      const site = await source(wordpress);
      setStage({ kind: "ready", site, plan: plan(wordpress, site) });
    } catch (error) {
      setProblem(describe(wordpress, error, from));
      setStage({ kind: "choose" });
    }
  };

  const readFile = (file: File) =>
    read(file.name, async (wordpress) => wordpress.readWordPressExport(await file.text()));
  const readAddress = () =>
    read(address, (wordpress) =>
      wordpress.fetchWordPressSite(address, { fetch: (url, init) => window.fetch(url, init) }),
    );

  const importSite = async (site: WordPressSite, first: WordPressImport) => {
    const wordpress = await load();
    const queue = [...first.media];
    const copied = new Map<string, Uint8Array>();
    let done = 0;
    setStage({ kind: "copying", site, done, total: queue.length });
    await Promise.all(
      Array.from({ length: DOWNLOADS }, async () => {
        for (let copy = queue.shift(); copy; copy = queue.shift()) {
          const bytes = await copyMedia(copy.url, copy.path);
          if (bytes) copied.set(copy.url, bytes);
          done += 1;
          setStage({ kind: "copying", site, done, total: first.media.length });
        }
      }),
    );

    const final = plan(wordpress, site, new Set(copied.keys()));
    const files: FileChange[] = final.media.flatMap((copy) => {
      const bytes = copied.get(copy.url);
      return bytes ? [{ path: copy.path, bytes }] : [];
    });
    // Shown from memory until the live site has them.
    for (const file of files) if ("bytes" in file) mediaPreviews.remember(mediaUrl(file.path), file.bytes);
    setStage({ kind: "publishing", site });
    const result = await publish([...final.changes, ...files], t("import.message", { title: site.title || site.url }));
    if (result.ok) {
      setStage({ kind: "done", site, plan: final });
    } else {
      setFailure(result);
      setStage({ kind: "ready", site, plan: first });
    }
  };

  const busy = stage.kind === "reading" || stage.kind === "copying" || stage.kind === "publishing";

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.tab.import")}</h1>
      </div>
      <div className="gfa-form">
        {stage.kind === "choose" || stage.kind === "reading" ? (
          <>
            <h2 className="gfa-section-title">{t("import.title")}</h2>
            <p>{t("import.intro")}</p>
            {problem && <ErrorMessage message={problem.message} error={problem.error} />}
            <Field label={t("import.file")} hint={t("import.fileHint")}>
              {(props) => (
                <input
                  {...props}
                  ref={fileInput}
                  type="file"
                  accept=".xml,text/xml,application/xml"
                  className="gfa-input"
                  disabled={busy}
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (file) void readFile(file);
                    event.target.value = "";
                  }}
                />
              )}
            </Field>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                if (address.trim()) void readAddress();
              }}
            >
              <Field label={t("import.address")} hint={t("import.addressHint")}>
                {(props) => (
                  <div className="gfa-import-address">
                    <input
                      {...props}
                      className="gfa-input"
                      value={address}
                      onChange={(event) => setAddress(event.target.value)}
                      placeholder="example.org"
                      disabled={busy}
                    />
                    <Button type="submit" disabled={busy || !address.trim()}>
                      {t("import.read")}
                    </Button>
                  </div>
                )}
              </Field>
            </form>
            {stage.kind === "reading" && <p role="status">{t("import.reading")}</p>}
            <ExportSection />
          </>
        ) : stage.kind === "done" ? (
          <>
            <p role="status" className="gfa-notice gfa-notice-success">
              {t("import.done", { title: stage.site.title || stage.site.url })}
            </p>
            <Notes plan={stage.plan} />
            <p className="gfa-import-actions">
              <AppLink href="#/pages" className="gfa-button gfa-button-primary">
                {t("import.viewPages")}
              </AppLink>
            </p>
          </>
        ) : (
          <>
            <h2 className="gfa-section-title">{t("import.ready", { title: stage.site.title || stage.site.url })}</h2>
            {stage.kind === "ready" && (
              <>
                <Summary plan={stage.plan} />
                {stage.plan.summary.replaced.length > 0 && (
                  <p className="gfa-notice gfa-notice-warning">
                    {t("import.replaces", { pages: stage.plan.summary.replaced.join(", ") })}
                  </p>
                )}
                <Notes plan={stage.plan} />
                <PublishFailure failure={failure} />
                <p className="gfa-import-actions">
                  <Button variant="primary" onClick={() => void importSite(stage.site, stage.plan)}>
                    {t("import.start")}
                  </Button>
                  <Button onClick={() => setStage({ kind: "choose" })}>{t("import.another")}</Button>
                </p>
              </>
            )}
            {stage.kind === "copying" && (
              <p role="status">{t("import.copying", { done: String(stage.done), total: String(stage.total) })}</p>
            )}
            {stage.kind === "publishing" && <p role="status">{t("import.publishing")}</p>}
          </>
        )}
      </div>
    </div>
  );
}
