import {
  blueskyPostUrl,
  EMBED_SITE_NAMES,
  type EmbeddedPost,
  type EmbedPostProblem,
  embeddedPost,
} from "@goodfellow-cms/core";

// What the Embed block shows, with no React, so its web and native versions share it.

export interface EmbedProps {
  /** The post's address, or the embed code its site gives. */
  post: string;
  /** What the post is, for screen readers. Empty for "Post on <site>". */
  title: string;
  /** How tall the frame is, in pixels; 0 for the height the site's embed usually has. */
  height: number;
  caption: string;
  className: string;
  /**
   * A Bluesky author's DID, looked up from their handle where pages are built,
   * since Bluesky's embed needs it and the editor can't ask Bluesky.
   */
  blueskyDid?: string;
}

export const embedProblems: Record<EmbedPostProblem, string> = {
  "not-an-address": "Paste the post's address, or the embed code its site gives.",
  "unknown-site":
    "This block shows posts from Bluesky, Mastodon, Instagram, X, Spotify and SoundCloud. For other sites' players, use the Video block.",
  "short-link": "Short links can't be followed here. Open the link and paste the address it goes to.",
  "same-site": "A post on this site's own address, or on this computer, can't be shown: it could reach the editor.",
  handle:
    "Bluesky's embed is looked up when the site is built. To see the post here too, paste the embed code from Embed post in the post's menu.",
};

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).hostname : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The post to show, or why there isn't one. `here` is the address the page is
 * shown at, such as the editor's, where no embed may be either.
 */
export function shownPost(
  props: Pick<EmbedProps, "post" | "blueskyDid">,
  siteUrl: string | undefined,
  here?: string,
): { post: EmbeddedPost } | { problem: EmbedPostProblem; link?: string } {
  const found = embeddedPost(props.post, [hostOf(siteUrl), here]);
  if ("post" in found) return found;
  if (found.problem === "handle") {
    if (props.blueskyDid)
      return {
        post: {
          site: "bluesky",
          url: blueskyPostUrl(props.blueskyDid, found.bluesky.post),
          link: found.link,
          height: 400,
        },
      };
    return { problem: "handle", link: found.link };
  }
  return found;
}

/** The frame's name for screen readers. */
export function embedTitle(props: Pick<EmbedProps, "title">, post: EmbeddedPost): string {
  return props.title.trim() || `Post on ${EMBED_SITE_NAMES[post.site]}`;
}

/** The frame's height, in pixels. */
export function embedHeight(props: Pick<EmbedProps, "height">, post: EmbeddedPost): number {
  const height = Number(props.height);
  return Number.isFinite(height) && height >= 80 ? Math.min(Math.round(height), 2000) : post.height;
}

/** Players fill the width; posts are as wide as their sites draw them. */
export function isPlayer(post: EmbeddedPost): boolean {
  return post.site === "spotify" || post.site === "soundcloud";
}

const DID_CACHE = new Map<string, Promise<string | undefined>>();

/**
 * A Bluesky handle's DID, from Bluesky's public API, once a build. Problems
 * are printed, and leave the post shown as a link.
 */
export function blueskyDid(handle: string, fetcher: typeof fetch = fetch): Promise<string | undefined> {
  const key = handle.toLowerCase();
  const cached = DID_CACHE.get(key);
  if (cached) return cached;
  const did = (async () => {
    try {
      const response = await fetcher(
        `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?${new URLSearchParams({ handle: key })}`,
        { signal: AbortSignal.timeout(20_000) },
      );
      if (!response.ok) throw new Error(`Bluesky answered ${response.status}.`);
      const body = (await response.json()) as { did?: unknown };
      if (typeof body.did !== "string" || !/^did:(plc|web):[A-Za-z0-9.:-]+$/.test(body.did)) {
        throw new Error("Bluesky didn't say who it is.");
      }
      return body.did;
    } catch (error) {
      console.warn(
        `The Bluesky post by ${handle} couldn't be looked up, so the page links to it instead: ${(error as Error).message}`,
      );
      DID_CACHE.delete(key);
      return undefined;
    }
  })();
  DID_CACHE.set(key, did);
  return did;
}
