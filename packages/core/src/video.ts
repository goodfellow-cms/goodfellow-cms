/**
 * Videos from YouTube, Vimeo and other sites: reading the addresses editors
 * paste, in any of the forms those sites give them, and the addresses of
 * their players.
 */
import { isLoopbackHost } from "./hosts.js";

/** A YouTube video, and where to start it, in seconds. */
export interface YouTubeVideo {
  id: string;
  start?: number;
}

/** A Vimeo video, with the hash an unlisted video's address has, and where to start it. */
export interface VimeoVideo {
  id: string;
  hash?: string;
  start?: number;
}

/** How a player plays: on its own, without sound, and again when it ends. */
export interface PlayerOptions {
  autoplay?: boolean;
  muted?: boolean;
  loop?: boolean;
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtube-nocookie.com",
  "www.youtube-nocookie.com",
]);
const VIMEO_HOSTS = new Set(["vimeo.com", "www.vimeo.com", "player.vimeo.com"]);

/** The address in an embed code (`<iframe src="…">`), or the text itself if it isn't one. */
export function embedSource(input: string): string {
  const text = input.trim();
  const match = /<iframe\b[^>]*?\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(text);
  const src = match ? (match[1] ?? match[2] ?? match[3] ?? "") : text;
  return src.replace(/&amp;/g, "&").trim();
}

function parseUrl(input: string): URL | undefined {
  const text = embedSource(input);
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
}

/** A time such as `90`, `90s`, `1m30s` or `1h2m3s`, in seconds. */
export function parseStartTime(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const text = value.trim().toLowerCase();
  if (/^\d+$/.test(text)) return Number(text) || undefined;
  const match = /^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$/.exec(text);
  if (!match || !text) return undefined;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds || undefined;
}

/**
 * A YouTube video from its ID or any of its addresses: `watch?v=`, `youtu.be`,
 * Shorts, live, embed and mobile addresses, or an embed code. `undefined` if
 * it isn't one.
 */
export function youtubeVideo(input: string): YouTubeVideo | undefined {
  const text = input.trim();
  if (YOUTUBE_ID.test(text)) return { id: text };
  const url = parseUrl(text);
  if (!url) return undefined;
  const host = url.hostname.toLowerCase();
  let id: string | undefined;
  if (host === "youtu.be" || host === "www.youtu.be") {
    id = url.pathname.split("/")[1];
  } else if (YOUTUBE_HOSTS.has(host)) {
    const [first, second] = url.pathname.split("/").filter(Boolean);
    if (first === "watch") id = url.searchParams.get("v") ?? undefined;
    else if (first && ["embed", "shorts", "live", "v", "e"].includes(first)) id = second;
  }
  if (!id || !YOUTUBE_ID.test(id)) return undefined;
  const start = parseStartTime(url.searchParams.get("t") ?? url.searchParams.get("start"));
  return { id, ...(start && { start }) };
}

/**
 * A Vimeo video from its number or any of its addresses: the video's page,
 * an unlisted video's address with its hash, a channel's, group's or
 * showcase's video, the player's address, or an embed code.
 */
export function vimeoVideo(input: string): VimeoVideo | undefined {
  const text = input.trim();
  if (/^\d{3,}$/.test(text)) return { id: text };
  const url = parseUrl(text);
  if (!url || !VIMEO_HOSTS.has(url.hostname.toLowerCase())) return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  const isNumber = (part: string | undefined) => part !== undefined && /^\d{3,}$/.test(part);
  // The number after "video" or "videos", as in a showcase's or the player's address, or else the first one.
  const after = parts.findIndex((part, i) => (part === "video" || part === "videos") && isNumber(parts[i + 1]));
  const index = after !== -1 ? after + 1 : parts.findIndex(isNumber);
  const id = parts[index];
  if (index === -1 || !id) return undefined;
  const following = parts[index + 1];
  const hash = url.searchParams.get("h") ?? (following && /^[0-9a-f]{6,}$/i.test(following) ? following : undefined);
  const start = parseStartTime(/(?:^|&)t=([^&]+)/.exec(url.hash.slice(1))?.[1]);
  return { id, ...(hash && { hash }), ...(start && { start }) };
}

/** The address of YouTube's privacy-enhanced player for a video, which sets no cookies until it's played. */
export function youtubePlayerUrl(video: YouTubeVideo, options: PlayerOptions = {}): string {
  const params = new URLSearchParams({ rel: "0" });
  if (video.start) params.set("start", String(video.start));
  if (options.autoplay) params.set("autoplay", "1");
  if (options.muted || options.autoplay) params.set("mute", "1");
  if (options.loop) {
    // YouTube only loops a playlist, so the video is a playlist of one.
    params.set("loop", "1");
    params.set("playlist", video.id);
  }
  return `https://www.youtube-nocookie.com/embed/${video.id}?${params}`;
}

/** The address of Vimeo's player for a video, with "do not track" on. */
export function vimeoPlayerUrl(video: VimeoVideo, options: PlayerOptions = {}): string {
  const params = new URLSearchParams();
  if (video.hash) params.set("h", video.hash);
  params.set("dnt", "1");
  if (options.autoplay) params.set("autoplay", "1");
  if (options.muted || options.autoplay) params.set("muted", "1");
  if (options.loop) params.set("loop", "1");
  return `https://player.vimeo.com/video/${video.id}?${params}${video.start ? `#t=${video.start}s` : ""}`;
}

/** Why another site's player can't be shown, in plain words. */
export type EmbedProblem = "not-an-address" | "not-secure" | "same-site";

/**
 * Another site's player, from its embed address or the embed code that site
 * gives. Only `https://` addresses on other sites are shown, since the player
 * runs with that site's own access: one on the site's own address, or on this
 * computer, could reach the admin panel's.
 */
export function embedPlayerUrl(
  input: string,
  ownHosts: Array<string | undefined> = [],
): { url: string } | { problem: EmbedProblem } {
  const source = embedSource(input);
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return { problem: "not-an-address" };
  }
  if (url.protocol !== "https:") return { problem: url.protocol === "http:" ? "not-secure" : "not-an-address" };
  const host = url.hostname.toLowerCase();
  const own = ownHosts.filter(Boolean).map((candidate) => (candidate as string).toLowerCase());
  if (isLoopbackHost(host) || own.includes(host)) return { problem: "same-site" };
  return { url: url.href };
}
