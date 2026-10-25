import {
  type FileChange,
  isStorableAddress,
  MEDIA_DIR,
  mediaStorageFileChange,
  type PhotoCredit,
  type PluginTasks,
  type StoredFile,
  storedMediaUrl,
  withStoredFiles,
} from "@goodfellow-cms/core";
import { createContext, type ReactNode, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { withoutCredits } from "./changes.js";
import {
  allMedia,
  extensionOf,
  fileName,
  formatSize,
  isStoredMedia,
  MAX_UPLOAD_BYTES,
  MEDIA_URL_PREFIX,
  mediaKind,
  mediaPath,
  mediaUrl,
  mediaUsage,
  uploadName,
} from "./media.js";
import { mediaType } from "./media-previews.js";
import { type PluginMediaClient, type PluginMediaUpload, usePluginMedia } from "./plugin-frames.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { useOutsideHost } from "./site-host.js";
import { type StringKey, type Translate, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, Field } from "./ui.js";
import { imageSize, prepareStoredUpload, prepareUpload, UploadError } from "./upload.js";
import { AppLink } from "./use-link.js";

/** A media file's picture: the image itself, or its kind of file for anything else. */
export function MediaThumb({ url, className }: { url: string; className?: string }) {
  const { mediaPreviews } = useAdmin();
  const [src, setSrc] = useState(() => mediaPreviews.resolve(url));
  const tried = useRef(false);
  if (mediaKind(url) !== "image") {
    return (
      <span className={`gfa-media-thumb gfa-media-file ${className ?? ""}`} aria-hidden="true">
        {extensionOf(url).toUpperCase()}
      </span>
    );
  }
  return (
    <img
      className={`gfa-media-thumb ${className ?? ""}`}
      src={src}
      alt=""
      loading="lazy"
      onError={() => {
        // The live site doesn't have it yet: show the copy in the repository.
        if (tried.current) return;
        tried.current = true;
        void mediaPreviews.load(url).then((loaded) => loaded && setSrc(loaded));
      }}
    />
  );
}

/** A button that opens the file chooser. */
export function UploadButton({
  label,
  multiple = true,
  accept,
  disabled,
  variant = "primary",
  onFiles,
}: {
  label: string;
  multiple?: boolean;
  accept?: string;
  disabled?: boolean;
  variant?: "primary" | "secondary";
  onFiles: (files: File[]) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button variant={variant} disabled={disabled} onClick={() => input.current?.click()}>
        {label}
      </Button>
      <input
        ref={input}
        type="file"
        hidden
        multiple={multiple}
        accept={accept}
        aria-label={label}
        onChange={(event) => {
          const files = [...(event.target.files ?? [])];
          event.target.value = "";
          if (files.length > 0) onFiles(files);
        }}
      />
    </>
  );
}

const uploadProblems: Record<UploadError["problem"], StringKey> = {
  type: "media.error.type",
  size: "media.error.size",
  unreadable: "media.error.unreadable",
};

export type UploadResult =
  | { ok: true; urls: string[] }
  | {
      ok: false;
      message: string;
      failure?: Failure;
      /** What went wrong, in the storage plugin's own words, behind Details. */
      error?: unknown;
      /** Where the editor fixes it, such as the storage plugin's settings. */
      action?: { href: string; label: string };
    };

/** The plugin keeping the site's media, where the site has one and it's there to ask. */
export function useMediaStorage(): {
  storage: ReturnType<typeof useSiteContent>["content"]["mediaStorage"];
  client?: PluginMediaClient;
} {
  const { content } = useSiteContent();
  const storage = content.mediaStorage;
  const client = usePluginMedia(storage?.plugin);
  return { storage, ...(client && { client }) };
}

/** How many files moving media hands the plugin at once. */
const MOVE_BATCH = 20;

/** Whether the storage plugin can take files now, or why not, with a link to where that's fixed. */
async function storageReady(
  t: Translate,
  client: PluginMediaClient,
  tasks: PluginTasks | undefined,
): Promise<Extract<UploadResult, { ok: false }> | undefined> {
  const { plugin } = client;
  // A plugin with tasks needs the site's setup to run them before it can keep anything.
  if (plugin.tasks?.length && !(await tasks?.supported().catch(() => false))) {
    return { ok: false, message: t("plugins.task.missing") };
  }
  let ready: Awaited<ReturnType<PluginMediaClient["ready"]>>;
  try {
    ready = await client.ready();
  } catch (error) {
    return { ok: false, message: t("media.storage.unavailable", { plugin: plugin.title }), error };
  }
  if (ready.ready) return undefined;
  return {
    ok: false,
    message: t("media.storage.notReady", { plugin: plugin.title, message: ready.message }),
    ...(ready.screen && {
      action: {
        href: `#/settings/plugin/${encodeURIComponent(plugin.id)}/${encodeURIComponent(ready.screen)}`,
        label: t("media.storage.settings", { plugin: plugin.title }),
      },
    }),
  };
}

/** A file's size for content's list of stored media, with a picture's size where it's known. */
function storedFile(size: number, picture: { width?: number; height?: number }): StoredFile {
  return { size, ...(picture.width && picture.height && { width: picture.width, height: picture.height }) };
}

/**
 * Uploads files to the media folder in one publish, and shows them in the
 * admin panel straight away. `replace` overwrites one existing file instead.
 * Where a plugin keeps the site's media, it keeps the files, larger ones
 * too, and the publish lists them in `content/media-storage.json`.
 */
export function useUploadMedia() {
  const t = useStrings();
  const { publish, mediaPreviews, tasks } = useAdmin();
  const { content, media } = useSiteContent();
  const { storage, client } = useMediaStorage();

  const published = async (changes: FileChange[], message: string, urls: string[]): Promise<UploadResult> => {
    const result = await publish(changes, message, { checks: false });
    if (!result.ok) {
      return {
        ok: false,
        message: t(result.reason === "conflict" ? "publish.conflict" : "publish.error"),
        failure: result,
      };
    }
    return { ok: true, urls };
  };

  const toStorage = async (files: File[], replace?: string): Promise<UploadResult> => {
    if (!storage || !client) return { ok: false, message: t("publish.error") };
    const problem = await storageReady(t, client, tasks);
    if (problem) return problem;
    const { plugin } = client;
    const maxBytes = plugin.mediaStorage?.maxBytes ?? MAX_UPLOAD_BYTES;
    const taken = allMedia(content, media).map(fileName);
    const added: Record<string, StoredFile> = {};
    const batch: PluginMediaUpload[] = [];
    for (const file of files) {
      let ready: Awaited<ReturnType<typeof prepareStoredUpload>>;
      try {
        ready = await prepareStoredUpload(file, maxBytes);
      } catch (error) {
        if (error instanceof UploadError && error.problem === "size") {
          return {
            ok: false,
            message: t("media.error.storageSize", {
              name: file.name,
              size: formatSize(maxBytes),
              plugin: plugin.title,
            }),
          };
        }
        const message =
          error instanceof UploadError ? t(uploadProblems[error.problem], { name: error.file }) : String(error);
        return { ok: false, message };
      }
      const url = replace ? mediaUrl(replace) : `${MEDIA_URL_PREFIX}${uploadName(file.name, taken)}`;
      taken.push(fileName(url));
      batch.push({ address: url, type: ready.type, size: ready.blob.size, data: ready.blob });
      added[url] = storedFile(ready.blob.size, ready);
    }
    // All together, since each batch may wait about a minute for one of the plugin's tasks.
    try {
      await client.upload(batch);
    } catch (error) {
      const name = batch.map((file) => fileName(file.address)).join(", ");
      return { ok: false, message: t("media.storage.failed", { name, plugin: plugin.title }), error };
    }
    const urls = Object.keys(added);
    const changes: FileChange[] = [mediaStorageFileChange(withStoredFiles(storage, added))];
    // A file in the site's own files that's replaced is kept by the plugin from now on.
    if (replace && media.includes(replace)) changes.push({ path: replace, delete: true });
    const credits = replace ? withoutCredits(content.credits, [mediaUrl(replace)]) : undefined;
    if (credits) changes.push(credits);
    const names = urls.map(fileName).join(", ");
    return published(
      changes,
      replace ? t("media.replaceMessage", { name: names }) : t("media.uploadMessage", { names }),
      urls,
    );
  };

  return async (files: File[], replace?: string): Promise<UploadResult> => {
    if (storage && client && (!replace || isStorableAddress(mediaUrl(replace)))) return toStorage(files, replace);
    const taken = allMedia(content, media).map(fileName);
    const changes: FileChange[] = [];
    const uploads: Array<{ url: string; bytes: Uint8Array }> = [];
    for (const file of files) {
      let prepared: Awaited<ReturnType<typeof prepareUpload>>;
      try {
        prepared = await prepareUpload(file);
      } catch (error) {
        const message =
          error instanceof UploadError ? t(uploadProblems[error.problem], { name: error.file }) : String(error);
        return { ok: false, message };
      }
      const path = replace ?? `${MEDIA_DIR}/${uploadName(file.name, taken)}`;
      taken.push(fileName(path));
      changes.push({ path, bytes: prepared.bytes });
      uploads.push({ url: mediaUrl(path), bytes: prepared.bytes });
    }

    // Shown from memory until the live site has them; harmless if publishing fails.
    for (const upload of uploads) mediaPreviews.remember(upload.url, upload.bytes);
    const names = changes.map((change) => fileName(change.path)).join(", ");
    // A replaced photo's credit was for the photo it replaces.
    const credits = replace ? withoutCredits(content.credits, [mediaUrl(replace)]) : undefined;
    // A stored file replaced without its plugin comes back into the site's own files.
    const unstored =
      replace && storage && isStoredMedia(content, mediaUrl(replace))
        ? mediaStorageFileChange(withStoredFiles(storage, {}, [mediaUrl(replace)]))
        : undefined;
    return published(
      [...changes, ...(credits ? [credits] : []), ...(unstored ? [unstored] : [])],
      replace ? t("media.replaceMessage", { name: names }) : t("media.uploadMessage", { names }),
      uploads.map((upload) => upload.url),
    );
  };
}

function DeleteMediaDialog({ url, onClose }: { url: string; onClose: () => void }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const name = fileName(url);
  const used = mediaUsage(content, url, {
    header: t("layout.header"),
    footer: t("layout.footer"),
    settings: t("nav.settings"),
    css: t("settings.tab.css"),
  });

  const { storage, client } = useMediaStorage();

  const onDelete = async () => {
    const path = mediaPath(url);
    if (!path) return;
    setBusy(true);
    const credits = withoutCredits(content.credits, [url]);
    const stored = storage && isStoredMedia(content, url);
    const result = await publish(
      [
        stored ? mediaStorageFileChange(withStoredFiles(storage, {}, [url])) : { path, delete: true },
        ...(credits ? [credits] : []),
      ],
      t("media.deleteMessage", { name }),
    );
    setBusy(false);
    if (!result.ok) return setFailure(result);
    // Once the site no longer lists it, the plugin removes the file in the background; one left behind does no harm.
    if (stored) void client?.remove([url]).catch(() => {});
    onClose();
  };

  return (
    <Dialog title={t("media.deleteTitle", { name })} onClose={onClose}>
      <p>{t("media.deleteBody", { name })}</p>
      <p>{used.length > 0 ? t("media.deleteUsed", { places: used.join(", ") }) : t("media.notUsed")}</p>
      <PublishFailure failure={failure} />
      <div className="gfa-dialog-actions">
        <Button onClick={onClose}>{t("action.cancel")}</Button>
        <Button variant="danger" disabled={busy} onClick={() => void onDelete()}>
          {busy ? t("publish.publishing") : t("media.delete")}
        </Button>
      </div>
    </Dialog>
  );
}

/** Who made a photo and its license, which pages that use it show. */
function MediaCredit({ credit }: { credit: PhotoCredit }) {
  const t = useStrings();
  const text = [credit.creator, credit.license].filter(Boolean).join(" · ");
  return (
    <span className="gfa-media-credit" title={[credit.title, credit.source].filter(Boolean).join(" · ")}>
      {credit.sourceUrl ? (
        <a href={credit.sourceUrl} target="_blank" rel="noreferrer">
          {t("media.credit", { credit: text })}
        </a>
      ) : (
        t("media.credit", { credit: text })
      )}
    </span>
  );
}

/** Lets files be dropped onto an area to upload them. */
function DropZone({ onFiles, children }: { onFiles: (files: File[]) => void; children: ReactNode }) {
  const t = useStrings();
  const [over, setOver] = useState(false);
  return (
    <section
      className={`gfa-dropzone${over ? " gfa-dropzone-over" : ""}`}
      aria-label={t("media.drop")}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        const files = [...event.dataTransfer.files];
        if (files.length > 0) onFiles(files);
      }}
    >
      {children}
      {over && <p className="gfa-dropzone-hint">{t("media.drop")}</p>}
    </section>
  );
}

