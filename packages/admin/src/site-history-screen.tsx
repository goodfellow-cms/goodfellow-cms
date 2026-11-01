import {
  allPages,
  type ChangedFile,
  ContentError,
  describedConfig,
  describeSiteChanges,
  entryTitle,
  type FileVersion,
  loadSiteContent,
  type Page,
  type RevisionFiles,
  type SiteChange,
  type SiteContent,
  siteChangesSince,
  siteHistory,
  siteRestoreChanges,
} from "@goodfellow-cms/core";
import type { Config } from "@puckeditor/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { pageTitle } from "./changes.js";
import { mediaUrl } from "./media.js";
import { createMediaPreviews } from "./media-previews.js";
import { PreviewFrame } from "./preview.js";
import { type DownloadProgress, downloadName, downloadPaths, siteArchive } from "./site-download.js";
import { type StringKey, type Translate, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, Field } from "./ui.js";
import { unknownBlocks } from "./versions.js";
import { formatDate } from "./versions-screen.js";

const PER_PAGE = 20;

/**
 * The whole site's history: every publish that changed its content or media,
 * how the site looked after each, what has changed since, and restoring it as
 * it was, in one publish.
 */
export function SiteHistoryScreen() {
  const t = useStrings();
  const { versions, demo } = useAdmin();
  const { revision } = useSiteContent();
  const [restored, setRestored] = useState<string>();
  return (
    <div className="gfa-screen gfa-versions-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.tab.history")}</h1>
      </div>
      {restored && (
        <p className="gfa-notice gfa-notice-success" role="status">
          {t("siteHistory.restored", { date: restored })}
        </p>
      )}
      <DownloadCopy />
      {versions ? (
        // A publish moves to a new revision, which lists the restore too.
        <PublishList key={revision} onRestored={setRestored} />
      ) : (
        <p>{t(demo ? "siteHistory.demo" : "siteHistory.local")}</p>
      )}
    </div>
  );
}

/** Downloads the site's content and media as one zip file, at the revision the admin panel loaded. */
function DownloadCopy() {
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
      const paths = await downloadPaths(listFiles);
      const chunks = await siteArchive(paths, readBytes, setProgress);
      const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = downloadName(content.settings.title, new Date());
      document.body.append(link);
      link.click();
      link.remove();
      // Browsers start the download from the address before it's let go.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (caught) {
      setError(caught);
    } finally {
      setProgress(undefined);
    }
  };

  return (
    <section aria-labelledby="gfa-download-copy">
      <h2 className="gfa-section-title" id="gfa-download-copy">
        {t("siteHistory.download.title")}
      </h2>
      <p className="gfa-hint">{t("siteHistory.download.intro")}</p>
      {stored && <p className="gfa-hint">{t("siteHistory.download.stored")}</p>}
      <p>
        <Button onClick={() => void download()} disabled={progress !== undefined}>
          {t("siteHistory.download.button")}
        </Button>
      </p>
      {progress && progress.total > 0 && (
        <p role="status">
          {t("siteHistory.download.working", { done: String(progress.done), total: String(progress.total) })}
        </p>
      )}
      {error !== undefined && <ErrorMessage message={t("siteHistory.download.error")} error={error} />}
    </section>
  );
}

