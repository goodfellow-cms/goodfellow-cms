/**
 * Posts and players from social sites, read from the address of a post or the
 * embed code its site gives, into the address of that site's own embed page,
 * with no request to any of them: Bluesky, Mastodon, Instagram, X, Spotify and
 * SoundCloud.
 */

import { isLoopbackHost } from "./hosts.js";
import { embedSource } from "./video.js";

/** The sites whose posts the Embed block shows. */
export const EMBED_SITES = ["bluesky", "mastodon", "instagram", "x", "spotify", "soundcloud"] as const;
export type EmbedSite = (typeof EMBED_SITES)[number];

/** Each site's name, as people know it. */
export const EMBED_SITE_NAMES: Record<EmbedSite, string> = {
  bluesky: "Bluesky",
  mastodon: "Mastodon",
  instagram: "Instagram",
  x: "X (Twitter)",
  spotify: "Spotify",
  soundcloud: "SoundCloud",
};

/** A post, ready to show. */
export interface EmbeddedPost {
  site: EmbedSite;
  /** The address of the site's embed page, shown in a frame. */
  url: string;
  /** The post's own page, for a link where the frame isn't shown. */
  link: string;
  /** How tall the site's embed usually is, in pixels, since frames can't size themselves without a script. */
  height: number;
}

/**
 * Why a post can't be shown: not an address; a site the block doesn't know;
 * a short link (`spotify.link`, `on.soundcloud.com`), which only the site can
 * follow; an address on the site's own address or this computer; or a Bluesky
 * post by its author's handle, whose embed needs the author's DID (`handle`).
 */
export type EmbedPostProblem = "not-an-address" | "unknown-site" | "short-link" | "same-site" | "handle";

/** A Bluesky post by its author's handle, which `blueskyPostUrl()` turns into an embed once it's resolved. */
export interface BlueskyHandlePost {
  handle: string;
  post: string;
}

export type EmbedPostResult =
  | { post: EmbeddedPost }
  | { problem: Exclude<EmbedPostProblem, "handle"> }
  | { problem: "handle"; bluesky: BlueskyHandlePost; link: string };

const RECORD_KEY = /^[A-Za-z0-9._:~-]{1,512}$/;
const DID = /^did:(plc:[a-z2-7]{24}|web:[a-z0-9.-]+)$/i;
const SHORT_LINKS = new Set(["spotify.link", "on.soundcloud.com", "t.co", "instagr.am"]);

