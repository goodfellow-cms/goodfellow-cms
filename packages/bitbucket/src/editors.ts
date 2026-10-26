import {
  type EditorList,
  type EditorRole,
  EditorsError,
  GitApiError,
  type GitUser,
  type OwnerAccess,
  SignInError,
  type SiteEditor,
  type SiteEditors,
  type TokenLink,
} from "@goodfellow-cms/core";
import {
  type ApiOptions,
  allPages,
  authorizationFor,
  bitbucketJson,
  bitbucketRequest,
  credentialsFrom,
  type Paged,
  quoted,
} from "./api.js";

/** What someone can do in a Bitbucket repository. */
export type Permission = "admin" | "write" | "read";

interface Account {
  uuid: string;
  account_id?: string;
  nickname?: string;
  display_name?: string;
  links?: { avatar?: { href?: string } };
}

interface UserPermission {
  permission: Permission | "none";
  user: Account;
}

function roleOf(permission: string): EditorRole {
  if (permission === "admin") return "owner";
  return permission === "write" ? "editor" : "viewer";
}

function permissionOf(role: Exclude<EditorRole, "viewer">): Permission {
  return role === "owner" ? "admin" : "write";
}

function isNotAllowed(error: unknown): boolean {
  return error instanceof GitApiError && (error.status === 403 || error.status === 404);
}

function sameName(account: Account, name: string): boolean {
  const wanted = name.toLowerCase();
  return [account.nickname, account.display_name, account.account_id, account.uuid].some(
    (value) => value?.toLowerCase() === wanted,
  );
}

/**
 * The repository's users with permissions of their own. Editors have Write,
 * and owners Admin, which seeing and changing everyone's permissions needs:
 * signing in usually asks for less, so `manage()` gives the owner token when
 * one is in use. Bitbucket only gives permissions to people already in the
 * repository's workspace, so inviting someone finds them there first.
 */
export function bitbucketEditors(
  read: ApiOptions,
  manage: () => ApiOptions | undefined,
  repo: string,
  user: GitUser,
  permission: Permission | undefined,
): SiteEditors {
  const base = `/repositories/${repo}/permissions-config/users`;
  const workspace = repo.split("/")[0] ?? "";

  /** The owner token where one is in use, or the sign-in itself where it has Admin. */
  function managing(): ApiOptions {
    const api = manage() ?? (permission === "admin" ? read : undefined);
    if (!api) throw new EditorsError("not-allowed", "Changing editors on Bitbucket needs an owner token.");
    return api;
  }

  async function change(run: (api: ApiOptions) => Promise<unknown>): Promise<void> {
    try {
      await run(managing());
    } catch (error) {
      if (error instanceof EditorsError) throw error;
      if (isNotAllowed(error)) throw new EditorsError("not-allowed", "This token can't change the site's editors.");
      throw error;
    }
  }

  /** Someone in the workspace, by their name, nickname or email address. */
  async function findMember(api: ApiOptions, who: string): Promise<Account | undefined> {
    if (who.includes("@")) {
      // Only workspace administrators can look people up by email address.
      const query = new URLSearchParams({ q: `user.email IN (${quoted(who)})` });
      const found = await bitbucketJson<Paged<{ user: Account }>>(
        api,
        `/workspaces/${workspace}/members?${query}`,
      ).catch(() => undefined);
      return found?.values[0]?.user;
    }
    const members = await allPages<{ user: Account }>(api, `/workspaces/${workspace}/members?pagelen=100`, 10);
    return members.map((member) => member.user).find((account) => sameName(account, who));
  }

  return {
    invitesByEmail: false,
    membersOnly: true,

    async list(): Promise<EditorList> {
      const api = manage() ?? read;
      let people: UserPermission[];
      try {
        people = await allPages<UserPermission>(api, `${base}?pagelen=100`, 10);
      } catch (error) {
        if (!isNotAllowed(error)) throw error;
        // Seeing everyone's permissions needs Admin, as changing them does.
        return {
          editors: [
            { id: user.login, login: user.login, name: user.name, role: roleOf(permission ?? "write"), self: true },
          ],
          manage: permission === "admin" ? "token" : "no",
          editorsCanPublish: true,
        };
      }
      const editors = people
        .filter((person) => person.permission !== "none")
        .map(
          (person): SiteEditor => ({
            id: person.user.uuid,
            login: person.user.nickname,
            name: person.user.display_name,
            avatarUrl: person.user.links?.avatar?.href,
            role: roleOf(person.permission),
            ...(person.user.nickname?.toLowerCase() === user.login.toLowerCase() && { self: true }),
          }),
        );
      return { editors, manage: manage() || permission === "admin" ? "yes" : "no", editorsCanPublish: true };
    },

    async invite(who, role) {
      const name = who.trim().replace(/^@/, "");
      if (!name || /\s{2,}|[/\\]/.test(name)) {
        throw new EditorsError("invalid", "That isn't a Bitbucket account name or email address.");
      }
      const api = managing();
      const member = await findMember(api, name);
      if (!member) {
        throw new EditorsError(
          "not-found",
          `Nobody called ${name} is in the Bitbucket workspace ${workspace}: add them to the workspace on Bitbucket first.`,
        );
      }
      const path = `${base}/${encodeURIComponent(member.uuid)}`;
      const existing = await bitbucketRequest(api, path, { allow: [403, 404] });
      if (existing.ok) {
        const found = (await existing.json()) as UserPermission;
        if (found.permission !== "none") throw new EditorsError("already", `${name} already edits the site.`);
      }
      const response = await bitbucketRequest(api, path, {
        method: "PUT",
        body: { permission: permissionOf(role) },
        allow: [400, 402, 403, 404],
      });
      if (response.ok) return;
      if (response.status === 402) {
        throw new EditorsError("invalid", "The Bitbucket workspace's plan has as many users as it allows.");
      }
      if (response.status === 400) throw new EditorsError("invalid", `Bitbucket didn't accept ${name}.`);
      throw new EditorsError("not-allowed", "This token can't change the site's editors.");
    },

    async setRole(editor, role) {
      await change((api) =>
        bitbucketRequest(api, `${base}/${encodeURIComponent(editor.id)}`, {
          method: "PUT",
          body: { permission: permissionOf(role) },
        }),
      );
    },

    async remove(editor) {
      await change((api) =>
        bitbucketRequest(api, `${base}/${encodeURIComponent(editor.id)}`, { method: "DELETE", allow: [404] }),
      );
    },
  };
}

/**
 * The owner token: an access token or API token with Admin permission on
 * the repository, for this tab only, for editors, Pipelines' settings and
 * schedules, which signing in rarely can change.
 */
export function bitbucketOwnerAccess(base: ApiOptions, repo: string, tokenLink: TokenLink) {
  let owner: ApiOptions | undefined;
  const access: OwnerAccess = {
    tokenLink,
    get active() {
      return owner !== undefined;
    },
    async applyToken(token) {
      const credentials = credentialsFrom(token);
      const api: ApiOptions = { ...base, authorization: async () => authorizationFor(credentials) };
      try {
        // Only Admins can see everyone's permissions.
        await bitbucketJson(api, `/repositories/${repo}/permissions-config/users?pagelen=1`);
      } catch (error) {
        if (error instanceof SignInError || isNotAllowed(error)) {
          throw new EditorsError("not-allowed", "This token can't change the site's editors.");
        }
        throw error;
      }
      owner = api;
    },
    forget() {
      owner = undefined;
    },
  };
  return { access, api: () => owner };
}