type Status =
  | { type: "idle" | "done" }
  | { type: "uploading"; plugin?: string }
  | { type: "failed"; message: string; failure?: Failure; error?: unknown; action?: { href: string; label: string } };

function UploadStatus({ status }: { status: Status }) {
  const t = useStrings();
  if (status.type === "uploading") {
    return (
      <p className="gfa-notice" role="status">
        {status.plugin ? t("media.storage.uploading", { plugin: status.plugin }) : t("media.uploading")}
      </p>
    );
  }
  if (status.type === "done") {
    return (
      <p className="gfa-notice gfa-notice-success" role="status">
        {t("media.uploaded")}
      </p>
    );
  }
  if (status.type === "failed") {
    if (status.failure) return <PublishFailure failure={status.failure} />;
    return (
      <ErrorMessage
        message={status.message}
        error={status.error}
        action={status.action && <AppLink href={status.action.href}>{status.action.label}</AppLink>}
      />
    );
  }
  return null;
}

function useUploads() {
  const upload = useUploadMedia();
  const { storage, client } = useMediaStorage();
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const run = async (files: File[], replace?: string) => {
    // A plugin's task takes about a minute, which the notice says.
    const waits = storage && client?.plugin.tasks?.length && (!replace || isStorableAddress(mediaUrl(replace)));
    setStatus({ type: "uploading", ...(waits && { plugin: client.plugin.title }) });
    const result = await upload(files, replace);
    setStatus(result.ok ? { type: "done" } : { type: "failed", ...result });
    return result;
  };
  return { status, run };
}

