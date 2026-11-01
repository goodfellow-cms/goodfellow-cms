import type { FileChange } from "@goodfellow-cms/core";
import type {
  MarkdownFolder,
  MarkdownFolderUse,
  MarkdownImport,
  MarkdownImportNames,
  MarkdownImportNote,
  MarkdownImportOptions,
} from "@goodfellow-cms/core/wordpress";
import { useRef, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { mediaUrl } from "./media.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { type StringKey, type Translate, useStrings } from "./strings.js";
import { Button, ErrorMessage } from "./ui.js";
import { prepareUpload } from "./upload.js";
import { AppLink } from "./use-link.js";

type WordPressModule = typeof import("@goodfellow-cms/core/wordpress");

/** The folder chosen: its files by their paths in it, and the Markdown files' text. */
interface ChosenFolder {
  name: string;
  files: Map<string, File>;
  texts: Map<string, string>;
  folders: MarkdownFolder[];
}

type Choices = Pick<MarkdownImportOptions, "replaceHome" | "replacePages" | "drafts" | "menu" | "keepFields"> & {
  folders: Record<string, MarkdownFolderUse>;
};

type Stage =
  | { kind: "choose" }
  | { kind: "reading" }
  | { kind: "ready"; folder: ChosenFolder }
  | { kind: "copying"; folder: ChosenFolder; done: number; total: number }
  | { kind: "publishing"; folder: ChosenFolder }
  | { kind: "done"; folder: ChosenFolder; plan: MarkdownImport };

const NOTES: Record<Exclude<MarkdownImportNote["kind"], "converted" | "fields">, StringKey> = {
  drafts: "markdownImport.note.drafts",
  taken: "markdownImport.note.taken",
  "front-matter": "markdownImport.note.frontMatter",
  "missing-links": "markdownImport.note.missingLinks",
  "missing-media": "markdownImport.note.missingMedia",
  "not-copied": "markdownImport.note.notCopied",
  "template-code": "markdownImport.note.templateCode",
  html: "markdownImport.note.html",
};

function listed(t: Translate, items: string[]): string {
  const shown = items.slice(0, 3).join(", ");
  return items.length > 3 ? t("import.note.more", { items: shown, count: String(items.length - 3) }) : shown;
}

/** What the import couldn't bring across as it was, in words. */
function noteText(t: Translate, note: MarkdownImportNote): string {
  switch (note.kind) {
    case "fields":
      return t("markdownImport.note.fields", { names: listed(t, note.names) });
    case "converted":
      return t("markdownImport.note.converted", { items: listed(t, note.files) });
    default:
      return t(NOTES[note.kind], { items: listed(t, note.files), count: String(note.files.length) });
  }
}

/** Reads a folder the browser was given: each file by its path in the folder, which the browser puts after the folder's own name. */
async function readFolder(list: readonly File[], wordpress: WordPressModule): Promise<ChosenFolder> {
  const files = new Map<string, File>();
  let name = "";
  for (const file of list) {
    const path = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const [top = "", ...rest] = path.split("/");
    name ||= top;
    const inside = rest.length > 0 ? rest.join("/") : path;
    // Hidden files and folders, and tools' own, aren't content.
    if (inside.split("/").some((part) => part.startsWith(".") || part === "node_modules")) continue;
    files.set(inside, file);
  }
  const texts = new Map<string, string>();
  for (const [path, file] of files) {
    if (/\.(md|markdown|mdx)$/i.test(path)) texts.set(path, await file.text());
  }
  return { name, files, texts, folders: wordpress.markdownFolders([...files.keys()]) };
}

/**
 * Brings a folder of Markdown files into the site, such as another static
 * site's content: each folder as pages or a collection, as the person
 * chooses, with what will come across shown first, then published in one go,
 * or added to a draft when drafts come too.
 */
export function MarkdownImportSection() {
  const t = useStrings();
  const { blocks, publish, mediaPreviews } = useAdmin();
  const { content, media } = useSiteContent();
  const [stage, setStage] = useState<Stage>({ kind: "choose" });
  const [choices, setChoices] = useState<Choices>({ folders: {} });
  const [problem, setProblem] = useState<{ message: string; error?: unknown }>();
  const [failure, setFailure] = useState<Failure>(null);
  const module = useRef<WordPressModule>(undefined);

  const names: MarkdownImportNames = {
    item: t("markdownImport.names.item"),
    post: t("import.names.post"),
    title: t("import.names.title"),
    date: t("import.names.date"),
    summary: t("import.names.summary"),
    image: t("import.names.image"),
    categories: t("import.names.categories"),
    tags: t("import.names.tags"),
    text: t("import.names.text"),
    all: t("markdownImport.names.all"),
  };
  const load = async () => {
    module.current ??= await import("@goodfellow-cms/core/wordpress");
    return module.current;
  };
  const plan = (wordpress: WordPressModule, folder: ChosenFolder, copied?: ReadonlySet<string>) =>
    wordpress.planMarkdownImport([...folder.files.keys()], (file) => folder.texts.get(file), content, {
      ...choices,
      mediaFiles: media,
      blocks: Object.keys(blocks),
      names,
      ...(copied && { copied }),
    });

  const choose = async (list: readonly File[]) => {
    setProblem(undefined);
    setFailure(null);
    setStage({ kind: "reading" });
    try {
      const wordpress = await load();
      const folder = await readFolder(list, wordpress);
      if (folder.folders.length === 0) {
        setProblem({ message: t("markdownImport.error.none") });
        setStage({ kind: "choose" });
        return;
      }
      setChoices({
        folders: Object.fromEntries(folder.folders.map((found) => [found.name, found.suggested])),
      });
      setStage({ kind: "ready", folder });
    } catch (error) {
      setProblem({ message: t("markdownImport.error.other"), error });
      setStage({ kind: "choose" });
    }
  };

  const importFolder = async (folder: ChosenFolder) => {
    const wordpress = await load();
    let first: MarkdownImport;
    try {
      first = plan(wordpress, folder);
    } catch (error) {
      setProblem(
        error instanceof wordpress.MarkdownImportError
          ? { message: t("import.error.blocks", { blocks: error.missingBlocks.join(", ") }), error }
          : { message: t("markdownImport.error.other"), error },
      );
      return;
    }
    const copied = new Map<string, Uint8Array>();
    let done = 0;
    setStage({ kind: "copying", folder, done, total: first.media.length });
    for (const copy of first.media) {
      const file = folder.files.get(copy.file);
      try {
        // Ready as uploads are: photos made web-sized and without their details, SVGs made safe.
        if (file) copied.set(copy.file, (await prepareUpload(file)).bytes);
      } catch {
        // A file uploads refuse, such as one too large, is left out, which the notes say.
      }
      done += 1;
      setStage({ kind: "copying", folder, done, total: first.media.length });
    }
    const final = plan(wordpress, folder, new Set(copied.keys()));
    const files: FileChange[] = final.media.flatMap((copy) => {
      const bytes = copied.get(copy.file);
      return bytes ? [{ path: copy.path, bytes }] : [];
    });
    for (const file of files) if ("bytes" in file) mediaPreviews.remember(mediaUrl(file.path), file.bytes);
    setStage({ kind: "publishing", folder });
    // Drafts come in a draft, so nothing unfinished goes live.
    const result = await publish([...final.changes, ...files], t("markdownImport.message", { name: folder.name }), {
      ...(final.summary.drafts > 0 && { draft: true }),
    });
    if (result.ok) {
      setStage({ kind: "done", folder, plan: final });
    } else {
      setFailure(result);
      setStage({ kind: "ready", folder });
    }
  };

  const busy = stage.kind === "reading" || stage.kind === "copying" || stage.kind === "publishing";

  return (
    <section aria-labelledby="gfa-markdown-import-title">
      <h2 id="gfa-markdown-import-title" className="gfa-section-title">
        {t("markdownImport.title")}
      </h2>
      {stage.kind === "choose" || stage.kind === "reading" ? (
        <>
          <p>{t("markdownImport.intro")}</p>
          {problem && <ErrorMessage message={problem.message} error={problem.error} />}
          <label className="gfa-field">
            <span className="gfa-label">{t("markdownImport.folder")}</span>
            <input
              type="file"
              className="gfa-input"
              multiple
              disabled={busy}
              {...{ webkitdirectory: "", directory: "" }}
              onChange={(event) => {
                // A copy, since the list empties when the box is cleared for the next choice.
                const chosen = Array.from(event.target.files ?? []);
                event.target.value = "";
                if (chosen.length > 0) void choose(chosen);
              }}
            />
            <span className="gfa-hint">{t("markdownImport.folderHint")}</span>
          </label>
          {stage.kind === "reading" && <p role="status">{t("markdownImport.reading")}</p>}
        </>
      ) : stage.kind === "done" ? (
        <>
          <p role="status" className="gfa-notice gfa-notice-success">
            {t(stage.plan.summary.drafts > 0 ? "markdownImport.doneDraft" : "markdownImport.done", {
              name: stage.folder.name,
            })}
          </p>
          <Notes plan={stage.plan} />
          <p className="gfa-import-actions">
            <AppLink href="#/pages" className="gfa-button gfa-button-primary">
              {t("import.viewPages")}
            </AppLink>
          </p>
        </>
      ) : (
        <ReadyFolder
          folder={stage.folder}
          choices={choices}
          setChoices={setChoices}
          plan={(folder) => {
            try {
              return module.current ? plan(module.current, folder) : undefined;
            } catch {
              return undefined;
            }
          }}
          busy={busy}
          problem={problem}
          failure={failure}
          onImport={() => void importFolder(stage.folder)}
          onCancel={() => setStage({ kind: "choose" })}
          progress={
            stage.kind === "copying"
              ? t("import.copying", { done: String(stage.done), total: String(stage.total) })
              : stage.kind === "publishing"
                ? t("import.publishing")
                : undefined
          }
        />
      )}
    </section>
  );
}

function ReadyFolder({
  folder,
  choices,
  setChoices,
  plan,
  busy,
  problem,
  failure,
  onImport,
  onCancel,
  progress,
}: {
  folder: ChosenFolder;
  choices: Choices;
  setChoices: (choices: Choices) => void;
  plan: (folder: ChosenFolder) => MarkdownImport | undefined;
  busy: boolean;
  problem?: { message: string; error?: unknown };
  failure: Failure;
  onImport: () => void;
  onCancel: () => void;
  progress?: string;
}) {
  const t = useStrings();
  const planned = plan(folder);
  const toggle = (key: "replaceHome" | "replacePages" | "drafts" | "menu" | "keepFields", label: StringKey) => (
    <label className="gfa-checkbox">
      <input
        type="checkbox"
        checked={choices[key] === true}
        disabled={busy}
        onChange={(event) => setChoices({ ...choices, [key]: event.target.checked })}
      />
      {t(label)}
    </label>
  );
  return (
    <>
      <p>{t("markdownImport.ready", { name: folder.name })}</p>
      <fieldset className="gfa-fieldset">
        <legend>{t("markdownImport.folders")}</legend>
        {folder.folders.map((found) => (
          <label key={found.name} className="gfa-field gfa-markdown-folder">
            <span className="gfa-label">
              {found.name
                ? t("markdownImport.folderName", { name: found.name, count: String(found.files) })
                : t("markdownImport.topFiles", { count: String(found.files) })}
            </span>
            <select
              className="gfa-input"
              value={choices.folders[found.name] ?? found.suggested}
              disabled={busy}
              onChange={(event) =>
                setChoices({
                  ...choices,
                  folders: { ...choices.folders, [found.name]: event.target.value as MarkdownFolderUse },
                })
              }
            >
              <option value="collection">{t("markdownImport.asCollection")}</option>
              <option value="pages">{t("markdownImport.asPages")}</option>
            </select>
          </label>
        ))}
      </fieldset>
      {toggle("replaceHome", "markdownImport.replaceHome")}
      {toggle("replacePages", "markdownImport.replacePages")}
      {toggle("drafts", "markdownImport.drafts")}
      {toggle("menu", "markdownImport.menu")}
      {toggle("keepFields", "markdownImport.keepFields")}
      {planned && (
        <>
          <ul className="gfa-import-summary">
            <li>{t("import.summary.pages", { count: String(planned.summary.pages.length) })}</li>
            {planned.summary.collections.map((collection) => (
              <li key={collection.id}>
                {t("markdownImport.summary.collection", {
                  name: collection.name,
                  count: String(collection.items),
                  path: collection.path,
                })}
              </li>
            ))}
            {planned.summary.menu > 0 && (
              <li>{t("markdownImport.summary.menu", { count: String(planned.summary.menu) })}</li>
            )}
            {planned.summary.redirects > 0 && (
              <li>{t("import.summary.redirects", { count: String(planned.summary.redirects) })}</li>
            )}
            <li>{t("import.summary.media", { count: String(planned.media.length) })}</li>
          </ul>
          {planned.summary.replaced.length > 0 && (
            <p className="gfa-notice gfa-notice-warning">
              {t("import.replaces", { pages: planned.summary.replaced.join(", ") })}
            </p>
          )}
          {planned.summary.drafts > 0 && (
            <p className="gfa-notice">{t("markdownImport.intoDraft", { count: String(planned.summary.drafts) })}</p>
          )}
          <Notes plan={planned} />
        </>
      )}
      {problem && <ErrorMessage message={problem.message} error={problem.error} />}
      <PublishFailure failure={failure} />
      {progress ? (
        <p role="status">{progress}</p>
      ) : (
        <p className="gfa-import-actions">
          <Button variant="primary" onClick={onImport} disabled={busy}>
            {t("import.start")}
          </Button>
          <Button onClick={onCancel} disabled={busy}>
            {t("markdownImport.another")}
          </Button>
        </p>
      )}
    </>
  );
}

function Notes({ plan }: { plan: MarkdownImport }) {
  const t = useStrings();
  if (plan.notes.length === 0) return null;
  return (
    <>
      <h3 className="gfa-section-title">{t("import.check")}</h3>
      <ul className="gfa-import-notes">
        {plan.notes.map((note) => (
          <li key={JSON.stringify(note)}>{noteText(t, note)}</li>
        ))}
      </ul>
    </>
  );
}
