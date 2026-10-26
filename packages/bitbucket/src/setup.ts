import {
  type CreatedSiteRepository,
  GitApiError,
  type NewSiteRepository,
  type SetupAccount,
  SetupError,
  type SetupHost,
  type SetupOwner,
  type SetupWarning,
  SignInError,
} from "@goodfellow-cms/core";
import {
  type ApiOptions,
  allPages,
  authorizationFor,
  bitbucketJson,
  bitbucketRequest,
  type Credentials,
  credentialsFrom,
} from "./api.js";
import { BITBUCKET_API, BITBUCKET_WEB } from "./web.js";

export interface BitbucketSetupOptions {
  /** For tests. */
  fetch?: typeof fetch;
}

/** The branch the setup files build from. */
const MAIN = "main";

/** Bitbucket's repository names, which are also the last part of their address. */
const SLUG = /^[a-z0-9][a-z0-9_.-]{0,61}$/;

interface WorkspaceAccess {
  workspace: { slug: string; name?: string };
  permission?: string;
}

/**
 * Signing in to Bitbucket to create a repository, such as a site's token
 * broker's, with an Atlassian account's API token (`email:token`), since
 * access tokens can't create repositories. Bitbucket hosts no sites with a
 * domain of their own, so whatever a new repository holds is put online
 * elsewhere, such as Vercel. Tokens are kept in memory only.
 */
export function bitbucketSetup(options: BitbucketSetupOptions = {}): SetupHost {
  const fetcher = options.fetch ?? ((input, init) => globalThis.fetch(input, init));

  async function connect(credentials: Credentials): Promise<SetupAccount> {
    const api: ApiOptions = {
      apiUrl: BITBUCKET_API,
      authorization: async () => authorizationFor(credentials),
      fetch: fetcher,
    };
    const user = await bitbucketJson<{ nickname?: string; username?: string; display_name?: string }>(api, "/user", {
      allow: [403],
    }).catch((error: unknown) => {
      if (error instanceof GitApiError) {
        throw new SignInError("invalid", "Creating a repository on Bitbucket needs an API token, not an access token.");
      }
      throw error;
    });
    const login = user.username ?? user.nickname ?? "";
    if (!login) {
      throw new SignInError("invalid", "Creating a repository on Bitbucket needs an API token, not an access token.");
    }

    const owners = async (): Promise<SetupOwner[]> => {
      const found = await allPages<WorkspaceAccess>(api, "/user/workspaces?pagelen=100", 5);
      const writable = found.filter((access) => access.permission !== "member" || found.length === 1);
      return writable
        .map(
          ({ workspace }): SetupOwner => ({
            path: workspace.slug,
            name: workspace.name ?? workspace.slug,
            kind: workspace.slug === login ? "personal" : "organization",
          }),
        )
        .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "personal" ? -1 : 1));
    };

    return {
      user: { login, name: user.display_name },
      owners,
      async isAvailable(owner, name) {
        const response = await bitbucketRequest(api, `/repositories/${owner.path}/${name.toLowerCase()}`, {
          allow: [403, 404],
        });
        return response.status === 404;
      },
      async createSite(site: NewSiteRepository, onStep): Promise<CreatedSiteRepository> {
        const slug = site.name.toLowerCase();
        if (!SLUG.test(slug)) throw new SetupError("name-invalid", "That name can't be used for a repository.");
        const repo = `${site.owner.path}/${slug}`;
        onStep?.("repository");
        const created = await bitbucketRequest(api, `/repositories/${repo}`, {
          body: {
            scm: "git",
            is_private: site.private,
            ...(site.description && { description: site.description }),
          },
          allow: [400, 403],
        });
        if (created.status === 400) throw new SetupError("name-taken", `There's already a repository called ${repo}.`);
        if (created.status === 403) {
          throw new SetupError("not-allowed", `This account can't create repositories in ${site.owner.name}.`);
        }

        onStep?.("files");
        const form = new FormData();
        for (const file of site.files) {
          if ("delete" in file) continue;
          const content = "bytes" in file ? new Uint8Array(file.bytes) : file.content;
          form.append(`/${file.path}`, new Blob([content]), file.path.split("/").at(-1) ?? file.path);
        }
        form.append("message", site.message);
        form.append("branch", MAIN);
        const written = await bitbucketRequest(api, `/repositories/${repo}/src`, { form, allow: [403] });
        if (written.status === 403)
          throw new SetupError("not-allowed", "This account can't write to the new repository.");
        // The first branch is the main one; saying so keeps Bitbucket from waiting for another.
        await bitbucketRequest(api, `/repositories/${repo}`, {
          method: "PUT",
          body: { mainbranch: { name: MAIN } },
          allow: [400, 403],
        });

        // Bitbucket has no Pages of its own with domains: the site goes online elsewhere.
        const warnings: SetupWarning[] = site.pages ? ["pages-unavailable"] : [];
        return {
          repo,
          webUrl: `${BITBUCKET_WEB}/${repo}`,
          buildsUrl: `${BITBUCKET_WEB}/${repo}/pipelines`,
          warnings,
        };
      },
    };
  }

  return {
    name: "Bitbucket",
    canRedirect: false,
    tokenLinks: [
      {
        url: "https://id.atlassian.com/manage-profile/security/api-tokens",
        label: "signIn.token.create",
        hint: "signIn.token.apiTokenHint",
      },
    ],
    async restore() {
      return null;
    },
    async signInWithToken(token) {
      const trimmed = token.trim();
      if (!trimmed) throw new SignInError("invalid", "Paste a token to sign in.");
      return connect(credentialsFrom(trimmed));
    },
    async startRedirect() {
      throw new Error("Creating repositories on Bitbucket needs a token.");
    },
  };
}