/** Moves the site's own media files to the plugin that keeps media, in one publish once each is kept. */
function MoveToStorageDialog({
  client,
  paths,
  onClose,
}: {
  client: PluginMediaClient;
  paths: string[];
  onClose: (done?: string) => void;
}) {
  const t = useStrings();
  const { publish, readBytes, tasks } = useAdmin();
  const { storage } = useMediaStorage();
  const [progress, setProgress] = useState<{ done: number } | undefined>();
  const [problem, setProblem] = useState<Extract<UploadResult, { ok: false }>>();
  const [failure, setFailure] = useState<Failure>(null);
  const plugin = client.plugin.title;

  const move = async () => {
    if (!storage) return;
    setProblem(undefined);
    setFailure(null);
    const unready = await storageReady(t, client, tasks);
    if (unready) return setProblem(unready);
    setProgress({ done: 0 });
    const added: Record<string, StoredFile> = {};
    let failed: Extract<UploadResult, { ok: false }> | undefined;
    // In batches, each waiting for the plugin once, so moving many files doesn't hold them all in memory.
    for (let start = 0; start < paths.length && !failed; start += MOVE_BATCH) {
      const batch: PluginMediaUpload[] = [];
      const sizes: Record<string, StoredFile> = {};
      try {
        for (const path of paths.slice(start, start + MOVE_BATCH)) {
          const url = mediaUrl(path);
          const bytes = await readBytes(path);
          if (!bytes) continue;
          const blob = new Blob([new Uint8Array(bytes)], { type: mediaType(path) });
          batch.push({ address: url, type: blob.type, size: blob.size, data: blob });
          sizes[url] = storedFile(blob.size, (await imageSize(blob, path)) ?? {});
        }
        if (batch.length > 0) await client.upload(batch);
        Object.assign(added, sizes);
      } catch (error) {
        const name = batch.map((file) => fileName(file.address)).join(", ");
        failed = { ok: false, message: t("media.storage.failed", { name, plugin }), error };
      }
      setProgress({ done: Math.min(start + MOVE_BATCH, paths.length) });
    }
    const moved = Object.keys(added);
    if (moved.length === 0) {
      setProgress(undefined);
      return setProblem(failed ?? { ok: false, message: t("media.move.nothing") });
    }
    const result = await publish(
      [
        mediaStorageFileChange(withStoredFiles(storage, added)),
        ...moved.flatMap((url) => {
          const path = mediaPath(url);
          return path ? [{ path, delete: true as const }] : [];
        }),
      ],
      t("media.move.message", { plugin }),
      { checks: false },
    );
    setProgress(undefined);
    if (!result.ok) return setFailure(result);
    if (failed)
      return setProblem({
        ...failed,
        message: `${t("media.move.some", { count: String(moved.length), plugin })} ${failed.message}`,
      });
    onClose(t("media.move.done", { count: String(moved.length), plugin }));
  };

  return (
    <Dialog title={t("media.move.title", { plugin })} onClose={() => onClose()}>
      <p>{t("media.move.body", { plugin })}</p>
      {progress && (
        <p className="gfa-notice" role="status">
          {t("media.move.moving", { done: String(progress.done), total: String(paths.length) })}
          {client.plugin.tasks?.length ? ` ${t("media.storage.wait")}` : ""}
        </p>
      )}
      {problem && (
        <ErrorMessage
          message={problem.message}
          error={problem.error}
          action={problem.action && <AppLink href={problem.action.href}>{problem.action.label}</AppLink>}
        />
      )}
      <PublishFailure failure={failure} />
      <div className="gfa-dialog-actions">
        <Button onClick={() => onClose()}>{t("action.cancel")}</Button>
        <Button variant="primary" disabled={progress !== undefined} onClick={() => void move()}>
          {progress ? t("media.move.busy") : t("media.move.button", { count: String(paths.length), plugin })}
        </Button>
      </div>
    </Dialog>
  );
}