function decodeEntities(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/**
 * The addresses in what an editor pasted, best first: what a site's embed code
 * says the post is (Bluesky's `data-bluesky-uri`, Mastodon's `data-embed-url`,
 * Instagram's `data-instgrm-permalink`), a frame's `src`, then every address in
 * the text, such as the post's link at the end of X's embed code.
 */
function candidates(input: string): string[] {
  const text = decodeEntities(input.trim());
  const found: string[] = [];
  for (const attribute of ["data-bluesky-uri", "data-embed-url", "data-instgrm-permalink"]) {
    const match = new RegExp(`${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(text);
    const value = match?.[1] ?? match?.[2];
    if (value) found.push(value.trim());
  }
  if (/<iframe\b/i.test(text)) found.push(embedSource(text));
  if (!/[<\s]/.test(text)) found.push(text);
  for (const match of text.matchAll(/https?:\/\/[^\s"'<>]+/gi)) {
    // X's embed code links the author first and the post last.
    found.push(match[0]);
  }
  return [...new Set(found)];
}

function parse(text: string): URL | undefined {
  try {
    return new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
  } catch {
    return undefined;
  }
}

/** The address of Bluesky's embed page for a post, by its author's DID and the post's record key. */
export function blueskyPostUrl(did: string, post: string): string {
  return `https://embed.bsky.app/embed/${did}/app.bsky.feed.post/${post}`;
}

/** A Bluesky post's `at://<author>/app.bsky.feed.post/<post>` address, as its embed code gives it. */
function blueskyAtUri(text: string): EmbedPostResult | undefined {
  const match = /^at:\/\/([^/\s]+)\/app\.bsky\.feed\.post\/([^/?#\s]+)$/i.exec(text.trim());
  if (!match?.[1] || !match[2] || !RECORD_KEY.test(match[2])) return undefined;
  return blueskyPost(match[1], match[2]);
}

function blueskyPost(author: string, post: string): EmbedPostResult {
  const link = `https://bsky.app/profile/${author}/post/${post}`;
  if (!DID.test(author)) return { problem: "handle", bluesky: { handle: author.toLowerCase(), post }, link };
  return { post: { site: "bluesky", url: blueskyPostUrl(author, post), link, height: 400 } };
}

function bluesky(url: URL): EmbedPostResult | undefined {
  const host = url.hostname.toLowerCase();
  if (host === "embed.bsky.app") {
    const [embed, did, collection, post] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
    if (embed !== "embed" || !did || !DID.test(did) || collection !== "app.bsky.feed.post") return undefined;
    return post && RECORD_KEY.test(post) ? blueskyPost(did, post) : undefined;
  }
  if (host !== "bsky.app" && host !== "www.bsky.app") return undefined;
  const [profile, author, kind, post] = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  if (profile !== "profile" || !author || kind !== "post" || !post || !RECORD_KEY.test(post)) return undefined;
  return blueskyPost(author, post);
}

function instagram(url: URL): EmbedPostResult | undefined {
  const host = url.hostname.toLowerCase();
  if (host !== "instagram.com" && host !== "www.instagram.com") return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  // Posts are /p/<code>, reels /reel/<code> or /reels/<code>, and either may follow the author's name.
  const index = parts.findIndex((part) => ["p", "reel", "reels", "tv"].includes(part));
  const code = index === -1 ? undefined : parts[index + 1];
  if (!code || !/^[A-Za-z0-9_-]{5,}$/.test(code)) return undefined;
  const kind = parts[index] === "p" ? "p" : "reel";
  const link = `https://www.instagram.com/${kind}/${code}/`;
  return { post: { site: "instagram", url: `${link}embed/captioned/`, link, height: 640 } };
}

function x(url: URL): EmbedPostResult | undefined {
  const host = url.hostname.toLowerCase().replace(/^(www|mobile)\./, "");
  if (host === "platform.twitter.com") {
    const id = url.searchParams.get("id");
    if (!id || !/^\d{1,25}$/.test(id)) return undefined;
    return { post: { site: "x", url: xPostUrl(id), link: `https://x.com/i/status/${id}`, height: 560 } };
  }
  if (host !== "x.com" && host !== "twitter.com") return undefined;
  const parts = url.pathname.split("/").filter(Boolean);
  const index = parts.indexOf("status");
  const id = index === -1 ? undefined : parts[index + 1];
  if (!id || !/^\d{1,25}$/.test(id)) return undefined;
  const author = index > 0 ? parts[index - 1] : "i";
  return { post: { site: "x", url: xPostUrl(id), link: `https://x.com/${author}/status/${id}`, height: 560 } };
}

/** X's embed page for a post, with "do not track" on, which needs no script on the page. */
function xPostUrl(id: string): string {
  return `https://platform.twitter.com/embed/Tweet.html?id=${id}&dnt=true`;
}

const SPOTIFY_KINDS = new Set(["track", "album", "playlist", "episode", "show", "artist"]);

function spotify(url: URL): EmbedPostResult | undefined {
  if (url.hostname.toLowerCase() !== "open.spotify.com") return undefined;
  const parts = url.pathname.split("/").filter((part) => part && !part.startsWith("intl-"));
  if (parts[0] === "embed") parts.shift();
  const [kind, id] = parts;
  if (!kind || !SPOTIFY_KINDS.has(kind) || !id || !/^[A-Za-z0-9]{10,40}$/.test(id)) return undefined;
  const height = kind === "track" || kind === "episode" ? 152 : 352;
  return {
    post: {
      site: "spotify",
      url: `https://open.spotify.com/embed/${kind}/${id}`,
      link: `https://open.spotify.com/${kind}/${id}`,
      height,
    },
  };
}

function soundcloud(url: URL): EmbedPostResult | undefined {
  const host = url.hostname.toLowerCase();
  let page: URL | undefined = url;
  if (host === "w.soundcloud.com") {
    const inner = url.searchParams.get("url");
    page = inner ? parse(inner) : undefined;
    // The player can name a track by the API's address, which is a track too.
    if (page?.hostname === "api.soundcloud.com") {
      const id = /^\/(tracks|playlists|users)\/(\d+)$/.exec(page.pathname);
      if (!id) return undefined;
      return {
        post: {
          site: "soundcloud",
          url: soundcloudPlayerUrl(page.href),
          link: page.href,
          height: id[1] === "tracks" ? 166 : 450,
        },
      };
    }
  } else if (host !== "soundcloud.com" && host !== "www.soundcloud.com" && host !== "m.soundcloud.com") {
    return undefined;
  }
  if (!page || !/^(www\.|m\.)?soundcloud\.com$/i.test(page.hostname)) return undefined;
  const parts = page.pathname.split("/").filter(Boolean);
  if (parts.length === 0 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part))) return undefined;
  const link = `https://soundcloud.com/${parts.join("/")}`;
  // A track is /<artist>/<track>; an artist alone, or a set (/<artist>/sets/<set>), plays as a list.
  const isTrack = parts.length === 2 && parts[1] !== "sets";
  return { post: { site: "soundcloud", url: soundcloudPlayerUrl(link), link, height: isTrack ? 166 : 450 } };
}

function soundcloudPlayerUrl(page: string): string {
  return `https://w.soundcloud.com/player/?${new URLSearchParams({ url: page, visual: "false", show_teaser: "false" })}`;
}

/**
 * A Mastodon post (or one from a server that works like Mastodon's), on any
 * server: `/@<name>/<number>`, `/users/<name>/statuses/<number>`, or its
 * `/embed` page.
 */
function mastodon(url: URL): EmbedPostResult | undefined {
  const parts = url.pathname.split("/").filter(Boolean);
  let author: string | undefined;
  let id: string | undefined;
  if (parts[0]?.startsWith("@") && parts.length >= 2) {
    author = parts[0].slice(1);
    id = parts[1];
  } else if (parts[0] === "users" && parts[2] === "statuses") {
    author = parts[1];
    id = parts[3];
  }
  if (!author || !/^[A-Za-z0-9_.-]+$/.test(author) || !id || !/^\d{1,25}$/.test(id)) return undefined;
  const link = `https://${url.origin.replace(/^https?:\/\//, "")}/@${author}/${id}`;
  return { post: { site: "mastodon", url: `${link}/embed`, link, height: 400 } };
}

const READERS = [bluesky, instagram, x, spotify, soundcloud, mastodon];

/**
 * A post from its address or the embed code its site gives. `ownHosts` are the
 * site's own host names, and in the editor the admin panel's, where no embed
 * may be: it would run with their access.
 */
export function embeddedPost(input: string, ownHosts: Array<string | undefined> = []): EmbedPostResult {
  const own = ownHosts.filter(Boolean).map((host) => (host as string).toLowerCase());
  let sawAddress = false;
  let problem: Exclude<EmbedPostProblem, "handle"> = "not-an-address";
  for (const candidate of candidates(input)) {
    const atUri = blueskyAtUri(candidate);
    if (atUri) return atUri;
    const url = parse(candidate);
    if (!url || !["https:", "http:"].includes(url.protocol)) continue;
    sawAddress = true;
    const host = url.hostname.toLowerCase();
    if (isLoopbackHost(host) || own.includes(host)) {
      problem = "same-site";
      continue;
    }
    if (SHORT_LINKS.has(host)) {
      problem = "short-link";
      continue;
    }
    // Every site here answers at https://, which is the only address a secure page can show.
    const secure = url.protocol === "http:" ? parse(url.href.replace(/^http:/i, "https:")) : url;
    for (const read of READERS) {
      const found = secure && read(secure);
      if (found) return found;
    }
    if (problem === "not-an-address") problem = "unknown-site";
  }
  return { problem: sawAddress ? problem : "not-an-address" };
}
