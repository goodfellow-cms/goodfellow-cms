import type { MarkdownExport, MarkdownExportNote } from "@goodfellow-cms/core/wordpress";
import { useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { type DownloadProgress, siteArchive } from "./site-download.js";
import { type Translate, useStrings } from "./strings.js";
import { Button, ErrorMessage } from "./ui.js";

/** What a Markdown export couldn't bring across as it was, in words. */
function noteText(t: Translate, note: MarkdownExportNote, blockName: (name: string) => string): string {
  const listed = (items: string[]) => {
    const shown = items.slice(0, 3).join(", ");
    return items.length > 3 ? t("import.note.more", { items: shown, count: String(items.length - 3) }) : shown;
  };
  switch (note.kind) {
    case "left-out-block":
      return t("markdownExport.note.leftOutBlock", { name: blockName(note.name), items: listed(note.items) });
    case "scheduled":
      return t(note.included ? "markdownExport.note.scheduledIncluded" : "markdownExport.note.scheduledLeftOut", {
        items: listed(note.items),
      });
    case "no-pages":
      return t("markdownExport.note.noPages", { collections: listed(note.collections) });
    case "templates":
      return t("markdownExport.note.templates", { collections: listed(note.collections) });
    case "redirects":
      return t("markdownExport.note.redirects", { count: String(note.count) });
    case "layout":
      return t("markdownExport.note.layout");
  }
}

/**
 * Writes the site as a folder of Markdown files (`markdownExport()`), zipped
 * in the browser with the media library, for other static sites, notes apps
 * and AI tools, on Site Settings' Import tab beside the WordPress export.
 */
export function MarkdownExportSection() {
  const t = useStrings();
  const { blocks, readBytes } = useAdmin();
  const { content, media } = useSiteContent();
  const [scheduled, setScheduled] = useState(false);
  const [links, setLinks] = useState<"site" | "files">("site");
  const [result, setResult] = useState<MarkdownExport>();
  const [progress, setProgress] = useState<DownloadProgress>();
  const [problem, setProblem] = useState<unknown>();
  const busy = progress !== undefined;
  const blockName = (name: string) => blocks[name]?.label ?? name;
  const stored = Object.keys(content.mediaStorage?.files ?? {}).length > 0;

  const exportSite = async () => {
    setProblem(undefined);
    setResult(undefined);
    setProgress({ done: 0, total: 0 });
    try {
      const { markdownExport, markdownExportName } = await import("@goodfellow-cms/core/wordpress");
      const written = markdownExport(content, { mediaFiles: media, scheduled, links });
      const folder = markdownExportName(content);
      // Everything in one folder named after the site, so unpacking it makes one folder.
      const texts = new Map(written.files.map((file) => [`${folder}/${file.path}`, file.content]));
      const copies = new Map(written.media.map((file) => [`${folder}/${file.path}`, file.from]));
      const encoder = new TextEncoder();
      const chunks = await siteArchive(
        [...texts.keys(), ...copies.keys()],
        async (path) => {
          const text = texts.get(path);
          if (text !== undefined) return encoder.encode(text);
          const from = copies.get(path);
          return from ? readBytes(from) : undefined;
        },
        setProgress,
      );
      const url = URL.createObjectURL(new Blob(chunks as BlobPart[], { type: "application/zip" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `${folder}.zip`;
      document.body.append(link);
      link.click();
      link.remove();
      // Browsers start the download from the address before it's let go.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setResult(written);
    } catch (error) {
      setProblem(error ?? new Error("Export failed"));
    } finally {
      setProgress(undefined);
    }
  };

  return (
    <section aria-labelledby="gfa-markdown-export-title">
      <h2 id="gfa-markdown-export-title" className="gfa-section-title">
        {t("markdownExport.title")}
      </h2>
      <p>{t("markdownExport.intro")}</p>
      <p className="gfa-hint">{t("markdownExport.limits")}</p>
      {stored && <p className="gfa-hint">{t("markdownExport.stored")}</p>}
      <fieldset className="gfa-fieldset">
        <legend>{t("markdownExport.links")}</legend>
        <label className="gfa-checkbox">
          <input
            type="radio"
            name="gfa-markdown-links"
            checked={links === "site"}
            disabled={busy}
            onChange={() => setLinks("site")}
          />
          {t("markdownExport.links.site")}
        </label>
        <label className="gfa-checkbox">
          <input
            type="radio"
            name="gfa-markdown-links"
            checked={links === "files"}
            disabled={busy}
            onChange={() => setLinks("files")}
          />
          {t("markdownExport.links.files")}
        </label>
      </fieldset>
      <label className="gfa-checkbox">
        <input
          type="checkbox"
          checked={scheduled}
          disabled={busy}
          onChange={(event) => setScheduled(event.target.checked)}
        />
        {t("markdownExport.scheduled")}
      </label>
      {problem !== undefined && <ErrorMessage message={t("markdownExport.error")} error={problem} />}
      <p className="gfa-import-actions">
        <Button onClick={() => void exportSite()} disabled={busy}>
          {t("markdownExport.download")}
        </Button>
      </p>
      {progress && progress.total > 0 && (
        <p role="status">
          {t("markdownExport.working", { done: String(progress.done), total: String(progress.total) })}
        </p>
      )}
      {result && (
        <>
          <p role="status" className="gfa-notice gfa-notice-success">
            {t("markdownExport.done")}
          </p>
          <ul className="gfa-import-summary">
            <li>{t("export.summary.pages", { count: String(result.summary.pages) })}</li>
            <li>{t("markdownExport.summary.items", { count: String(result.summary.items) })}</li>
            <li>{t("import.summary.menus", { count: String(result.summary.menus) })}</li>
            <li>{t("markdownExport.summary.media", { count: String(result.summary.media) })}</li>
          </ul>
          {result.notes.length > 0 && (
            <>
              <h3 className="gfa-section-title">{t("import.check")}</h3>
              <ul className="gfa-import-notes">
                {result.notes.map((note) => (
                  <li key={JSON.stringify(note)}>{noteText(t, note, blockName)}</li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