/**
 * Copies the files a plugin keeps back into the site's own files, from their
 * public addresses, up to the site's own 25 MB each, which needs no plugin.
 * Once none are left, the site stops keeping media outside its files.
 */
function MoveBackDialog({ plugin, onClose }: { plugin: string; onClose: (done?: string) => void }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const { storage, client } = useMediaStorage();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ message: string; error?: unknown }>();
  const [failure, setFailure] = useState<Failure>(null);
  const files = Object.entries(storage?.files ?? {});
  const large = files.filter(([, file]) => file.size > MAX_UPLOAD_BYTES).map(([url]) => fileName(url));

  const moveBack = async () => {
    if (!storage) return;
    setBusy(true);
    setProblem(undefined);
    setFailure(null);
    const changes: FileChange[] = [];
    const moved: string[] = [];
    for (const [url, file] of files) {
      const path = mediaPath(url);
      const from = storedMediaUrl(storage, url);
      if (!path || !from || file.size > MAX_UPLOAD_BYTES) continue;
      try {
        const response = await fetch(from, { cache: "no-store" });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        changes.push({ path, bytes: new Uint8Array(await response.arrayBuffer()) });
        moved.push(url);
      } catch (error) {
        setBusy(false);
        return setProblem({ message: t("media.back.failed", { name: fileName(url), plugin }), error });
      }
    }
    const left = withStoredFiles(storage, {}, moved);
    changes.push(mediaStorageFileChange(Object.keys(left.files).length > 0 ? left : undefined));
    const result = await publish(changes, t("media.back.message", { plugin }), { checks: false });
    setBusy(false);
    if (!result.ok) return setFailure(result);
    // The site no longer lists them, so the plugin removes its copies in the background; ones left behind do no harm.
    if (moved.length > 0) void client?.remove(moved).catch(() => {});
    onClose(t("media.back.done", { count: String(moved.length), plugin }));
  };

  return (
    <Dialog title={t("media.back.title", { plugin })} onClose={() => onClose()}>
      <p>{files.length > 0 ? t("media.back.body", { plugin }) : t("media.back.empty", { plugin })}</p>
      {large.length > 0 && <p>{t("media.back.large", { names: large.join(", "), plugin })}</p>}
      {content.mediaStorage && problem && <ErrorMessage message={problem.message} error={problem.error} />}
      <PublishFailure failure={failure} />
      <div className="gfa-dialog-actions">
        <Button onClick={() => onClose()}>{t("action.cancel")}</Button>
        <Button variant="primary" disabled={busy} onClick={() => void moveBack()}>
          {busy ? t("media.move.busy") : t("media.back.button")}
        </Button>
      </div>
    </Dialog>
  );
}

