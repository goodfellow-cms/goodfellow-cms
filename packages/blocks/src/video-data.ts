import {
  type EmbedProblem,
  embedPlayerUrl,
  type PlayerOptions,
  vimeoPlayerUrl,
  vimeoVideo,
  youtubePlayerUrl,
  youtubeVideo,
} from "@goodfellow-cms/core";

// What the Video block shows, with no React, so its web and native versions share it.

export type VideoSource = "upload" | "youtube" | "vimeo" | "embed";
export type VideoShape = "auto" | "wide" | "landscape" | "square" | "tall";

export interface VideoProps {
  source: VideoSource;
  /** An uploaded video's address, such as `/media/welcome.mp4`. */
  file: string;
  /** For an uploaded video: the picture shown before it plays, and its captions (a WebVTT file). */
  poster: string;
  captions: string;
  captionsLabel: string;
  /** A YouTube video's ID or any of its addresses. */
  youtube: string;
  /** A Vimeo video's number or any of its addresses. */
  vimeo: string;
  /** Another site's player: its embed address, or the embed code that site gives. */
  embed: string;
  /** What the video is, for screen readers. */
  title: string;
  shape: VideoShape;
  autoplay: boolean;
  muted: boolean;
  loop: boolean;
  caption: string;
  rounded: boolean;
  className: string;
}

export const embedProblems: Record<EmbedProblem, string> = {
  "not-an-address": "Paste the player's embed address, or the embed code the other site gives, starting with https://.",
  "not-secure": "The player's address must start with https://, or browsers won't show it on a secure site.",
  "same-site": "A player on this site's own address, or on this computer, can't be shown: it could reach the editor.",
};

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The player's address, or why there isn't one. `here` is the address the
 * page is shown at, such as the editor's, where no player may be either.
 */
export function playerAddress(
  props: Pick<VideoProps, "source" | "youtube" | "vimeo" | "embed" | "autoplay" | "muted" | "loop">,
  siteUrl: string | undefined,
  here?: string,
): { url: string } | { problem: string } {
  const playback: PlayerOptions = { autoplay: props.autoplay, muted: props.muted, loop: props.loop };
  if (props.source === "youtube") {
    const video = youtubeVideo(props.youtube);
    if (video) return { url: youtubePlayerUrl(video, playback) };
    return {
      problem: props.youtube.trim()
        ? "This isn't a YouTube video's address or ID."
        : "Paste a YouTube video's address.",
    };
  }
  if (props.source === "vimeo") {
    const video = vimeoVideo(props.vimeo);
    if (video) return { url: vimeoPlayerUrl(video, playback) };
    return { problem: props.vimeo.trim() ? "This isn't a Vimeo video's address." : "Paste a Vimeo video's address." };
  }
  // In the editor, the page is the admin panel's own address, which a player mustn't share either.
  const found = embedPlayerUrl(props.embed, [hostOf(siteUrl), here]);
  if ("url" in found) return found;
  return { problem: props.embed.trim() ? embedProblems[found.problem] : "Paste the player's embed address or code." };
}
