import { fileName, mediaKind, withBase } from "@goodfellow-cms/core";
import { classNameField, mediaField, SiteImage, SiteLink, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, Slot, SlotComponent } from "@puckeditor/core";
import { type DocumentProps, documentAddress, documentHeight, isFramedDocument } from "./media-data.js";
import { options, yesNo } from "./options.js";
import { AUDIO_PARTS, DOCUMENT_PARTS, FILE_PARTS, GALLERY_PARTS, MEDIA_TEXT_PARTS } from "./parts.js";

export type { DocumentProps } from "./media-data.js";

/** What an empty media block shows in the editor, where something has to be chosen. Visitors see nothing. */
function EditorPlaceholder({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={`flex items-center justify-center rounded-md bg-muted p-4 text-sm text-muted-foreground ${className ?? ""}`}
    >
      {text}
    </div>
  );
}

export interface FileProps {
  /** The file's address, such as `/media/newsletter.pdf`. */
  file: string;
  /** What the link says; the file's name without it. */
  label: string;
  button: boolean;
  buttonLabel: string;
  className: string;
}

/** A link to a file, such as a PDF, with an optional download button, as WordPress's File block has. */
export const File: ComponentConfig<FileProps> = withParts(
  {
    label: "File",
    fields: {
      file: mediaField("File", "file"),
      label: { type: "text", label: "Link's text", contentEditable: true },
      button: { type: "radio", label: "Download button", options: yesNo },
      buttonLabel: { type: "text", label: "Button's text" },
      className: classNameField,
    },
    defaultProps: { file: "", label: "", button: true, buttonLabel: "Download", className: "" },
    render: ({ puck, ...props }) => <FileView {...props} isEditing={puck?.isEditing === true} />,
  },
  FILE_PARTS,
);

function FileView({ file, label, button, buttonLabel, className, isEditing }: FileProps & { isEditing: boolean }) {
  const part = useParts();
  if (!file) return isEditing ? <EditorPlaceholder text="Choose a file" className={className} /> : null;
  return (
    <div className={part("gf-file", "my-4 flex flex-wrap items-center gap-3", className)}>
      <SiteLink href={file} className={part("gf-file-link", "underline underline-offset-4")}>
        {label || fileName(file)}
      </SiteLink>
      {button && (
        <SiteLink
          href={file}
          download=""
          className={part(
            "gf-file-button",
            "inline-flex h-9 items-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90",
          )}
        >
          {buttonLabel || "Download"}
        </SiteLink>
      )}
    </div>
  );
}

function DocumentView({
  file,
  title,
  height,
  linkLabel,
  className,
  isEditing,
}: DocumentProps & { isEditing: boolean }) {
  const { base, mediaStorage } = useSite();
  const part = useParts();
  const address = documentAddress(file);
  if (!address) {
    return isEditing ? (
      <EditorPlaceholder
        text={file ? "Choose a PDF: other files can only be linked, with the File block." : "Choose a PDF"}
        className={className}
      />
    ) : null;
  }
  const shown = withBase(address, base);
  const name = title || fileName(address);
  const framed = isFramedDocument(address, mediaStorage);
  return (
    <figure className={part("gf-document", "my-4", className)}>
      {!framed ? (
        isEditing && (
          <EditorPlaceholder
            text={`${name} is on another site, so the page links to it rather than showing it. Upload it to the media library to show it here.`}
            className="h-24"
          />
        )
      ) : isEditing ? (
        // The editor can't open the site's files in a frame; the page shows the document here.
        <EditorPlaceholder text={`${name}: shown here on the site`} className="h-40" />
      ) : (
        <iframe
          src={shown}
          title={name}
          loading="lazy"
          className={part("gf-document-frame", "block w-full rounded-md border border-border bg-muted")}
          style={{ height: documentHeight(height) }}
        />
      )}
      <figcaption className={part("gf-document-caption", "mt-2 text-sm")}>
        <SiteLink href={address} className={part("gf-document-link", "underline underline-offset-4")}>
          {linkLabel || "Open the document"}
        </SiteLink>
      </figcaption>
    </figure>
  );
}

/**
 * A PDF from the media library shown on the page, in the browser's own viewer,
 * with a link to open it, which phones' browsers need since they show only its
 * first page in a page.
 */