/** Where a plugin keeps the site's media: what it keeps, and moving the site's own files there or back. */
function StorageSection({ onDone }: { onDone: (message: string) => void }) {
  const t = useStrings();
  const { content, media } = useSiteContent();
  const { storage, client } = useMediaStorage();
  const [moving, setMoving] = useState<"to" | "back">();
  if (!storage) return null;
  const plugin = client?.plugin.title ?? storage.plugin;
  const count = String(Object.keys(storage.files).length);
  // Files whose addresses builds can't find in content stay in the site's own files.
  const movable = media.filter((path) => isStorableAddress(mediaUrl(path)) && !isStoredMedia(content, mediaUrl(path)));
  const close = (message?: string) => {
    setMoving(undefined);
    if (message) onDone(message);
  };
  return (
    <section className="gfa-media-storage" aria-label={t("media.storage.title")}>
      <p className="gfa-notice" role="note">
        {client ? t("media.storage.intro", { plugin, count }) : t("media.storage.missing", { plugin, count })}
      </p>
      <div className="gfa-dialog-actions">
        {client && movable.length > 0 && (
          <Button variant="primary" onClick={() => setMoving("to")}>
            {t("media.move.button", { count: String(movable.length), plugin })}
          </Button>
        )}
        <Button variant="ghost" onClick={() => setMoving("back")}>
          {t("media.back.button")}
        </Button>
      </div>
      {moving === "to" && client && <MoveToStorageDialog client={client} paths={movable} onClose={close} />}
      {moving === "back" && <MoveBackDialog plugin={plugin} onClose={close} />}
    </section>
  );
}

