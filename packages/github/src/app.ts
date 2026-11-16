/**
 * A full-stack site's own publishing app: a GitHub App the site's owner makes for that one site, installed on its
 * content repository alone, which the site's server publishes editors' changes with. The server keeps the app's key
 * and makes installation tokens from it, each lasting an hour and narrowed to the content repository and to
 * Contents, so nobody makes or renews a token by hand, and the code's repository is out of its reach.
 *
 * GitHub can't hold an app to one repository: its owner can install it on others, or on all of them, and give it more
 * permissions later. So every token is made only once the installation is checked as the setup page made it, and the
 * server refuses to publish otherwise, saying what to change.
 *
 * Its own entry, `@goodfellow-cms/github/app`, so only what signs the app's tokens loads its JWT library.
 */
import githubAppJwt from "universal-github-app-jwt";
import { pkcs8Key } from "./app-keys.js";

export { pkcs1Pem, pkcs8Key } from "./app-keys.js";

/** All the app may do: change the content repository's files. Metadata comes with every app. */
export const PUBLISHING_APP_PERMISSIONS = { contents: "write", metadata: "read" } as const;

/** GitHub's longest app name. */
const MAX_APP_NAME = 34;

/** A name for a site's publishing app, from its content repository's name, as long as GitHub allows. */
export function publishingAppName(content: string): string {
  const name = content.split("/").pop() ?? content;
  return `${name} publishing`.slice(0, MAX_APP_NAME).trim();
}

export interface PublishingAppManifestOptions {
  /** The app's name, which GitHub's page lets the owner change where another app has it. */
  name: string;
  /** The site's address, or its code repository's page, which the app's page links to. */
  url: string;
  /** Where GitHub sends the browser back to once the app is made, with a code that gives its key once. */
  redirectUrl: string;
  /** Where GitHub sends the browser back to once the app is installed. */
  setupUrl: string;
}

/** The app's manifest, as GitHub's "Create a GitHub App from a manifest" takes it: private, with no events. */
export function publishingAppManifest(options: PublishingAppManifestOptions) {
  return {
    name: options.name,
    url: options.url,
    description:
      "Publishes editors' changes to one Goodfellow site's content repository. Install it on that repository only.",
    // It needs no events, but GitHub wants an address for them.
    hook_attributes: { url: options.url, active: false },
    redirect_url: options.redirectUrl,
    setup_url: options.setupUrl,
    setup_on_update: true,
    public: false,
    default_permissions: { ...PUBLISHING_APP_PERMISSIONS },
    default_events: [] as string[],
  };
}

/** Where a manifest is posted: the person's own settings, or an organization's. */
export function appManifestFormAction(state: string, organization?: string, web = "https://github.com"): string {
  const base = organization
    ? `${web}/organizations/${encodeURIComponent(organization)}/settings/apps/new`
    : `${web}/settings/apps/new`;
  return `${base}?${new URLSearchParams({ state })}`;
}

/** Where an app is installed. */
export function appInstallUrl(slug: string, web = "https://github.com"): string {
  return `${web}/apps/${encodeURIComponent(slug)}/installations/new`;
}

/** An app GitHub made from a manifest: what the site's server needs of it. */
export interface CreatedApp {
  id: number;
  slug: string;
  /** The app's private key, as GitHub gives it (PKCS#1 PEM). */
  pem: string;
}

export type PublishingAppProblem =
  /** GitHub didn't give the app's details for the code: it's used, an hour old, or not one. */
  | "no-app"
  /** The app isn't installed on the content repository. */
  | "not-installed"
  /** It's installed on all of the account's repositories. */
  | "all-repositories"
  /** It's installed on repositories besides the content's. */
  | "other-repositories"
  /** Its installation has permissions besides Contents. */
  | "permissions"
  /** The app's id or key aren't the app's, or GitHub couldn't be reached. */
  | "unavailable";

