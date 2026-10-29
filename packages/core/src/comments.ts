/**
 * Visitors' comments, kept as discussions in a public GitHub repository of
 * their own and shown on the site by Giscus: what `content/site.json` says
 * about where they are, and what a backend offers to set that repository up
 * and moderate it from the admin panel (`GitBackend.comments`).
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
