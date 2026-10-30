/**
 * Visitors' comments, kept as discussions in a public GitHub repository of
 * their own and shown on the site by Giscus, or kept by Disqus, or by the
 * site owner's own Garrul, on Cloudflare: what
 * `content/site.json` says about where they are, and what a backend offers to
 * set that repository up and moderate it from the admin panel
 * (`GitBackend.comments`).
 */
import type { TokenLink } from "./git.js";

/** Where a site's comments are kept, as Giscus needs it: the repository, and the discussions' category. */
export interface CommentsPlace {
  /** `owner/name`. */
  repo: string;
  /** GitHub's node id for the repository. */
  repoId: string;
  /** The category's name, such as Announcements. */
  category: string;
  /** GitHub's node id for the category. */
  categoryId: string;
}

/** Comments kept by Disqus, for the site Disqus knows by its shortname. */
export interface DisqusPlace {
  /** The Disqus site's shortname, such as `stjoseph`, which its address starts with. */
  disqus: string;
}

/** Comments kept by Garrul, which the site's owner runs as a Cloudflare Worker of their own. */
export interface GarrulPlace {
  /** The Worker's origin, such as `https://comments.example.org`, which serves its script, API and admin pages. */
  garrul: string;
}

/** What `content/site.json`'s `comments` says: Giscus's repository and category, Disqus's site, or Garrul's address. */
export type SiteCommentsPlace = CommentsPlace | DisqusPlace | GarrulPlace;

export function isDisqus(place: SiteCommentsPlace): place is DisqusPlace {
  return "disqus" in place;
}

export function isGarrul(place: SiteCommentsPlace): place is GarrulPlace {
  return "garrul" in place;
}

/** A Disqus site's shortname: lowercase letters, numbers and hyphens. */
export const DISQUS_SHORTNAME = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

/**
 * The shortname in what an owner pasted: Disqus's code (which loads
 * `https://<shortname>.disqus.com/embed.js`), an address on the site's Disqus
 * pages, or the shortname itself.
 */
