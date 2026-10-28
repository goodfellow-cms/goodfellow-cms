/**
 * GitHub through the Goodfellow for Claude app. People sign in with it to say
 * which of the repositories it's installed on Claude may work on; their own
 * token is revoked straight after. Each request to `/mcp` then gets the app's
 * installation token for one repository, lasting no longer than the request,
 * once GitHub says the person still edits it.
 */
import { GitHubBackend } from "@goodfellow-cms/github";
import { ToolError } from "@goodfellow-cms/mcp";
import {
  type App,
  type GitHubConfig,
  GitHubError,
  github,
  githubJson,
  installationToken,
  repoPath,
  revokeUserToken,
  userTokens,
} from "@goodfellow-cms/worker/github";
import githubAppJwt from "universal-github-app-jwt";
import { type GitHubSite, MAX_SITES } from "./connection.js";
import { PERMISSIONS } from "./permissions.js";

export { PERMISSIONS };

/** How many of the app's installations are looked through for sites. */
const MAX_INSTALLATIONS = 20;
/** How many pages of an installation's repositories are read, 100 to a page. */
const MAX_LIST_PAGES = 3;

export function installUrl(config: GitHubConfig, app: App, state: string): string {
  return `${config.web}/apps/${encodeURIComponent(app.slug)}/installations/new?${new URLSearchParams({ state })}`;
}

export function authorizeUrl(config: GitHubConfig, app: App, redirectUri: string, state: string): string {
  return `${config.web}/login/oauth/authorize?${new URLSearchParams({
    client_id: app.clientId,
    redirect_uri: redirectUri,
    state,
  })}`;
}

/**
 * Who signed in, and the repositories they can publish to that the app is
 * installed on. Their token is revoked before this returns.
 */
export async function signedInSites(
  config: GitHubConfig,
  app: App,
  grant: { code: string; redirectUri: string },
  now: number,
) {
  const tokens = await userTokens(config, app, grant, now);
  const auth = { bearer: tokens.access };
  /** Every page of a list, 100 at a time, up to `most` pages, since Workers make only so many requests. */
  async function pages<T>(path: (page: number) => string, key: string, most = MAX_LIST_PAGES): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= most; page++) {
      const found = ((await githubJson<Record<string, T[] | undefined>>(config, path(page), { auth }))[key] ??
        []) as T[];
      all.push(...found);
      if (found.length < 100) break;
    }
    return all;
  }
  try {
    const user = await githubJson<{ login: string; id: number; name?: string | null }>(config, "/user", { auth });
    const installations = await pages<{ id: number }>(
      (page) => `/user/installations?per_page=100&page=${page}`,
      "installations",
      Math.ceil(MAX_INSTALLATIONS / 100),
    );
    const sites: GitHubSite[] = [];
    for (const installation of installations.slice(0, MAX_INSTALLATIONS)) {
      const repositories = await pages<{
        full_name: string;
        default_branch?: string;
        permissions?: { push?: boolean };
      }>((page) => `/user/installations/${installation.id}/repositories?per_page=100&page=${page}`, "repositories");
      for (const repository of repositories) {
        if (!repository.permissions?.push) continue;
        sites.push({
          id: `github:${repository.full_name}`,
          repo: repository.full_name,
          installation: installation.id,
          branch: repository.default_branch ?? "main",
        });
      }
    }
    sites.sort((a, b) => a.repo.localeCompare(b.repo));
    return {
      user: { login: user.login, id: user.id, ...(user.name && { name: user.name }) },
      sites: sites.slice(0, MAX_SITES * 5),
    };
  } finally {
    await revokeUserToken(config, app, tokens.access).catch(() => {});
  }
}

/** Opens sites for one request to `/mcp`, and revokes their tokens once it's answered. */
export function githubSites(
  config: GitHubConfig,
  app: App,
  user: { login: string; id: number; name?: string },
  now: number,
) {
  const issued: string[] = [];
  let jwt: Promise<string> | undefined;

  async function backend(site: GitHubSite): Promise<GitHubBackend> {
    jwt ??= githubAppJwt({ id: app.id, privateKey: app.privateKey, now: Math.floor(now / 1000) }).then(
      (made) => made.token,
    );
    let token: string;
    try {
      token = (await installationToken(config, await jwt, site.installation, site.repo, PERMISSIONS)).token;
    } catch (error) {
      if (error instanceof GitHubError && [403, 404, 422].includes(error.status)) {
        throw new ToolError(
          `Goodfellow for Claude isn't installed on ${site.repo} any more. Ask the site's owner to install it again, then connect Claude again.`,
        );
      }
      throw error;
    }
    issued.push(token);
    let found: { permission?: string; user?: { permissions?: { push?: boolean } } };
    try {
      found = await githubJson(
        config,
        `/repos/${repoPath(site.repo)}/collaborators/${encodeURIComponent(user.login)}/permission`,
        { auth: { bearer: token } },
      );
    } catch (error) {
      if (error instanceof GitHubError && (error.status === 403 || error.status === 404)) found = {};
      else throw error;
    }
    const push = found.user?.permissions?.push ?? ["admin", "maintain", "write"].includes(found.permission ?? "");
    if (!push) throw new ToolError(`The GitHub account ${user.login} can't edit ${site.repo} any more.`);
    return new GitHubBackend({
      api: { apiUrl: config.api, token, fetch: config.fetch },
      repo: site.repo,
      branch: site.branch,
      user: { login: user.login, ...(user.name && { name: user.name }) },
      // Commits name the person, as the admin panel's do, rather than the app.
      author: { name: user.name || user.login, email: `${user.id}+${user.login}@users.noreply.github.com` },
      onSignOut: () => {},
      ownerTokenLink: { url: `${config.web}/settings/personal-access-tokens/new`, label: "owner.token.create" },
    });
  }

  return {
    backend,
    /** Revokes every token this request was given. */
    async end() {
      await Promise.all(
        issued.map((token) =>
          github(config, "/installation/token", { method: "DELETE", auth: { bearer: token } }).catch(() => {}),
        ),
      );
    },
  };
}