export const Document: ComponentConfig<DocumentProps> = withParts(
  {
    label: "Document viewer",
    fields: {
      file: mediaField("PDF", "file"),
      title: { type: "text", label: "What the document is, for screen readers" },
      height: { type: "number", label: "Height in pixels", min: 200, max: 2000 },
      linkLabel: { type: "text", label: "Link's text" },
      className: classNameField,
    },
    defaultProps: { file: "", title: "", height: 800, linkLabel: "Open the document", className: "" },
    render: ({ puck, ...props }) => <DocumentView {...props} isEditing={puck?.isEditing === true} />,
  },
  DOCUMENT_PARTS,
);

export interface AudioProps {
  /** An uploaded sound file's address, such as `/media/sermon.mp3`. */
  src: string;
  caption: string;
  loop: boolean;
  className: string;
}

function AudioView({ src, caption, loop, className, isEditing }: AudioProps & { isEditing: boolean }) {
  const { base } = useSite();
  const part = useParts();
  if (!src) return isEditing ? <EditorPlaceholder text="Choose a sound file" className={className} /> : null;
  return (
    <figure className={part("gf-audio", "my-4", className)}>
      {/* biome-ignore lint/a11y/useMediaCaption: a sound file's words go in its caption or the page around it */}
      <audio
        controls
        preload="metadata"
        loop={loop || undefined}
        src={withBase(src, base)}
        className={part("gf-audio-player", "w-full")}
      />
      {caption && (
        <figcaption className={part("gf-audio-caption", "mt-2 text-sm text-muted-foreground")}>{caption}</figcaption>
      )}
    </figure>
  );
}

/** An uploaded sound file, such as a sermon or a song, with the browser's own player. */
export const Audio: ComponentConfig<AudioProps> = withParts(
  {
    label: "Audio",
    fields: {
      src: mediaField("Sound file", "audio"),
      caption: { type: "text", label: "Caption" },
      loop: { type: "radio", label: "Play again when it ends", options: yesNo },
      className: classNameField,
    },
    defaultProps: { src: "", caption: "", loop: false, className: "" },
    render: ({ puck, ...props }) => <AudioView {...props} isEditing={puck?.isEditing === true} />,
  },
  AUDIO_PARTS,
);

type MediaPosition = "left" | "right";
type MediaWidth = "third" | "half" | "two-thirds";
type VerticalAlign = "top" | "center" | "bottom";

export interface MediaTextProps {
  /** A picture's or an uploaded video's address. */
  media: string;
  alt: string;
  position: MediaPosition;
  width: MediaWidth;
  align: VerticalAlign;
  rounded: boolean;
  content: Slot;
  className: string;
}

/** The columns' widths on wider screens, the picture's column first; on phones they stack, the picture on top. */
const mediaTextColumns: Record<MediaPosition, Record<MediaWidth, string>> = {
  left: {
    third: "md:grid-cols-[1fr_2fr]",
    half: "md:grid-cols-2",
    "two-thirds": "md:grid-cols-[2fr_1fr]",
  },
  right: {
    third: "md:grid-cols-[2fr_1fr]",
    half: "md:grid-cols-2",
    "two-thirds": "md:grid-cols-[1fr_2fr]",
  },
};

const verticalAlignClasses: Record<VerticalAlign, string> = {
  top: "items-start",
  center: "items-center",
  bottom: "items-end",
};

function MediaTextView({
  media,
  alt,
  position = "left",
  width = "half",
  align = "center",
  rounded,
  content: Content,
  className,
}: Omit<MediaTextProps, "content"> & { content: SlotComponent }) {
  const { base } = useSite();
  const part = useParts();
  const corners = rounded ? "rounded-lg" : "rounded-none";
  const mediaClass = part(
    "gf-media-text-media",
    "w-full object-cover",
    corners,
    position === "right" && "md:order-last",
  );
  return (
    <div
      className={part(
        "gf-media-text",
        "grid grid-cols-1 gap-6 md:gap-10",
        mediaTextColumns[position][width],
        verticalAlignClasses[align],
        className,
      )}
    >
      {!media ? (
        <div
          className={part(
            "gf-media-text-media",
            "aspect-video w-full bg-muted",
            corners,
            position === "right" && "md:order-last",
          )}
        />
      ) : mediaKind(media) === "video" ? (
        // biome-ignore lint/a11y/useMediaCaption: an uploaded video's captions are the Video block's to add
        <video controls preload="metadata" src={withBase(media, base)} className={mediaClass} />
      ) : (
        <SiteImage src={media} alt={alt} loading="lazy" className={mediaClass} />
      )}
      <Content className={part("gf-media-text-content", "flex flex-col gap-4")} />
    </div>
  );
}