export function disqusShortname(text: string): string | undefined {
  const trimmed = text.trim();
  const named = /(?:^|[/"'\s])(?:https?:)?(?:\/\/)?([a-z0-9-]+)\.disqus\.com(?=[/"'\s?#]|$)/i.exec(trimmed)?.[1];
  if (!named && /[^A-Za-z0-9-]/.test(trimmed)) return undefined;
  const shortname = (named ?? trimmed).toLowerCase();
  return DISQUS_SHORTNAME.test(shortname) && shortname !== "www" ? shortname : undefined;
}

/** Disqus's script for a site, which shows its comments in the `#disqus_thread` element. */
export function disqusEmbedUrl(shortname: string): string {
  return `https://${shortname}.disqus.com/embed.js`;
}

/** Where a Disqus site's moderators approve, hide and delete comments. */
export function disqusModerationUrl(shortname: string): string {
  return `https://${shortname}.disqus.com/admin/moderate/`;
}

/** Where to make a site on Disqus. */
export const DISQUS_CREATE_URL = "https://disqus.com/admin/create/";

/** Garrul's own instructions, for setting up its Worker. */
export const GARRUL_URL = "https://github.com/KingPin/Garrul";

/**
 * A Garrul Worker's origin, from its address or the code Garrul gives (its
 * `data-api`, else its script's address): `https://`, or `http://` only for
 * this computer, where Garrul's development server runs. Never Disqus's,
 * whose code also loads an `embed.js`.
 */
export function garrulAddress(text: string): string | undefined {
  const trimmed = text.trim();
  const named =
    /\sdata-api\s*=\s*["']([^"'<>\s]+)["']/i.exec(trimmed)?.[1] ??
    /\ssrc\s*=\s*["']([^"'<>\s]+)\/embed\.js["']/i.exec(trimmed)?.[1] ??
    (/^[^\s<>"']+$/.test(trimmed) ? trimmed : undefined);
  if (!named) return undefined;
  let url: URL;
  try {
    url = new URL(named);
  } catch {
    return undefined;
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return undefined;
  // An address with a sign-in in it, such as `https://user:pass@…`, is never one to load scripts from.
  if (/^[a-z]+:\/\/[^/]*@/i.test(named) || /(^|\.)disqus\.com$/i.test(url.hostname)) return undefined;
  return url.origin;
}

/** Garrul's script, which shows its comments in the `#garrul` element. */
export function garrulEmbedUrl(origin: string): string {
  return `${origin}/embed.js`;
}

/** Where Garrul's moderators approve, hide and delete comments: its queue of those waiting. */
export function garrulModerationUrl(origin: string): string {
  return `${origin}/admin/queue?status=pending`;
}

/** What Garrul knows a page's comments by: its address, in the letters Garrul's threads' names may have. */
export function garrulSlug(path: string): string {
  const slug = path.replace(/[^a-zA-Z0-9_\-./]/g, "-").slice(0, 200);
  return slug || "/";
}

/** The repository's own name, and its owner's. */
export const COMMENTS_REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/;
/** GitHub's node ids, such as `R_kgDOabc123` and `DIC_kwDOabc123`. */
export const COMMENTS_ID = /^[A-Za-z0-9_-]+$/;

/** A comments repository the admin panel has found or made, with what the steps after it need. */
export interface CommentsRepository extends CommentsPlace {
  /** The repository's page on GitHub. */
  webUrl: string;
  /** Where to install Giscus's app on the repository, so it can start each page's discussion. */
  installUrl: string;
}

/** Why a comment is hidden, which GitHub shows in its place. */
export const HIDE_REASONS = ["spam", "abuse", "off-topic"] as const;
export type HideReason = (typeof HIDE_REASONS)[number];

/** One visitor's comment, or a reply to one. */
export interface SiteComment {
  id: string;
  author: { login: string; url: string; avatarUrl?: string };
  /** What it says, as plain text. */
  text: string;
  /** When it was written, as an ISO date and time. */
  createdAt: string;
  /** Its page on GitHub. */
  url: string;
  /** Hidden by a moderator, and why, where GitHub says. */
  hidden: boolean;
  hiddenReason?: string;
  replies: SiteComment[];
}

/** A page's comments: its discussion. */
export interface CommentThread {
  id: string;
  /** What Giscus names the discussion: the page's address, without the first slash. */
  title: string;
  url: string;
  locked: boolean;
  /** When anything in it last changed. */
  updatedAt: string;
  comments: SiteComment[];
}

/** One page of `SiteComments.threads()`, newest first. */
export interface CommentThreads {
  threads: CommentThread[];
  /** Pass it back for the next page, where there is one. */
  next?: string;
}

/**
 * A token for the comments' repository, where the site's own sign-in can't
 * reach it, such as the sign-in service's, which reaches only the site's.
 * Kept in memory only, and forgotten on signing out.
 */
export interface CommentsAccess {
  /** Where to create the token, with what it needs filled in. */
  readonly tokenLink: TokenLink;
  /** Whether a token of its own is in use. */
  readonly active: boolean;
  /** Checks the token and uses it for comments. Throws `CommentsError` if GitHub doesn't accept it. */
  applyToken(token: string): Promise<void>;
  forget(): void;
  /** Asks for the token in the token broker's own page, which keeps it. Present only through a broker. */
  requestToken?(): Promise<void>;
}

/**
 * Setting up and moderating a site's comments from the admin panel. Comments
 * are GitHub Discussions, so only the GitHub backend has it; elsewhere it's
 * set up and moderated on GitHub itself.
 */
export interface SiteComments {
  readonly access: CommentsAccess;
  /**
   * Makes a public repository for comments beside the site's repository, with
   * Discussions turned on, and finds its category for announcements, which
   * only Giscus and the repository's owners can start discussions in.
   */
  create(name: string, description: string): Promise<CommentsRepository>;
  /** An existing public repository, `owner/name`, with Discussions turned on where the sign-in may. */
  find(repo: string): Promise<CommentsRepository>;
  /** Pages' discussions in the place's category, those changed most recently first. */
  threads(place: CommentsPlace, next?: string): Promise<CommentThreads>;
  hide(commentId: string, reason: HideReason): Promise<void>;
  show(commentId: string): Promise<void>;
  remove(commentId: string): Promise<void>;
  /** Stops anyone adding comments to a page's discussion, or lets them again. */
  lock(threadId: string): Promise<void>;
  unlock(threadId: string): Promise<void>;
}

/** Why comments couldn't be set up or moderated, in a form the admin panel turns into plain words. */
export type CommentsProblem =
  /** The sign-in, or the comments token, can't reach the repository or do this there. */
  | "no-access"
  /** There's no repository with that name, or the sign-in can't see it. */
  | "not-found"
  /** The repository is private, so visitors couldn't read its comments. */
  | "not-public"
  /** There's already a repository with that name. */
  | "name-taken"
  /** The name can't be a repository's. */
  | "name-invalid"
  /** Discussions are off, and the sign-in can't turn them on. */
  | "no-discussions"
  /** Discussions have no categories yet, which GitHub makes the first time someone opens them. */
  | "no-category";

export class CommentsError extends Error {
  override name = "CommentsError";
  constructor(
    readonly problem: CommentsProblem,
    message: string,
    /** Where on GitHub to fix it, where there's a page for it. */
    readonly link?: string,
  ) {
    super(message);
  }
}

/** Giscus's GitHub App, which starts each page's discussion and posts visitors' comments. */
export const GISCUS_APP_URL = "https://github.com/apps/giscus";
