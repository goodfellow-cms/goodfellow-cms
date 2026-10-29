import {
  type EditorList,
  type EditorRole,
  EditorsError,
  GitApiError,
  type OwnerAccess,
  type RedirectOptions,
  SignInError,
  type SiteEditor,
  type SiteEditors,
  type TokenLink,
} from "@goodfellow-cms/core";
import { type ApiOptions, githubJson, githubRequest, type TokenSource } from "./api.js";

interface Permissions {
  admin?: boolean;
  maintain?: boolean;
  push?: boolean;
}

interface Collaborator {
  login: string;
  avatar_url?: string;
  permissions?: Permissions;
}

interface Invitation {
  id: number;
  invitee?: { login: string; avatar_url?: string } | null;
  permissions: string;
}

/** GitHub account names: letters, digits and single hyphens, up to 39 characters. */
const USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

const INVITATION = "invitation:";

function roleOf(permissions: Permissions | undefined): EditorRole {
  if (permissions?.admin) return "owner";
  return permissions?.maintain || permissions?.push ? "editor" : "viewer";
}

function invitationRole(permission: string): EditorRole {
  if (permission === "admin") return "owner";
  return permission === "write" || permission === "maintain" ? "editor" : "viewer";
}

function isNotAllowed(error: unknown): boolean {
  return error instanceof GitApiError && (error.status === 403 || error.status === 404);
}

/**
 * The repository's collaborators. Anyone who can publish can list them, but
 * inviting and removing people needs a token with GitHub's Administration
 * permission, which signing in doesn't ask for: `manage()` gives the owner
 * token when one is in use.
 */
export function githubEditors(
  read: ApiOptions,
  manage: () => ApiOptions | undefined,
  repo: string,
  login: string,
): SiteEditors {
  const path = `/repos/${repo}`;

  function managing(): ApiOptions {
    const api = manage();
    if (!api) throw new EditorsError("not-allowed", "Changing editors on GitHub needs an owner token.");
    return api;
  }

  async function change(run: (api: ApiOptions) => Promise<unknown>): Promise<void> {
    try {
      await run(managing());
    } catch (error) {
      if (isNotAllowed(error)) throw new EditorsError("not-allowed", "This token can't change the site's editors.");
      throw error;
    }
  }

  /** Every page of a list, 100 at a time. */
  async function allPages<T>(api: ApiOptions, list: string): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= 10; page++) {
      const found = await githubJson<T[]>(api, `${path}/${list}?per_page=100&page=${page}`);
      all.push(...found);
      if (found.length < 100) break;
    }
    return all;
  }

  function collaborators(api: ApiOptions): Promise<Collaborator[]> {
    return allPages<Collaborator>(api, "collaborators");
  }

  return {
    invitesByEmail: false,

    async list(): Promise<EditorList> {
      const api = manage() ?? read;
      const people = await collaborators(api);
      let invitations: Invitation[] | undefined;
      try {
        invitations = await allPages<Invitation>(api, "invitations");
      } catch (error) {
        // Seeing invitations needs the Administration permission, as changing editors does.
        if (!isNotAllowed(error)) throw error;
      }
      const editors: SiteEditor[] = [
        ...people.map((person) => ({
          id: person.login,
          login: person.login,
          avatarUrl: person.avatar_url,
          role: roleOf(person.permissions),
          ...(person.login.toLowerCase() === login.toLowerCase() && { self: true }),
        })),
        ...(invitations ?? []).flatMap((invitation): SiteEditor[] =>
          invitation.invitee
            ? [
                {
                  id: `${INVITATION}${invitation.id}`,
                  login: invitation.invitee.login,
                  avatarUrl: invitation.invitee.avatar_url,
                  role: invitationRole(invitation.permissions),
                  invited: true,
                },
              ]
            : [],
        ),
      ];
      const owner = editors.some((editor) => editor.self && editor.role === "owner");
      return {
        editors,
        manage: invitations ? "yes" : owner ? "token" : "no",
        editorsCanPublish: true,
      };
    },

    async invite(who, role) {
      const name = who.trim().replace(/^@/, "");
      if (!USERNAME.test(name)) throw new EditorsError("invalid", "That isn't a GitHub username.");
      const api = managing();
      try {
        // GitHub answers 201 with an invitation, or 204 for someone already a collaborator, who gets this role.
        await githubRequest(api, `${path}/collaborators/${encodeURIComponent(name)}`, {
          method: "PUT",
          body: { permission: role === "owner" ? "admin" : "push" },
        });
      } catch (error) {
        if (error instanceof GitApiError && error.status === 404) {
          // GitHub answers 404 for an account that doesn't exist, and for tokens that can't see the repository.
          const exists = await githubRequest(api, `/users/${encodeURIComponent(name)}`, { allow: [404] });
          if (exists.status === 404) throw new EditorsError("not-found", `There's no GitHub account named ${name}.`);
        }
        if (isNotAllowed(error)) throw new EditorsError("not-allowed", "This token can't change the site's editors.");
        if (error instanceof GitApiError && error.status === 422) {
          throw new EditorsError("invalid", `GitHub didn't accept the invitation: ${error.message}`);
        }
        throw error;
      }
    },

    async setRole(editor, role) {
      await change(async (api) => {
        if (editor.id.startsWith(INVITATION)) {
          await githubRequest(api, `${path}/invitations/${editor.id.slice(INVITATION.length)}`, {
            method: "PATCH",
            body: { permissions: role === "owner" ? "admin" : "write" },
          });
        } else {
          await githubRequest(api, `${path}/collaborators/${encodeURIComponent(editor.id)}`, {
            method: "PUT",
            body: { permission: role === "owner" ? "admin" : "push" },
          });
        }
      });
    },

    async remove(editor) {
      await change((api) =>
        githubRequest(
          api,
          editor.id.startsWith(INVITATION)
            ? `${path}/invitations/${editor.id.slice(INVITATION.length)}`
            : `${path}/collaborators/${encodeURIComponent(editor.id)}`,
          { method: "DELETE" },
        ),
      );
    },
  };
}