function PublishList({ onRestored }: { onRestored: (date: string) => void }) {
  const t = useStrings();
  const { versions } = useAdmin();
  const history = useMemo(() => (versions ? siteHistory(versions, PER_PAGE) : undefined), [versions]);
  const [list, setList] = useState<FileVersion[]>();
  const [more, setMore] = useState(false);
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState<string>();
  const [loading, setLoading] = useState(false);

  const load = useCallback(() => {
    if (!history) return;
    setLoading(true);
    history.more().then(
      (found) => {
        setList((previous) => [...(previous ?? []), ...found]);
        // The publish before the site as it is now, which has something to restore.
        setSelected((current) => current ?? found[1]?.revision ?? found[0]?.revision);
        setMore(!history.done);
        setLoading(false);
      },
      (caught) => {
        setError(caught);
        setLoading(false);
      },
    );
  }, [history]);
  useEffect(load, [load]);

  if (error) return <ErrorMessage message={t("siteHistory.error")} error={error} />;
  if (!list) return <p role="status">{t("versions.loading")}</p>;
  if (list.length === 0) return <p>{t("versions.empty")}</p>;
  const chosen = list.find((version) => version.revision === selected);

  return (
    <div className="gfa-versions-layout">
      <div>
        <p className="gfa-hint">{t("siteHistory.intro")}</p>
        <ol className="gfa-versions">
          {list.map((version, index) => (
            <li key={version.revision}>
              <button
                type="button"
                className="gfa-version"
                aria-pressed={version.revision === selected}
                onClick={() => setSelected(version.revision)}
              >
                <span className="gfa-version-message">{version.message}</span>
                <span className="gfa-hint">
                  {version.author
                    ? t("versions.by", { date: formatDate(version.date), author: version.author })
                    : formatDate(version.date)}
                  {index === 0 && ` · ${t("siteHistory.current")}`}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {more && (
          <Button variant="ghost" disabled={loading} onClick={load}>
            {t("versions.more")}
          </Button>
        )}
      </div>
      {chosen && <PublishDetail key={chosen.revision} version={chosen} onRestored={onRestored} />}
    </div>
  );
}

type Loaded =
  | { status: "loading" }
  | { status: "failed"; message: StringKey; error?: unknown }
  | {
      status: "ready";
      then: RevisionFiles;
      content: SiteContent;
      files: ChangedFile[];
      changes: SiteChange[];
      missing: string[];
    };

/** The names of blocks the site at an earlier publish uses that the site no longer has. */
function missingBlocks(content: SiteContent, configs: { page: Config; layout: Config; template: Config }): string[] {
  const missing = new Set<string>();
  for (const page of content.pages)
    for (const name of unknownBlocks(page.content.data, configs.page)) missing.add(name);
  for (const part of [content.header, content.footer]) {
    for (const name of unknownBlocks(part.data, configs.layout)) missing.add(name);
  }
  for (const collection of content.collections) {
    for (const name of unknownBlocks(collection.settings.template, configs.template)) missing.add(name);
  }
  return [...missing].sort();
}

/** A changed page, item or setting, in words. */
function changeLabel(t: Translate, change: SiteChange): string {
  const { subject } = change;
  switch (subject.kind) {
    case "page":
      return t("siteHistory.subject.page", { title: pageTitle(subject.page), path: subject.page.path });
    case "entry":
      return t("siteHistory.subject.entry", {
        title: entryTitle(subject.entry),
        collection: subject.collection.settings.name,
      });
    case "collection":
      return t("siteHistory.subject.collection", { name: subject.collection.settings.name });
    case "media":
      return subject.url.slice("/media/".length);
    case "file":
      return subject.path;
    case "header":
      return t("layout.header");
    case "footer":
      return t("layout.footer");
    default:
      return t(`siteHistory.subject.${subject.kind}`);
  }
}

const SINCE: Record<SiteChange["since"], StringKey> = {
  changed: "siteHistory.changed",
  added: "siteHistory.added",
  removed: "siteHistory.removed",
};

function PublishDetail({ version, onRestored }: { version: FileVersion; onRestored: (date: string) => void }) {
  const t = useStrings();
  const { site, versions, readFile, listFiles, changedPaths, publish, siteUrl, mediaPreviews } = useAdmin();
  const { content: now, revision } = useSiteContent();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [shown, setShown] = useState("/");
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [failure, setFailure] = useState<{ reason: "conflict" | "error" | "checks"; error: unknown }>();
  const date = formatDate(version.date);
  const configs = useMemo(
    () => ({
      page: describedConfig(site.description, "page"),
      layout: describedConfig(site.description, "layout"),
      template: describedConfig(site.description, "template"),
    }),
    [site.description],
  );

  useEffect(() => {
    if (!versions) return;
    let cancelled = false;
    (async (): Promise<Loaded> => {
      const then = versions.filesAt(version.revision);
      let content: SiteContent;
      try {
        content = await loadSiteContent(then);
      } catch (error) {
        if (!(error instanceof ContentError)) return { status: "failed", message: "siteHistory.readError", error };
        const details = new Error(error.problems.map((problem) => `${problem.file}: ${problem.message}`).join("\n"));
        return { status: "failed", message: "siteHistory.unfit", error: details };
      }
      const changed = changedPaths ? await changedPaths(version.revision, revision) : [];
      const files = await siteChangesSince(then, { read: readFile, list: listFiles }, changed);
      return {
        status: "ready",
        then,
        content,
        files,
        changes: describeSiteChanges(content, now, files),
        missing: missingBlocks(content, configs),
      };
    })().then(
      (next) => !cancelled && setLoaded(next),
      (error) => !cancelled && setLoaded({ status: "failed", message: "siteHistory.readError", error }),
    );
    return () => {
      cancelled = true;
    };
  }, [versions, version.revision, revision, changedPaths, readFile, listFiles, now, configs]);

  const pages = useMemo(() => (loaded.status === "ready" ? allPages(loaded.content) : []), [loaded]);
  const page: Page | undefined = pages.find((candidate) => candidate.path === shown) ?? pages[0];

  // The chosen page as builds showed it then.
  const show = useMemo(
    () =>
      loaded.status === "ready" && page && loaded.missing.length === 0
        ? { content: loaded.content, path: page.path }
        : undefined,
    [loaded, page],
  );

  const media = useMemo(
    () =>
      loaded.status === "ready"
        ? createMediaPreviews(loaded.then, siteUrl, () => loaded.content.mediaStorage)
        : undefined,
    [loaded, siteUrl],
  );

  const restore = useCallback(async () => {
    if (loaded.status !== "ready") return;
    setRestoring(true);
    setFailure(undefined);
    let changes: Awaited<ReturnType<typeof siteRestoreChanges>>;
    try {
      changes = await siteRestoreChanges(loaded.then, loaded.files);
    } catch (error) {
      setRestoring(false);
      setConfirming(false);
      setFailure({ reason: "error", error });
      return;
    }
    // Shown from memory until the live site has them again.
    for (const change of changes) if ("bytes" in change) mediaPreviews.remember(mediaUrl(change.path), change.bytes);
    const result = await publish(changes, t("siteHistory.restoreMessage", { date }));
    setRestoring(false);
    setConfirming(false);
    if (result.ok) onRestored(date);
    else setFailure(result);
  }, [loaded, publish, t, date, onRestored, mediaPreviews]);

  return (
    <section className="gfa-version-detail" aria-label={t("siteHistory.preview", { date })}>
      <h2 className="gfa-section-title">{t("siteHistory.preview", { date })}</h2>
      {loaded.status === "loading" && <p role="status">{t("siteHistory.loadingVersion")}</p>}
      {loaded.status === "failed" && <ErrorMessage message={t(loaded.message)} error={loaded.error} />}
      {loaded.status === "ready" && (
        <>
          {loaded.missing.length > 0 && (
            <ErrorMessage message={t("siteHistory.unknownBlocks", { blocks: loaded.missing.join(", ") })} />
          )}
          {loaded.changes.length === 0 ? (
            <p className="gfa-hint">{t("siteHistory.same")}</p>
          ) : (
            <>
              <ChangesSince changes={loaded.changes} />
              {loaded.missing.length === 0 && (
                <div>
                  <Button variant="primary" onClick={() => setConfirming(true)}>
                    {t("siteHistory.restore")}
                  </Button>
                </div>
              )}
            </>
          )}
          {failure && failure.reason !== "checks" && (
            <ErrorMessage
              message={t(failure.reason === "conflict" ? "publish.conflict" : "publish.error")}
              error={failure.error}
            />
          )}
          {pages.length > 0 && (
            <Field label={t("siteHistory.page")}>
              {(props) => (
                <select
                  {...props}
                  className="gfa-input"
                  value={page?.path ?? ""}
                  onChange={(event) => setShown(event.target.value)}
                >
                  {pages.map((candidate) => (
                    <option key={candidate.path} value={candidate.path}>
                      {pageTitle(candidate)} ({candidate.path})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {show ? (
            <div className="gfa-version-preview">
              <PreviewFrame title={t("siteHistory.preview", { date })} show={show} {...(media && { media })} />
            </div>
          ) : (
            loaded.missing.length === 0 && page && <p role="status">{t("siteHistory.loadingVersion")}</p>
          )}
        </>
      )}
      {confirming && loaded.status === "ready" && (
        <Dialog title={t("siteHistory.restoreTitle", { date })} onClose={() => setConfirming(false)}>
          <p>{t("siteHistory.restoreBody", { count: String(loaded.changes.length) })}</p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setConfirming(false)}>{t("action.cancel")}</Button>
            <Button variant="primary" disabled={restoring} onClick={() => void restore()}>
              {restoring ? t("versions.restoring") : t("siteHistory.restore")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/** What has changed since, grouped by how: changed, added (which restoring removes) and removed (which it brings back). */
function ChangesSince({ changes }: { changes: SiteChange[] }) {
  const t = useStrings();
  return (
    <div className="gfa-site-changes">
      <h3 className="gfa-section-title">{t("siteHistory.since")}</h3>
      {(["changed", "added", "removed"] as const).map((since) => {
        const listed = changes.filter((change) => change.since === since);
        if (listed.length === 0) return null;
        return (
          <div key={since}>
            <p className="gfa-label">{t(SINCE[since])}</p>
            <ul className="gfa-import-notes">
              {listed.map((change) => {
                const label = changeLabel(t, change);
                return <li key={`${change.subject.kind}:${label}`}>{label}</li>;
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