/** Every uploaded image and file, with buttons to upload, replace and delete them. */
/** Cloudflare's terms for its CDN, which limit serving video on its free plans. */
const CLOUDFLARE_TERMS = "https://www.cloudflare.com/service-specific-terms-application-services/";

export function MediaScreen() {
  const t = useStrings();
  const { content, media: own } = useSiteContent();
  const media = useMemo(() => allMedia(content, own), [content, own]);
  const { status, run } = useUploads();
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // What moving media to its storage, or back, did: shown here, since moving back can end the storage section.
  const [moved, setMoved] = useState<string>();
  const searchId = useId();

  // A file dropped beside the drop area would otherwise open in place of the admin panel.
  useEffect(() => {
    const stop = (event: DragEvent) => {
      if (event.dataTransfer?.types.includes("Files")) event.preventDefault();
    };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => {
      window.removeEventListener("dragover", stop);
      window.removeEventListener("drop", stop);
    };
  }, []);
  // Cloudflare's free plans limit serving video, so sites it builds are told where else to put theirs.
  const outside = useOutsideHost();
  const cloudflareVideos =
    outside === "cloudflare-pages" && media.some((path) => mediaKind(mediaUrl(path)) === "video");
  const urls = useMemo(
    () =>
      media
        .map(mediaUrl)
        .filter((url) => fileName(url).toLowerCase().includes(query.trim().toLowerCase()))
        .sort((a, b) => fileName(a).localeCompare(fileName(b))),
    [media, query],
  );

  return (
    <div className="gfa-screen gfa-screen-wide">
      <div className="gfa-screen-header">
        <h1>{t("media.title")}</h1>
        <UploadButton
          label={t("media.upload")}
          disabled={status.type === "uploading"}
          onFiles={(files) => void run(files)}
        />
      </div>
      <p className="gfa-hint">{t("media.intro")}</p>
      {cloudflareVideos && (
        <p className="gfa-notice" role="note">
          {t("media.cloudflareVideo")}{" "}
          <a href={CLOUDFLARE_TERMS} target="_blank" rel="noreferrer">
            {t("media.cloudflareVideoTerms")}
          </a>
        </p>
      )}
      <StorageSection onDone={setMoved} />
      {moved && (
        <p className="gfa-notice gfa-notice-success" role="status">
          {moved}
        </p>
      )}
      <UploadStatus status={status} />

      {media.length > 0 && (
        <div className="gfa-field gfa-media-search">
          <label htmlFor={searchId} className="gfa-label">
            {t("media.search")}
          </label>
          <input
            id={searchId}
            className="gfa-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}

      <DropZone onFiles={(files) => void run(files)}>
        {media.length === 0 ? (
          <p>{t("media.empty")}</p>
        ) : urls.length === 0 ? (
          <p>{t("media.noMatches")}</p>
        ) : (
          <ul className="gfa-media-grid">
            {urls.map((url) => (
              <li key={url} className="gfa-media-card">
                <MediaThumb url={url} />
                <span className="gfa-media-name" title={url}>
                  {fileName(url)}
                </span>
                {content.credits?.[url] && <MediaCredit credit={content.credits[url]} />}
                {isStoredMedia(content, url) && (
                  <span className="gfa-badge">{t("media.stored", { plugin: content.mediaStorage?.plugin ?? "" })}</span>
                )}
                <div className="gfa-media-actions">
                  <Button
                    variant="ghost"
                    onClick={() =>
                      void navigator.clipboard?.writeText(url).then(
                        () => setCopied(url),
                        () => setCopied(null),
                      )
                    }
                  >
                    {copied === url ? t("media.copied") : t("media.copy")}
                  </Button>
                  <UploadButton
                    label={t("media.replace")}
                    variant="secondary"
                    multiple={false}
                    disabled={status.type === "uploading"}
                    onFiles={(files) => void run(files.slice(0, 1), mediaPath(url))}
                  />
                  <Button variant="ghost" onClick={() => setDeleting(url)}>
                    {t("media.delete")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </DropZone>

      {deleting && <DeleteMediaDialog url={deleting} onClose={() => setDeleting(null)} />}
    </div>
  );
}

export type MediaFieldKind = "image" | "video" | "file";

const PICKER_TITLES: Record<MediaFieldKind, StringKey> = {
  image: "media.pickerTitle",
  video: "media.pickerTitleVideo",
  file: "media.pickerTitleFile",
};

const CHOOSE_LABELS: Record<MediaFieldKind, StringKey> = {
  image: "media.choose",
  video: "media.chooseVideo",
  file: "media.chooseFile",
};

const ACCEPT: Record<MediaFieldKind, string | undefined> = {
  image: "image/*",
  video: "video/mp4,video/webm",
  file: undefined,
};

/** Picks a file from the media library, or uploads a new one, for a field. */
export function MediaPickerDialog({
  kind,
  onSelect,
  onClose,
}: {
  kind: MediaFieldKind;
  onSelect: (url: string) => void;
  onClose: () => void;
}) {
  const t = useStrings();
  const { content, media: own } = useSiteContent();
  const media = allMedia(content, own);
  const { status, run } = useUploads();
  const urls = media
    .map(mediaUrl)
    .filter((url) => kind === "file" || mediaKind(url) === kind)
    .sort((a, b) => fileName(a).localeCompare(fileName(b)));

  return (
    <Dialog title={t(PICKER_TITLES[kind])} onClose={onClose}>
      <div className="gfa-form">
        <div>
          <UploadButton
            label={t("media.upload")}
            multiple={false}
            accept={ACCEPT[kind]}
            disabled={status.type === "uploading"}
            onFiles={async (files) => {
              const result = await run(files.slice(0, 1));
              const [url] = result.ok ? result.urls : [];
              if (url) {
                onSelect(url);
                onClose();
              }
            }}
          />
        </div>
        <UploadStatus status={status} />
        {urls.length === 0 ? (
          <p className="gfa-hint">{t("media.pickerEmpty")}</p>
        ) : (
          <ul className="gfa-media-grid gfa-media-picker">
            {urls.map((url) => (
              <li key={url}>
                <button
                  type="button"
                  className="gfa-media-card gfa-media-pick"
                  onClick={() => {
                    onSelect(url);
                    onClose();
                  }}
                >
                  <MediaThumb url={url} />
                  <span className="gfa-media-name">{fileName(url)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="gfa-dialog-actions">
          <Button onClick={onClose}>{t("action.cancel")}</Button>
        </div>
      </div>
    </Dialog>
  );
}

/**
 * Where choosing a file happens, where it isn't here: in the site's frames,
 * the media library opens in the admin panel's own page, which can upload.
 */
export const MediaChoiceContext = createContext<
  ((kind: MediaFieldKind, value: string) => Promise<string | null>) | undefined
>(undefined);

/** The picture of the chosen file and a button to choose another, shown with a field that holds a media address. */
export function MediaChooser({
  value,
  kind,
  onChange,
}: {
  value: string;
  kind: MediaFieldKind;
  onChange: (url: string) => void;
}) {
  const t = useStrings();
  const [open, setOpen] = useState(false);
  const chooseElsewhere = useContext(MediaChoiceContext);
  const choose = () => {
    if (!chooseElsewhere) setOpen(true);
    else void chooseElsewhere(kind, value).then((url) => url !== null && onChange(url));
  };
  return (
    <div className="gfa-media-chooser">
      {value && <MediaThumb key={value} url={value} className="gfa-media-chosen" />}
      <div className="gfa-media-chooser-actions">
        <Button onClick={choose}>{t(CHOOSE_LABELS[kind])}</Button>
        {value && (
          <Button variant="ghost" onClick={() => onChange("")}>
            {t("media.clear")}
          </Button>
        )}
      </div>
      {open && <MediaPickerDialog kind={kind} onSelect={onChange} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** A text field for a media address, with the media chooser below it. For the admin panel's own forms. */
export function MediaField({
  label,
  hint,
  error,
  value,
  kind = "image",
  onChange,
}: {
  label: string;
  hint?: string;
  error?: string;
  value: string;
  kind?: MediaFieldKind;
  onChange: (value: string) => void;
}) {
  return (
    <Field label={label} hint={hint} error={error}>
      {(props) => (
        <div className="gfa-media-field">
          <input {...props} className="gfa-input" value={value} onChange={(event) => onChange(event.target.value)} />
          <MediaChooser value={value} kind={kind} onChange={onChange} />
        </div>
      )}
    </Field>
  );
}
