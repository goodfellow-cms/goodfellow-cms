import { ContentError, describedConfig, type FileVersion, type SiteContent } from "@goodfellow-cms/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import type { RenderShow } from "./frame/protocol.js";
import { PreviewFrame } from "./preview.js";
import { entryEditorHref, pageEditorHref } from "./router.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage } from "./ui.js";
import { AppLink } from "./use-link.js";
import {
  contentWithVersion,
  previewPage,
  restoreChange,
  subjectData,
  subjectTitle,
  unknownBlocks,
  type VersionSubject,
  versionSubject,
} from "./versions.js";

const PER_PAGE = 20;

/** The Version history screen for one content file, such as `content/pages/about.json`. */
export function versionsHref(file: string): string {
  return `#/versions?file=${encodeURIComponent(file)}`;
}

/** Where a subject is edited. */
function editorHref(subject: VersionSubject): string {
  if (subject.kind === "page") return pageEditorHref(subject.page.path);
  if (subject.kind === "entry") return entryEditorHref(subject.collection.id, subject.entry.slug);
  return `#/layout/${subject.kind}`;
}

export function formatDate(date: string): string {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime())
    ? date
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
}

/** A link to a file's Version history, for editors' headers. */
export function VersionsLink({ file }: { file: string }) {
  const t = useStrings();
  const { versions } = useAdmin();
  if (!versions) return null;
  return (
    <AppLink href={versionsHref(file)} className="gfa-button gfa-button-ghost">
      {t("versions.button")}
    </AppLink>
  );
}

/** Every published version of a page, the header or footer, or an item, with a preview of each and a way to restore it. */
export function VersionsScreen({ file }: { file: string }) {
  const t = useStrings();
  const { versions, demo } = useAdmin();
  const { content, revision } = useSiteContent();
  const [restored, setRestored] = useState<string>();
  const subject = versionSubject(content, file);

  if (!subject) {
    return (
      <div className="gfa-screen">
        <p>{t("versions.notFound")}</p>
        <AppLink href="#/pages">{t("editPage.backToPages")}</AppLink>
      </div>
    );
  }
  const title = subjectTitle(subject) ?? t(subject.kind === "header" ? "layout.header" : "layout.footer");

  return (
    <div className="gfa-screen gfa-versions-screen">
      <div className="gfa-screen-header">
        <h1>{t("versions.title", { title })}</h1>
        <AppLink href={editorHref(subject)}>{t("versions.back")}</AppLink>
      </div>
      {restored && (
        <p className="gfa-notice gfa-notice-success" role="status">
          {t("versions.restored", { date: restored })}
        </p>
      )}
      {versions ? (
        // A publish moves to a new revision, which lists the restored version too.
        <VersionList key={revision} subject={subject} title={title} onRestored={setRestored} />
      ) : (
        <p>{t(demo ? "versions.demo" : "versions.local")}</p>
      )}
    </div>
  );
}

function VersionList({
  subject,
  title,
  onRestored,
}: {
  subject: VersionSubject;
  title: string;
  onRestored: (date: string) => void;
}) {
  const t = useStrings();
  const { versions } = useAdmin();
  const [list, setList] = useState<FileVersion[]>();
  const [more, setMore] = useState(false);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<unknown>();
  const [selected, setSelected] = useState<string>();

  useEffect(() => {
    if (!versions) return;
    let cancelled = false;
    versions.history(subject.file, { page, perPage: PER_PAGE }).then(
      (found) => {
        if (cancelled) return;
        setList((previous) => [...(page === 1 ? [] : (previous ?? [])), ...found]);
        setMore(found.length === PER_PAGE);
        if (page === 1) setSelected(found[0]?.revision);
      },
      (caught) => !cancelled && setError(caught),
    );
    return () => {
      cancelled = true;
    };
  }, [versions, subject.file, page]);

  if (error) return <ErrorMessage message={t("versions.error")} error={error} />;
  if (!list) return <p role="status">{t("versions.loading")}</p>;
  if (list.length === 0) return <p>{t("versions.empty")}</p>;
  const chosen = list.find((version) => version.revision === selected);

  return (
    <div className="gfa-versions-layout">
      <div>
        <p className="gfa-hint">{t("versions.intro")}</p>
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
                  {index === 0 && ` · ${t("versions.current")}`}
                </span>
              </button>
            </li>
          ))}
        </ol>
        {more && (
          <Button variant="ghost" onClick={() => setPage((current) => current + 1)}>
            {t("versions.more")}
          </Button>
        )}
      </div>
      {chosen && (
        <VersionDetail
          key={chosen.revision}
          subject={subject}
          title={title}
          version={chosen}
          current={chosen.revision === list[0]?.revision}
          onRestored={onRestored}
        />
      )}
    </div>
  );
}