/** Why the publishing app can't publish, in words for the site's owner. */
export class PublishingAppError extends Error {
  override name = "PublishingAppError";
  constructor(
    readonly problem: PublishingAppProblem,
    message: string,
  ) {
    super(message);
  }
}

export interface AppApiOptions {
  /** GitHub's API, for tests. */
  api?: string;
  fetch?: typeof fetch;
}

const HEADERS = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };

/** Turns the code GitHub came back with into the app's id, slug, and key. Each code works once, within an hour. */
export async function convertAppManifest(code: string, options: AppApiOptions = {}): Promise<CreatedApp> {
  const fetcher = options.fetch ?? fetch;
  const response = await fetcher(
    `${options.api ?? "https://api.github.com"}/app-manifests/${encodeURIComponent(code)}/conversions`,
    { method: "POST", headers: HEADERS },
  );
  if (!response.ok) {
    throw new PublishingAppError("no-app", "GitHub didn't give the app's details. Make the app again.");
  }
  const app = (await response.json()) as Partial<CreatedApp>;
  if (typeof app.id !== "number" || typeof app.slug !== "string" || typeof app.pem !== "string") {
    throw new PublishingAppError("no-app", "GitHub's answer didn't include the app's key. Make the app again.");
  }
  return { id: app.id, slug: app.slug, pem: app.pem };
}

export interface PublishingAppOptions extends AppApiOptions {
  /** The app's id, as GitHub shows it on the app's page (App ID). */
  appId: string | number;
  /** The app's private key, as GitHub gives it, or in PKCS#8; `\n` for each line break is fine. */
  privateKey: string;
  /** The content repository, as `owner/name`, the only one the app may be installed on. */
  repo: string;
  /** For tests: the time, in milliseconds. */
  now?: () => number;
}

/** An hour-long token for the content repository alone, and when it ends. */
export interface PublishingToken {
  token: string;
  expiresAt: number;
}

interface Installation {
  id: number;
  repository_selection?: string;
  permissions?: Record<string, string>;
}

/** What GitHub said, kept to its status: its words could name other repositories. */
class GitHubAnswer extends Error {
  constructor(readonly status: number) {
    super(`GitHub answered ${status}.`);
  }
}

/** The site's settings that name the app, for messages. */
const SETTINGS = "GOODFELLOW_APP_ID and GOODFELLOW_APP_KEY";

/**
 * Checks the app's installation, then makes a token for the content repository alone, with Contents only. It
 * refuses an installation on all repositories or on others besides the content's, or with more permissions, since
 * the key could then change them too.
 */
