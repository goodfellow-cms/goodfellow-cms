import { type FileChange, MEDIA_DIR, type PhotoCredit } from "@goodfellow-cms/core";
import { createContext, type ReactNode, useContext, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { withoutCredits } from "./changes.js";
import { extensionOf, fileName, mediaKind, mediaPath, mediaUrl, mediaUsage, uploadName } from "./media.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { useOutsideHost } from "./site-host.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, Field } from "./ui.js";
import { prepareUpload, UploadError } from "./upload.js";

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

export type UploadResult = { ok: true; urls: string[] } | { ok: false; message: string; failure?: Failure };

/**
 * Uploads files to the media folder in one publish, and shows them in the
 * admin panel straight away. `replace` overwrites one existing file instead.
 */
export function useUploadMedia() {
  const t = useStrings();
  const { publish, mediaPreviews } = useAdmin();
  const { content, media } = useSiteContent();

  return async (files: File[], replace?: string): Promise<UploadResult> => {
    const taken = media.map(fileName);
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
    const result = await publish(
      credits ? [...changes, credits] : changes,
      replace ? t("media.replaceMessage", { name: names }) : t("media.uploadMessage", { names }),
      { checks: false },
    );
    if (!result.ok) {
      return {
        ok: false,
        message: t(result.reason === "conflict" ? "publish.conflict" : "publish.error"),
        failure: result,
      };
    }
    return { ok: true, urls: uploads.map((upload) => upload.url) };
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

  const onDelete = async () => {
    const path = mediaPath(url);
    if (!path) return;
    setBusy(true);
    const credits = withoutCredits(content.credits, [url]);
    const result = await publish(
      [{ path, delete: true }, ...(credits ? [credits] : [])],
      t("media.deleteMessage", { name }),
    );
    setBusy(false);
    if (result.ok) onClose();
    else setFailure(result);
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

type Status = { type: "idle" | "uploading" | "done" } | { type: "failed"; message: string; failure?: Failure };

function UploadStatus({ status }: { status: Status }) {
  const t = useStrings();
  if (status.type === "uploading") return <p className="gfa-notice">{t("media.uploading")}</p>;
  if (status.type === "done") {
    return (
      <p className="gfa-notice gfa-notice-success" role="status">
        {t("media.uploaded")}
      </p>
    );
  }
  if (status.type === "failed") {
    return status.failure ? <PublishFailure failure={status.failure} /> : <ErrorMessage message={status.message} />;
  }
  return null;
}

function useUploads() {
  const upload = useUploadMedia();
  const [status, setStatus] = useState<Status>({ type: "idle" });
  const run = async (files: File[], replace?: string) => {
    setStatus({ type: "uploading" });
    const result = await upload(files, replace);
    setStatus(result.ok ? { type: "done" } : { type: "failed", message: result.message, failure: result.failure });
    return result;
  };
  return { status, run };
}

/** Every uploaded image and file, with buttons to upload, replace and delete them. */
/** Cloudflare's terms for its CDN, which limit serving video on its free plans. */
const CLOUDFLARE_TERMS = "https://www.cloudflare.com/service-specific-terms-application-services/";

export function MediaScreen() {
  const t = useStrings();
  const { content, media } = useSiteContent();
  const { status, run } = useUploads();
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
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
  const { media } = useSiteContent();
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