type Loaded =
  | { status: "loading" }
  | { status: "failed"; message: StringKey; error?: unknown }
  | { status: "ready"; content: SiteContent; subject: VersionSubject; show?: RenderShow; missing: string[] };

function VersionDetail({
  subject,
  title,
  version,
  current,
  onRestored,
}: {
  subject: VersionSubject;
  title: string;
  version: FileVersion;
  current: boolean;
  onRestored: (date: string) => void;
}) {
  const t = useStrings();
  const { site, versions, readFile, listFiles, publish } = useAdmin();
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });
  const [confirming, setConfirming] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [failure, setFailure] = useState<{ reason: "conflict" | "error" | "checks"; error: unknown }>();
  const date = formatDate(version.date);
  const configs = useMemo(
    () => ({ page: describedConfig(site.description, "page"), layout: describedConfig(site.description, "layout") }),
    [site.description],
  );

  useEffect(() => {
    if (!versions) return;
    let cancelled = false;
    (async (): Promise<Loaded> => {
      let text: string | undefined;
      try {
        text = await versions.readAt(subject.file, version.revision);
      } catch (error) {
        return { status: "failed", message: "versions.readError", error };
      }
      if (text === undefined) return { status: "failed", message: "versions.readError" };
      let content: SiteContent;
      try {
        content = await contentWithVersion({ read: readFile, list: listFiles }, subject.file, text);
      } catch (error) {
        if (!(error instanceof ContentError)) throw error;
        const details = new Error(error.problems.map((problem) => `${problem.file}: ${problem.message}`).join("\n"));
        return { status: "failed", message: "versions.unfit", error: details };
      }
      const then = versionSubject(content, subject.file);
      if (!then) return { status: "failed", message: "versions.unfit" };
      const data = subjectData(content, then);
      const missing = data ? unknownBlocks(data, then.kind === "page" ? configs.page : configs.layout) : [];
      const page = previewPage(content, then);
      const show = page && missing.length === 0 ? { content, path: page.path } : undefined;
      return { status: "ready", content, subject: then, ...(show && { show }), missing };
    })().then(
      (next) => !cancelled && setLoaded(next),
      (error) => !cancelled && setLoaded({ status: "failed", message: "versions.readError", error }),
    );
    return () => {
      cancelled = true;
    };
  }, [versions, subject.file, version.revision, readFile, listFiles, configs]);

  const restore = useCallback(async () => {
    if (loaded.status !== "ready") return;
    setRestoring(true);
    setFailure(undefined);
    const result = await publish(
      [restoreChange(loaded.content, loaded.subject)],
      t("versions.restoreMessage", { title, date }),
    );
    setRestoring(false);
    setConfirming(false);
    if (result.ok) onRestored(date);
    else setFailure(result);
  }, [loaded, publish, t, title, date, onRestored]);

  return (
    <section className="gfa-version-detail" aria-label={t("versions.preview", { date })}>
      <h2 className="gfa-section-title">{t("versions.preview", { date })}</h2>
      {loaded.status === "loading" && <p role="status">{t("versions.loadingVersion")}</p>}
      {loaded.status === "failed" && <ErrorMessage message={t(loaded.message)} error={loaded.error} />}
      {loaded.status === "ready" && (
        <>
          {loaded.missing.length > 0 && (
            <ErrorMessage message={t("versions.unknownBlocks", { blocks: loaded.missing.join(", ") })} />
          )}
          {!current && loaded.missing.length === 0 && (
            <div>
              <Button variant="primary" onClick={() => setConfirming(true)}>
                {t("versions.restore")}
              </Button>
            </div>
          )}
          {failure && failure.reason !== "checks" && (
            <ErrorMessage
              message={t(failure.reason === "conflict" ? "publish.conflict" : "publish.error")}
              error={failure.error}
            />
          )}
          {loaded.show ? (
            <div className="gfa-version-preview">
              <PreviewFrame title={t("versions.preview", { date })} show={loaded.show} />
            </div>
          ) : (
            loaded.missing.length === 0 && <p className="gfa-hint">{t("versions.noPreview")}</p>
          )}
        </>
      )}
      {confirming && (
        <Dialog title={t("versions.restoreTitle", { date })} onClose={() => setConfirming(false)}>
          <p>{t("versions.restoreBody", { title })}</p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setConfirming(false)}>{t("action.cancel")}</Button>
            <Button variant="primary" disabled={restoring} onClick={() => void restore()}>
              {restoring ? t("versions.restoring") : t("versions.restore")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