/** A picture or video beside text and other blocks, as WordPress's Media & Text block has. */
export const MediaText: ComponentConfig<MediaTextProps> = withParts(
  {
    label: "Media and text",
    fields: {
      media: mediaField("Picture or video", "file"),
      alt: { type: "text", label: "Description for screen readers" },
      position: { type: "radio", label: "Picture's side", options: options({ left: "Left", right: "Right" }) },
      width: {
        type: "select",
        label: "Picture's width",
        options: options({ third: "A third", half: "Half", "two-thirds": "Two thirds" }),
      },
      align: {
        type: "radio",
        label: "Line up the text with the picture's",
        options: options({ top: "Top", center: "Middle", bottom: "Bottom" }),
      },
      rounded: { type: "radio", label: "Rounded corners", options: yesNo },
      content: { type: "slot" },
      className: classNameField,
    },
    defaultProps: {
      media: "",
      alt: "",
      position: "left",
      width: "half",
      align: "center",
      rounded: true,
      content: [],
      className: "",
    },
    render: (props) => <MediaTextView {...props} />,
  },
  MEDIA_TEXT_PARTS,
);

type GalleryColumns = "2" | "3" | "4";

export interface GalleryImage {
  src: string;
  alt: string;
  caption: string;
}

export interface GalleryProps {
  images: GalleryImage[];
  columns: GalleryColumns;
  /** Crops the pictures to squares, so the rows line up. */
  crop: boolean;
  rounded: boolean;
  caption: string;
  className: string;
}

const galleryColumns: Record<GalleryColumns, string> = {
  "2": "grid-cols-2",
  "3": "grid-cols-2 md:grid-cols-3",
  "4": "grid-cols-2 md:grid-cols-4",
};

/** Pictures in a grid, each with an optional caption, as WordPress's Gallery block shows them. */
export const Gallery: ComponentConfig<GalleryProps> = withParts(
  {
    label: "Gallery",
    fields: {
      images: {
        type: "array",
        label: "Pictures",
        arrayFields: {
          src: mediaField("Picture"),
          alt: { type: "text", label: "Description for screen readers" },
          caption: { type: "text", label: "Caption" },
        },
        defaultItemProps: { src: "", alt: "", caption: "" },
        getItemSummary: (item) => item.caption || item.alt || (item.src ? fileName(item.src) : "Picture"),
      },
      columns: { type: "radio", label: "Columns", options: options({ "2": "2", "3": "3", "4": "4" }) },
      crop: { type: "radio", label: "Crop to squares", options: yesNo },
      rounded: { type: "radio", label: "Rounded corners", options: yesNo },
      caption: { type: "text", label: "Gallery's caption" },
      className: classNameField,
    },
    defaultProps: { images: [], columns: "3", crop: true, rounded: true, caption: "", className: "" },
    render: ({ puck, ...props }) => <GalleryView {...props} isEditing={puck?.isEditing === true} />,
  },
  GALLERY_PARTS,
);

function GalleryView({
  images,
  columns = "3",
  crop,
  rounded,
  caption,
  className,
  isEditing,
}: GalleryProps & { isEditing: boolean }) {
  const part = useParts();
  const shown = (images ?? []).filter((image) => image.src);
  if (shown.length === 0) {
    return isEditing ? <EditorPlaceholder text="Add pictures to the gallery" className={className} /> : null;
  }
  const corners = rounded ? "rounded-lg" : "rounded-none";
  return (
    <figure className={part("gf-gallery", "my-6", className)}>
      <ul className={part("gf-gallery-items", "grid gap-4", galleryColumns[columns])}>
        {shown.map((image, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the same picture can be shown twice
          <li key={`${image.src}-${index}`} className={part("gf-gallery-item")}>
            <figure>
              <SiteImage
                src={image.src}
                alt={image.alt}
                loading="lazy"
                className={part("gf-gallery-picture", "w-full", crop ? "aspect-square object-cover" : "", corners)}
              />
              {image.caption && (
                <figcaption className={part("gf-gallery-item-caption", "mt-1 text-sm text-muted-foreground")}>
                  {image.caption}
                </figcaption>
              )}
            </figure>
          </li>
        ))}
      </ul>
      {caption && (
        <figcaption className={part("gf-gallery-caption", "mt-3 text-center text-sm text-muted-foreground")}>
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
