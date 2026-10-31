/**
 * What the media library says about its files beyond the files themselves,
 * in `content/media.json`: an image's description and focal point and every
 * file's tags, on the Media screen's Details dialog, tags for several files at
 * once, and cropping and turning a photo, saved as a new image or in place of
 * the original.
 */
import {
  cleanTags,
  hasTag,
  MAX_DESCRIPTION_LENGTH,
  MAX_TAG_LENGTH,
  type MediaFocus,
  mediaDetailsOf,
  mediaTags,
  siteLanguages,
} from "@goodfellow-cms/core";
import { type KeyboardEvent, type PointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { mediaFileChange } from "./changes.js";
import {
  CROP_SHAPES,
  type CropBox,
  type CropShape,
  canCrop,
  changesPicture,
  cropPixels,
  croppedName,
  croppedType,
  fittedBox,
  movedBox,
  nextTurn,
  resizedBox,
  type Turn,
  turnedSize,
} from "./crop.js";
import { fileName, isStoredMedia, mediaKind, mediaPath } from "./media.js";
import { useUploadMedia } from "./media-library.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage } from "./ui.js";

/** A media file's picture as previews show it: from memory, the live site, or else the repository. */
function usePreviewSource(url: string): { src: string; onError: () => void } {
  const { mediaPreviews } = useAdmin();
  const [src, setSrc] = useState(() => mediaPreviews.resolve(url));
  const tried = useRef(false);
  return {
    src,
    onError: () => {
      if (tried.current) return;
      tried.current = true;
      void mediaPreviews.load(url).then((loaded) => loaded && setSrc(loaded));
    },
  };
}

/** Whether the Media screen offers to crop a file: photos in the site's own files, which the browser can read. */
export function useCanCrop(url: string): boolean {
  const { content } = useSiteContent();
  return canCrop(url) && !isStoredMedia(content, url);
}

/** Tags, as chips to take off and a box to add more, suggesting the media library's others. */
function TagInput({
  id,
  value,
  onChange,
  suggestions,
}: {
  id: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions: string[];
}) {
  const t = useStrings();
  const [text, setText] = useState("");
  const listId = `${id}-suggestions`;
  const add = () => {
    const added = text.split(",");
    setText("");
    onChange(cleanTags([...value, ...added]));
  };
  return (
    <div className="gfa-tags">
      {value.length > 0 && (
        <ul className="gfa-tag-list">
          {value.map((tag) => (
            <li key={tag} className="gfa-tag">
              {tag}
              <button
                type="button"
                className="gfa-tag-remove"
                aria-label={t("media.tagRemove", { tag })}
                onClick={() => onChange(value.filter((own) => own !== tag))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <input
        id={id}
        className="gfa-input"
        list={listId}
        maxLength={MAX_TAG_LENGTH * 4}
        placeholder={t("media.tagAdd")}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          // A comma ends a tag, as Enter does.
          if (next.includes(",")) {
            onChange(cleanTags([...value, ...next.split(",")]));
            setText("");
          } else {
            setText(next);
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" && text.trim()) {
            event.preventDefault();
            add();
          }
        }}
        onBlur={() => text.trim() && add()}
      />
      <datalist id={listId}>
        {suggestions
          .filter((tag) => !hasTag(value, tag))
          .map((tag) => (
            <option key={tag} value={tag} />
          ))}
      </datalist>
    </div>
  );
}

/** Where a click or the arrow keys put an image's focal point, shown as a dot on the picture. */
function FocusPicker({
  url,
  focus,
  onChange,
}: {
  url: string;
  focus: MediaFocus | undefined;
  onChange: (focus: MediaFocus | undefined) => void;
}) {
  const t = useStrings();
  const { src, onError } = usePreviewSource(url);
  const image = useRef<HTMLImageElement>(null);
  const round = (value: number) => Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
  const onPick = (event: { clientX: number; clientY: number; detail: number }) => {
    const box = image.current?.getBoundingClientRect();
    // A click from the keyboard (Enter or Space) has no point.
    if (!box || box.width === 0 || box.height === 0 || event.detail === 0) return;
    onChange({
      x: round(((event.clientX - box.left) / box.width) * 100),
      y: round(((event.clientY - box.top) / box.height) * 100),
    });
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 1 : 5;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const from = focus ?? { x: 50, y: 50 };
    onChange({ x: round(from.x + move[0]), y: round(from.y + move[1]) });
  };
  return (
    <button
      type="button"
      className="gfa-focus-picker"
      aria-label={t("media.focusLabel", { name: fileName(url) })}
      aria-description={focus ? `${focus.x}% ${focus.y}%` : t("media.focusNone")}
      onClick={onPick}
      onKeyDown={onKey}
    >
      <img ref={image} src={src} alt="" onError={onError} draggable={false} />
      {focus && (
        <span className="gfa-focus-dot" aria-hidden="true" style={{ left: `${focus.x}%`, top: `${focus.y}%` }} />
      )}
    </button>
  );
}

/**
 * A file's details, published together: an image's focal point and its
 * description in each of the site's languages, and any file's tags. Photos in
 * the site's own files offer cropping and turning (`onCrop`).
 */
export function MediaDetailsDialog({
  url,
  onClose,
  onCrop,
}: {
  url: string;
  onClose: () => void;
  onCrop?: (url: string) => void;
}) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const languages = siteLanguages(content.settings);
  const several = languages.length > 1;
  const image = mediaKind(url) === "image";
  const croppable = useCanCrop(url);
  const before = content.descriptions?.[url];
  const [texts, setTexts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      languages.map((language) => [
        language.code,
        (language.main ? before?.text : before?.translations?.[language.code]) ?? "",
      ]),
    ),
  );
  const [focus, setFocus] = useState<MediaFocus | undefined>(content.focus?.[url]);
  const [tags, setTags] = useState<string[]>(content.mediaTags?.[url] ?? []);
  const allTags = useMemo(() => mediaTags(content.mediaTags), [content.mediaTags]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const name = fileName(url);
  const id = useId();

  const onPublish = async () => {
    const details = mediaDetailsOf(content);
    const { [url]: _description, ...descriptions } = details.descriptions ?? {};
    const { [url]: _focus, ...focal } = details.focus ?? {};
    const { [url]: _tags, ...tagged } = details.tags ?? {};
    if (image) {
      const [main, ...others] = languages;
      const text = main ? (texts[main.code] ?? "").trim() : "";
      const translations = Object.fromEntries(
        others.flatMap((language) => {
          const translated = (texts[language.code] ?? "").trim();
          return translated ? [[language.code, translated]] : [];
        }),
      );
      // Without words in the main language there's nothing to fall back on, so the description goes.
      if (text) descriptions[url] = { text, ...(Object.keys(translations).length > 0 && { translations }) };
      if (focus) focal[url] = focus;
    }
    if (tags.length > 0) tagged[url] = tags;
    setBusy(true);
    const result = await publish(
      [mediaFileChange({ ...details, descriptions, focus: focal, tags: tagged })],
      t("media.detailsMessage", { name }),
    );
    setBusy(false);
    if (!result.ok) return setFailure(result);
    onClose();
  };

  return (
    <Dialog title={t("media.detailsTitle", { name })} onClose={onClose}>
      <div className="gfa-form">
        {image && (
          <div className="gfa-field">
            <span className="gfa-label">{t("media.focus")}</span>
            <p className="gfa-hint">{t("media.focusHint")}</p>
            <FocusPicker url={url} focus={focus} onChange={setFocus} />
            <div className="gfa-dialog-actions gfa-focus-actions">
              <span className="gfa-hint">{focus ? `${focus.x}% · ${focus.y}%` : t("media.focusNone")}</span>
              {focus && (
                <Button variant="ghost" onClick={() => setFocus(undefined)}>
                  {t("media.focusClear")}
                </Button>
              )}
              {croppable && onCrop && (
                <Button variant="secondary" onClick={() => onCrop(url)}>
                  {t("media.crop")}
                </Button>
              )}
            </div>
          </div>
        )}
        {image && (
          <>
            <p className="gfa-hint">{t("media.describeHint")}</p>
            {languages.map((language) => (
              <div key={language.code} className="gfa-field">
                <label htmlFor={`${id}-${language.code}`} className="gfa-label">
                  {several ? t("media.descriptionIn", { language: language.name }) : t("media.description")}
                </label>
                <textarea
                  id={`${id}-${language.code}`}
                  className="gfa-input"
                  rows={3}
                  maxLength={MAX_DESCRIPTION_LENGTH}
                  value={texts[language.code] ?? ""}
                  onChange={(event) => setTexts({ ...texts, [language.code]: event.target.value })}
                />
              </div>
            ))}
            {several && <p className="gfa-hint">{t("media.describeLanguages")}</p>}
          </>
        )}
        <div className="gfa-field">
          <label htmlFor={`${id}-tags`} className="gfa-label">
            {t("media.tags")}
          </label>
          <p className="gfa-hint">{t("media.tagsHint")}</p>
          <TagInput id={`${id}-tags`} value={tags} onChange={setTags} suggestions={allTags} />
        </div>
        <PublishFailure failure={failure} />
        <div className="gfa-dialog-actions">
          <Button onClick={onClose}>{t("action.cancel")}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void onPublish()}>
            {busy ? t("publish.publishing") : t("publish.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Adds tags to several files at once, and takes off tags any of them has, in one publish. */
export function TagFilesDialog({ urls, onClose }: { urls: string[]; onClose: (done?: boolean) => void }) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const id = useId();
  const allTags = useMemo(() => mediaTags(content.mediaTags), [content.mediaTags]);
  const theirs = useMemo(
    () => mediaTags(Object.fromEntries(urls.map((url) => [url, content.mediaTags?.[url] ?? []]))),
    [urls, content.mediaTags],
  );
  const [added, setAdded] = useState<string[]>([]);
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const count = String(urls.length);

  const onPublish = async () => {
    const details = mediaDetailsOf(content);
    const tags = { ...details.tags };
    for (const url of urls) {
      const kept = (tags[url] ?? []).filter((tag) => !hasTag(removed, tag));
      tags[url] = cleanTags([...kept, ...added]);
    }
    setBusy(true);
    const result = await publish([mediaFileChange({ ...details, tags })], t("media.tagMessage", { count }));
    setBusy(false);
    if (!result.ok) return setFailure(result);
    onClose(true);
  };

  return (
    <Dialog title={t("media.tagFilesTitle", { count })} onClose={() => onClose()}>
      <div className="gfa-form">
        <div className="gfa-field">
          <label htmlFor={`${id}-add`} className="gfa-label">
            {t("media.tagFilesAdd")}
          </label>
          <TagInput id={`${id}-add`} value={added} onChange={setAdded} suggestions={allTags} />
        </div>
        {theirs.length > 0 && (
          <fieldset className="gfa-field">
            <legend className="gfa-label">{t("media.tagFilesRemove")}</legend>
            {theirs.map((tag) => (
              <label key={tag} className="gfa-checkbox">
                <input
                  type="checkbox"
                  checked={removed.includes(tag)}
                  onChange={(event) =>
                    setRemoved(event.target.checked ? [...removed, tag] : removed.filter((own) => own !== tag))
                  }
                />
                {tag}
              </label>
            ))}
          </fieldset>
        )}
        <PublishFailure failure={failure} />
        <div className="gfa-dialog-actions">
          <Button onClick={() => onClose()}>{t("action.cancel")}</Button>
          <Button
            variant="primary"
            disabled={busy || (added.length === 0 && removed.length === 0)}
            onClick={() => void onPublish()}
          >
            {busy ? t("publish.publishing") : t("publish.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/** Buttons that show only the files with a tag, or all of them again. */
export function TagFilter({
  tags,
  chosen,
  onChoose,
}: {
  tags: string[];
  chosen: string | undefined;
  onChoose: (tag: string | undefined) => void;
}) {
  const t = useStrings();
  if (tags.length === 0) return null;
  return (
    <fieldset className="gfa-tag-filter">
      <legend className="gfa-label">{t("media.tagFilter")}</legend>
      <Button variant="ghost" aria-pressed={chosen === undefined} onClick={() => onChoose(undefined)}>
        {t("media.tagAll")}
      </Button>
      {tags.map((tag) => (
        <Button
          key={tag}
          variant="ghost"
          aria-pressed={chosen !== undefined && hasTag([chosen], tag)}
          onClick={() => onChoose(tag)}
        >
          {tag}
        </Button>
      ))}
    </fieldset>
  );
}

const SHAPE_LABELS: Record<CropShape, StringKey> = {
  free: "media.cropFree",
  square: "media.cropSquare",
  photo: "media.cropPhoto",
  wide: "media.cropWide",
};

/** The largest the picture is drawn while cropping, in CSS pixels. */
const PREVIEW = { width: 560, height: 380 };

/**
 * Crops and turns a photo in the browser, read from the repository so the
 * canvas may read it back, then saves it as a new image or in place of the
 * original, through the usual upload, which makes it web-sized and drops its
 * hidden details.
 */
export function CropDialog({ url, onClose }: { url: string; onClose: (saved?: string) => void }) {
  const t = useStrings();
  const { readBytes } = useAdmin();
  const upload = useUploadMedia();
  const [picture, setPicture] = useState<HTMLImageElement>();
  const [unreadable, setUnreadable] = useState(false);
  const [turn, setTurn] = useState<Turn>(0);
  const [shape, setShape] = useState<CropShape>("free");
  const [box, setBox] = useState<CropBox>({ x: 0, y: 0, width: 1, height: 1 });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const area = useRef<HTMLDivElement>(null);
  const dragging = useRef<{ kind: "move" | "resize"; x: number; y: number; box: CropBox }>(undefined);
  const name = fileName(url);
  const ratio = CROP_SHAPES[shape];

  useEffect(() => {
    let address: string | undefined;
    let cancelled = false;
    const path = mediaPath(url);
    void (async () => {
      const bytes = path ? await readBytes(path).catch(() => undefined) : undefined;
      if (!bytes || cancelled) return setUnreadable(!cancelled);
      address = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: croppedType(name) }));
      const image = new Image();
      image.src = address;
      try {
        await image.decode();
        if (!cancelled) setPicture(image);
      } catch {
        if (!cancelled) setUnreadable(true);
      }
    })();
    return () => {
      cancelled = true;
      if (address) URL.revokeObjectURL(address);
    };
  }, [url, name, readBytes]);

  const turned = picture ? turnedSize(picture.naturalWidth, picture.naturalHeight, turn) : undefined;
  const scale = turned ? Math.min(1, PREVIEW.width / turned.width, PREVIEW.height / turned.height) : 1;

  // The picture as turned, drawn small enough to fit.
  useEffect(() => {
    const target = canvas.current;
    if (!picture || !turned || !target) return;
    target.width = Math.round(turned.width * scale);
    target.height = Math.round(turned.height * scale);
    const context = target.getContext("2d");
    if (!context) return;
    context.save();
    context.translate(target.width / 2, target.height / 2);
    context.rotate((turn * Math.PI) / 180);
    context.drawImage(
      picture,
      (-picture.naturalWidth * scale) / 2,
      (-picture.naturalHeight * scale) / 2,
      picture.naturalWidth * scale,
      picture.naturalHeight * scale,
    );
    context.restore();
  }, [picture, turned, scale, turn]);

  const chooseShape = (next: CropShape) => {
    setShape(next);
    if (turned) setBox(fittedBox(turned.width, turned.height, CROP_SHAPES[next]));
  };
  const turnBy = (direction: 1 | -1) => {
    const next = nextTurn(turn, direction);
    setTurn(next);
    if (picture) {
      const size = turnedSize(picture.naturalWidth, picture.naturalHeight, next);
      setBox(fittedBox(size.width, size.height, ratio));
    }
  };

  const fraction = (event: PointerEvent) => {
    const rect = area.current?.getBoundingClientRect();
    return rect && rect.width > 0 && rect.height > 0
      ? { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height }
      : undefined;
  };
  const startDrag = (kind: "move" | "resize") => (event: PointerEvent<HTMLElement>) => {
    const at = fraction(event);
    if (!at) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    dragging.current = { kind, x: at.x, y: at.y, box };
  };
  const drag = (event: PointerEvent<HTMLElement>) => {
    const from = dragging.current;
    const at = fraction(event);
    if (!from || !at || !turned) return;
    const dx = at.x - from.x;
    const dy = at.y - from.y;
    setBox(
      from.kind === "move"
        ? movedBox(from.box, dx, dy)
        : resizedBox(from.box, from.box.width + dx, from.box.height + dy, turned, ratio),
    );
  };
  const endDrag = () => {
    dragging.current = undefined;
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!turned) return;
    const step = 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setBox(
      event.shiftKey
        ? resizedBox(box, box.width + move[0], box.height + move[1], turned, ratio)
        : movedBox(box, move[0], move[1]),
    );
  };

  const save = async (replace: boolean) => {
    if (!picture || !turned) return;
    setBusy(true);
    setProblem(undefined);
    const part = cropPixels(box, turned);
    const out = document.createElement("canvas");
    out.width = part.width;
    out.height = part.height;
    const context = out.getContext("2d");
    if (!context) {
      setBusy(false);
      return setProblem(t("media.cropFailed"));
    }
    context.translate(-part.x, -part.y);
    context.translate(turned.width / 2, turned.height / 2);
    context.rotate((turn * Math.PI) / 180);
    context.drawImage(picture, -picture.naturalWidth / 2, -picture.naturalHeight / 2);
    const type = croppedType(name);
    const blob = await new Promise<Blob | null>((resolve) => out.toBlob(resolve, type, 0.92));
    if (!blob) {
      setBusy(false);
      return setProblem(t("media.cropFailed"));
    }
    const file = new File([blob], replace ? name : croppedName(name), { type });
    const path = mediaPath(url);
    const result = await upload([file], replace && path ? path : undefined);
    setBusy(false);
    if (!result.ok) return setProblem(result.message);
    onClose(result.urls[0]);
  };

  const changed = changesPicture(box, turn);
  return (
    <Dialog title={t("media.cropTitle", { name })} onClose={() => onClose()}>
      <div className="gfa-form">
        {unreadable ? (
          <ErrorMessage message={t("media.cropUnreadable")} />
        ) : !picture ? (
          <p className="gfa-hint">{t("loading")}</p>
        ) : (
          <>
            <p className="gfa-hint">{t("media.cropHint")}</p>
            <div className="gfa-crop-tools">
              <label className="gfa-inline-field">
                {t("media.cropShape")}
                <select
                  className="gfa-input"
                  value={shape}
                  onChange={(event) => chooseShape(event.target.value as CropShape)}
                >
                  {(Object.keys(CROP_SHAPES) as CropShape[]).map((option) => (
                    <option key={option} value={option}>
                      {t(SHAPE_LABELS[option])}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="ghost" onClick={() => turnBy(-1)}>
                {t("media.rotateLeft")}
              </Button>
              <Button variant="ghost" onClick={() => turnBy(1)}>
                {t("media.rotateRight")}
              </Button>
            </div>
            <div className="gfa-crop-area" ref={area}>
              <canvas ref={canvas} />
              <button
                type="button"
                className="gfa-crop-box"
                aria-label={t("media.cropBox")}
                style={{
                  left: `${box.x * 100}%`,
                  top: `${box.y * 100}%`,
                  width: `${box.width * 100}%`,
                  height: `${box.height * 100}%`,
                }}
                onPointerDown={startDrag("move")}
                onPointerMove={drag}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onKeyDown={onKey}
              >
                <span
                  className="gfa-crop-handle"
                  aria-hidden="true"
                  onPointerDown={startDrag("resize")}
                  onPointerMove={drag}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                />
              </button>
            </div>
            <p className="gfa-hint">
              {(() => {
                const part = turned ? cropPixels(box, turned) : undefined;
                return part ? t("media.cropSize", { width: String(part.width), height: String(part.height) }) : "";
              })()}
            </p>
            <p className="gfa-hint">{t("media.cropReplaceHint")}</p>
          </>
        )}
        {problem && <ErrorMessage message={problem} />}
        <div className="gfa-dialog-actions">
          <Button onClick={() => onClose()}>{t("action.cancel")}</Button>
          <Button disabled={busy || !picture || !changed} onClick={() => void save(true)}>
            {t("media.cropReplace")}
          </Button>
          <Button variant="primary" disabled={busy || !picture || !changed} onClick={() => void save(false)}>
            {busy ? t("publish.publishing") : t("media.cropSaveNew")}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
