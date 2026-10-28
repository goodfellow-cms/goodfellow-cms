import { withBase } from "@goodfellow-cms/core";
import { classNameField, cx, mediaField, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, Fields } from "@puckeditor/core";
import type { ReactNode } from "react";
import { options, yesNo } from "./options.js";
import { VIDEO_PARTS } from "./parts.js";
import { playerAddress, type VideoProps, type VideoShape, type VideoSource } from "./video-data.js";

export type { VideoProps } from "./video-data.js";

/** Players' shapes. An uploaded video's own shape is its own; players have none, so they're wide. */
const shapeClasses: Record<VideoShape, string> = {
  auto: "aspect-video",
  wide: "aspect-video",
  landscape: "aspect-[4/3]",
  square: "aspect-square",
  tall: "mx-auto aspect-[9/16] max-w-sm",
};

/** What players may do: play, go full screen, picture-in-picture. */
const ALLOW =
  "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen";

/**
 * Another site's player gets only what players need. With scripts and its own
 * site's storage, it can't reach this one's, since it's never on this site's
 * address (see `embedPlayerUrl()`).
 */
const EMBED_SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";

function Notice({ text, className }: { text: string; className: string }) {
  return (
    <p className={cx("rounded-md border border-dashed border-border p-4 text-muted-foreground", className)}>{text}</p>
  );
}

function VideoView({ isEditing, ...props }: VideoProps & { isEditing: boolean }) {
  const { settings, base } = useSite();
  const { source, shape, caption, rounded, className } = props;
  const part = useParts();
  // Square corners are a choice, so they win over a theme's rounded ones.
  const corners = rounded ? "rounded-lg" : "rounded-none";

  let player: ReactNode;
  if (source === "upload") {
    if (!props.file)
      return isEditing ? <Notice text="Choose a video from the media library." className={className} /> : null;
    player = (
      <video
        className={cx("block w-full", shape !== "auto" && "absolute inset-0 h-full object-contain")}
        src={withBase(props.file, base)}
        {...(props.poster && { poster: withBase(props.poster, base) })}
        {...(props.title && { "aria-label": props.title })}
        controls
        preload="metadata"
        playsInline
        autoPlay={props.autoplay}
        // Browsers only play videos on their own without sound.
        muted={props.muted || props.autoplay}
        loop={props.loop}
      >
        {props.captions && (
          <track
            kind="captions"
            src={withBase(props.captions, base)}
            srcLang={settings.language}
            label={props.captionsLabel || settings.language}
            default
          />
        )}
      </video>
    );
  } else {
    const address = playerAddress(
      props,
      settings.url,
      typeof window === "undefined" ? undefined : window.location.hostname,
    );
    if ("problem" in address) return isEditing ? <Notice text={address.problem} className={className} /> : null;
    player = (
      <iframe
        className="absolute inset-0 h-full w-full border-0"
        src={address.url}
        title={props.title || "Video"}
        loading="lazy"
        allow={ALLOW}
        allowFullScreen
        // YouTube's player refuses to play without the page's address.
        referrerPolicy="strict-origin-when-cross-origin"
        {...(source === "embed" && { sandbox: EMBED_SANDBOX })}
      />
    );
  }

  return (
    <figure className={part("gf-video", undefined, className)}>
      <div
        className={part(
          "gf-video-player",
          "relative w-full overflow-hidden bg-muted",
          (source !== "upload" || shape !== "auto") && shapeClasses[shape],
          corners,
        )}
      >
        {player}
      </div>
      {caption && (
        <figcaption className={part("gf-video-caption", "mt-2 text-sm text-muted-foreground")}>{caption}</figcaption>
      )}
    </figure>
  );
}

const videoFields: Fields<VideoProps> = {
  source: {
    type: "select",
    label: "Video from",
    options: options({
      upload: "The media library",
      youtube: "YouTube",
      vimeo: "Vimeo",
      embed: "Another site's player",
    }),
  },
  file: mediaField("Video (MP4 or WebM, up to 25 MB)", "video"),
  youtube: { type: "text", label: "The YouTube video's address, or its ID" },
  vimeo: { type: "text", label: "The Vimeo video's address" },
  embed: { type: "textarea", label: "The player's embed address, or the embed code the other site gives" },
  title: { type: "text", label: "What the video is, for screen readers" },
  poster: mediaField("Picture shown before it plays"),
  captions: mediaField("Captions (a WebVTT file)", "file"),
  captionsLabel: { type: "text", label: "Captions' name in the player's menu" },
  shape: {
    type: "select",
    label: "Shape",
    options: options({
      auto: "The video's own (wide for players)",
      wide: "Wide (16:9)",
      landscape: "Landscape (4:3)",
      square: "Square",
      tall: "Tall (9:16), as for phones",
    }),
  },
  autoplay: { type: "radio", label: "Plays on its own, without sound", options: yesNo },
  muted: { type: "radio", label: "Sound off at first", options: yesNo },
  loop: { type: "radio", label: "Plays again when it ends", options: yesNo },
  caption: { type: "text", label: "Caption" },
  rounded: { type: "radio", label: "Rounded corners", options: yesNo },
  className: classNameField,
};

/** A video: one uploaded to the media library, or from YouTube, Vimeo or another site's player. */
export const Video: ComponentConfig<VideoProps> = withParts(
  {
    label: "Video",
    fields: videoFields,
    defaultProps: {
      source: "youtube",
      file: "",
      poster: "",
      captions: "",
      captionsLabel: "",
      youtube: "",
      vimeo: "",
      embed: "",
      title: "",
      shape: "auto",
      autoplay: false,
      muted: false,
      loop: false,
      caption: "",
      rounded: true,
      className: "",
    },
    resolveFields: ({ props }, { fields }) => {
      const resolved: Partial<Fields<VideoProps>> = { ...fields };
      const keep: Record<VideoSource, Array<keyof VideoProps>> = {
        upload: ["file", "poster", "captions", "captionsLabel"],
        youtube: ["youtube"],
        vimeo: ["vimeo"],
        embed: ["embed"],
      };
      for (const [source, names] of Object.entries(keep) as Array<[VideoSource, Array<keyof VideoProps>]>) {
        if (source !== props.source) for (const name of names) delete resolved[name];
      }
      if (props.source === "upload" && !props.captions) delete resolved.captionsLabel;
      // Other sites' players have their own settings, in their embed address.
      if (props.source === "embed") {
        delete resolved.autoplay;
        delete resolved.muted;
        delete resolved.loop;
      }
      return resolved as Fields<VideoProps>;
    },
    render: ({ puck, ...props }) => <VideoView {...props} isEditing={puck.isEditing} />,
  },
  VIDEO_PARTS,
);