/**
 * The owner token: GitHub's Administration and Pages permissions, for this tab
 * only. With the sign-in worker, owners can sign in with its owners' app
 * instead (`redirect`), and `useSignIn()` gives the token that comes back.
 */
export function githubOwnerAccess(
  base: ApiOptions,
  repo: string,
  tokenLink: TokenLink,
  redirect?: (options?: RedirectOptions) => Promise<void>,
) {
  let owner: ApiOptions | undefined;
  /** The owner's access to the site's code repository, where its content is kept in a repository of its own. */
  let ownerCode: ApiOptions | undefined;
  let endSignIn: (() => void) | undefined;
  let problem: unknown;
  const access: OwnerAccess = {
    tokenLink,
    get active() {
      return owner !== undefined;
    },
    get problem() {
      return problem;
    },
    ...(redirect && {
      async startRedirect(options?: RedirectOptions) {
        problem = undefined;
        await redirect(options);
      },
    }),
    async applyToken(token) {
      const api = { ...base, token: token.trim() };
      try {
        const found = await githubJson<{ permissions?: Permissions }>(api, `/repos/${repo}`);
        if (!found.permissions?.admin) {
          throw new EditorsError("not-allowed", "This token's account isn't an owner of the site.");
        }
        await githubJson(api, `/repos/${repo}/invitations?per_page=1`);
      } catch (error) {
        if (error instanceof EditorsError) throw error;
        if (error instanceof SignInError || isNotAllowed(error)) {
          throw new EditorsError("not-allowed", "This token can't change the site's editors.");
        }
        throw error;
      }
      owner = api;
      ownerCode = api;
      problem = undefined;
    },
    forget() {
      owner = undefined;
      ownerCode = undefined;
      endSignIn?.();
      endSignIn = undefined;
    },
  };
  return {
    access,
    api: () => owner,
    codeApi: () => ownerCode,
    /** Uses an owner's sign-in through the worker, with its token for the code repository if it gave one. `end` runs when it's forgotten. */
    useSignIn(token: TokenSource, end: () => void, codeToken?: TokenSource) {
      owner = { ...base, token };
      ownerCode = codeToken ? { ...base, token: codeToken } : undefined;
      endSignIn = end;
      problem = undefined;
    },
    /** Remembers why an owner's sign-in didn't work, for the screen that started it to show. */
    failed(error: unknown) {
      problem = error;
    },
  };
}
