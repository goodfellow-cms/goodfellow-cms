/**
 * The people who can edit a site, as a backend's optional `editors`
 * capability, and the owner token some hosts need to change them.
 */

import type { RedirectOptions, TokenLink } from "./git.js";

/**
 * What someone can do: `owner`s can also invite and remove editors and change
 * settings such as the domain; `editor`s edit and publish; `viewer`s can see
 * the site's files but not publish, such as people the host gave a lesser role.
 */
export type EditorRole = "owner" | "editor" | "viewer";

/** Someone who can edit the site, or has been invited to. */
export interface SiteEditor {
  /** The host's id for them, which `setRole()` and `remove()` use. */
  id: string;
  /** Their account name, if they have an account. */
  login?: string;
  name?: string;
  /** For an invitation sent by email. */
  email?: string;
  avatarUrl?: string;
  role: EditorRole;
  /** Invited, but hasn't accepted yet. */
  invited?: boolean;
  /** Has access through something other than this site, such as a group, so it can't be changed here. */
  inherited?: boolean;
  /** The person signed in. */
  self?: boolean;
}

export interface EditorList {
  editors: SiteEditor[];
  /**
   * Whether this sign-in can change who edits the site: `yes`; `token` when it
   * can once an owner token is in use (see `OwnerAccess`); `no` when only owners can.
   */
  manage: "yes" | "token" | "no";
  /**
   * Whether editors can publish. Some hosts protect the main branch so only
   * owners can publish to it; `letEditorsPublish()` changes that.
   */
  editorsCanPublish: boolean;
}

/** A git host's editors of a site. */
export interface SiteEditors {
  /** Whether invitations can go to an email address, and not only to an account name. */
  readonly invitesByEmail: boolean;
  list(): Promise<EditorList>;
  /** Invites someone by account name, or email address where `invitesByEmail`. */
  invite(who: string, role: Exclude<EditorRole, "viewer">): Promise<void>;
  setRole(editor: SiteEditor, role: Exclude<EditorRole, "viewer">): Promise<void>;
  /** Removes someone, or withdraws their invitation. */
  remove(editor: SiteEditor): Promise<void>;
  /** Lets editors publish to the main branch, where only owners could. Only where the host needs it. */
  letEditorsPublish?(): Promise<void>;
}

/**
 * For hosts whose sign-in can't change who edits the site or its Pages
 * settings, a second token that can, used for one tab only: it's kept in
 * memory, never stored, and forgotten on sign-out or when the tab closes.
 */
export interface OwnerAccess {
  /** Where to create the token, with its permissions filled in. */
  readonly tokenLink: TokenLink;
  /** Whether an owner token is in use. */
  readonly active: boolean;
  /** Checks the token and uses it for editors and Pages settings. Throws `EditorsError` if it can't manage the site. */
  applyToken(token: string): Promise<void>;
  forget(): void;
  /**
   * Signs in as an owner instead of pasting a token, where the host can: goes
   * to the host and comes back to this screen. Throws `SignInError` if it can't start.
   */
  startRedirect?(options?: RedirectOptions): Promise<void>;
  /**
   * Asks for the owner token in the token broker's own page, which keeps it,
   * in place of a field in the admin panel. Present only through a broker,
   * which offers it instead of `applyToken()`.
   */
  requestToken?(): Promise<void>;
  /** Why the last owner sign-in didn't work, if it didn't, such as a `SignInError`. */
  readonly problem?: unknown;
}

/** Why a change to the site's editors didn't work, in a form the admin panel turns into plain words. */
export type EditorsProblem =
  /** This sign-in, or the owner token, can't change who edits the site. */
  | "not-allowed"
  /** No account has that name. */
  | "not-found"
  /** It isn't an account name or email address the host accepts. */
  | "invalid"
  /** They already edit the site, or have been invited. */
  | "already";

export class EditorsError extends Error {
  override name = "EditorsError";
  constructor(
    readonly problem: EditorsProblem,
    message: string,
  ) {
    super(message);
  }
}