export async function publishingToken(options: PublishingAppOptions): Promise<PublishingToken> {
  const api = options.api ?? "https://api.github.com";
  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const [owner, name] = options.repo.split("/");
  if (!owner || !name || options.repo.split("/").length !== 2) {
    throw new PublishingAppError("unavailable", `${options.repo} isn't a repository's owner and name.`);
  }

  let jwt: string;
  try {
    jwt = (
      await githubAppJwt({
        id: String(options.appId),
        privateKey: pkcs8Key(options.privateKey),
        now: Math.floor(now() / 1000),
      })
    ).token;
  } catch {
    throw new PublishingAppError("unavailable", `${SETTINGS} don't hold the app's id and private key.`);
  }

  async function call<T>(path: string, auth: string, init: RequestInit = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetcher(`${api}${path}`, {
        ...init,
        headers: {
          ...HEADERS,
          authorization: `Bearer ${auth}`,
          ...(init.body ? { "content-type": "application/json" } : {}),
        },
      });
    } catch {
      throw new PublishingAppError("unavailable", "GitHub couldn't be reached. Try again in a moment.");
    }
    if (!response.ok) throw new GitHubAnswer(response.status);
    return (response.status === 204 ? undefined : await response.json()) as T;
  }

  let installation: Installation;
  try {
    installation = await call<Installation>(
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/installation`,
      jwt,
    );
  } catch (error) {
    if (error instanceof GitHubAnswer && error.status === 404) {
      throw new PublishingAppError(
        "not-installed",
        `The site's publishing app isn't installed on ${options.repo}. Install it there, on that repository only.`,
      );
    }
    if (error instanceof GitHubAnswer && error.status === 401) {
      throw new PublishingAppError("unavailable", `GitHub didn't take the app's key: check ${SETTINGS}.`);
    }
    throw error instanceof PublishingAppError
      ? error
      : new PublishingAppError("unavailable", "GitHub couldn't say where the app is installed. Try again in a moment.");
  }

  const settings = "Change it in the app's installation settings, on GitHub, then try again.";
  if (installation.repository_selection !== "selected") {
    throw new PublishingAppError(
      "all-repositories",
      `The site's publishing app is installed on all of the account's repositories, so it could change the site's code and every other repository there. ${settings} Choose Only select repositories, and ${options.repo} alone.`,
    );
  }
  const extra = Object.entries(installation.permissions ?? {}).filter(
    ([permission, level]) =>
      PUBLISHING_APP_PERMISSIONS[permission as keyof typeof PUBLISHING_APP_PERMISSIONS] !== level &&
      !(permission === "contents" && level === "read"),
  );
  if (extra.length > 0) {
    throw new PublishingAppError(
      "permissions",
      `The site's publishing app has permissions besides Contents (${extra.map(([permission]) => permission).join(", ")}). Take them away in the app's settings, on GitHub, then try again.`,
    );
  }

  const mint = (body: object) =>
    call<{ token: string; expires_at: string }>(`/app/installations/${installation.id}/access_tokens`, jwt, {
      method: "POST",
      body: JSON.stringify(body),
    });
  const revoke = (token: string) => call<void>("/installation/token", token, { method: "DELETE" }).catch(() => {});

  // Which repositories the installation has, read with a token that can only see them, which is revoked straight away.
  let listed: { total_count: number; repositories: { full_name: string }[] };
  try {
    const looking = await mint({ permissions: { metadata: "read" } });
    try {
      listed = await call(`/installation/repositories?per_page=2`, looking.token);
    } finally {
      await revoke(looking.token);
    }
  } catch (error) {
    throw error instanceof PublishingAppError
      ? error
      : new PublishingAppError("unavailable", "GitHub couldn't list the app's repositories. Try again in a moment.");
  }
  const only = listed.repositories[0]?.full_name ?? "";
  if (listed.total_count !== 1 || only.toLowerCase() !== options.repo.toLowerCase()) {
    throw new PublishingAppError(
      "other-repositories",
      `The site's publishing app is installed on other repositories besides ${options.repo}, so it could change them too. ${settings} Leave ${options.repo} alone.`,
    );
  }

  try {
    const made = await mint({ repositories: [name], permissions: { contents: "write" } });
    return { token: made.token, expiresAt: Date.parse(made.expires_at) };
  } catch (error) {
    throw error instanceof PublishingAppError
      ? error
      : new PublishingAppError("unavailable", "GitHub didn't give the app a token. Try again in a moment.");
  }
}

/** How long before a token ends it's made again. */
const RENEW_MS = 10 * 60_000;

/**
 * A token source for the site's server (`GitHost.server({ token })`): the content repository's token from the
 * app, made again when it's nearly an hour old, each time checked as `publishingToken()` does. Requests that come
 * while one is being made wait for it.
 */
export function publishingAppToken(options: PublishingAppOptions): () => Promise<string> {
  const now = options.now ?? Date.now;
  let current: PublishingToken | undefined;
  let making: Promise<PublishingToken> | undefined;
  return async () => {
    if (current && current.expiresAt - now() > RENEW_MS) return current.token;
    making ??= publishingToken(options).finally(() => {
      making = undefined;
    });
    current = await making;
    return current.token;
  };
}
