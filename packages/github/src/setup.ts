import {
  type CreatedSiteRepository,
  credentialStorage,
  decodeBase64,
  encodeBase64Bytes,
  GitApiError,
  type GitUser,
  type NewSiteRepository,
  type RepositoryLink,
  type SetupAccount,
  SetupError,
  type SetupHost,
  type SetupOwner,
  type SetupStep,
  type SetupWarning,
  SignInError,
  type StorageLike,
} from "@goodfellow-cms/core";
import { type ApiOptions, githubJson, githubRequest, repoPath } from "./api.js";
import {
  type BrowserLocation,
  browserLocation,
  ERROR_PARAM,
  GRANT_PARAM,
  isLocalAddress,
  newVerifier,
  SignInService,
  type SignInUser,
  signInProblem,
  type WorkerProblem,
} from "./sign-in.js";

export interface GitHubSetupOptions {
  /** For GitHub Enterprise. Defaults to `https://api.github.com`. */
  apiUrl?: string;
  /** For GitHub Enterprise. Defaults to `https://github.com`. */
  webUrl?: string;
  /** The address of a sign-in worker, for "Sign in with GitHub". Without one, people sign in with a token. */
  signIn?: string | false;
  /** For tests. */
  fetch?: typeof fetch;
  /** For tests. */
  storage?: { local?: StorageLike; session?: StorageLike };
  /** For tests. */
  location?: BrowserLocation;
}

/** The branch the deploy setups build from. */
const MAIN = "main";

/**
 * Links to GitHub's token pages with what creating a site needs: creating the
 * repository and adding deploy keys (administration), writing its files and
 * its build setup (contents and workflows), turning on GitHub Pages (pages),
 * and giving a workflow the key to another of the site's repositories (secrets).
 */
export function githubSetupTokenLinks(webUrl = "https://github.com") {
  const fineGrained = new URLSearchParams({
    name: "Goodfellow site setup",
    description: "Create a Goodfellow site. It can be deleted once the site is created.",
    expires_in: "7",
    administration: "write",
    contents: "write",
    workflows: "write",
    pages: "write",
    secrets: "write",
  });
  const classic = new URLSearchParams({ scopes: "repo,workflow", description: "Goodfellow site setup" });
  return {
    fineGrained: `${webUrl}/settings/personal-access-tokens/new?${fineGrained}`,
    classic: `${webUrl}/settings/tokens/new?${classic}`,
  };
}

interface GitHubRepo {
  full_name: string;
  html_url: string;
  default_branch: string;
}

/** A new repository, with a token for setting it up and whatever creating it noticed. */
interface CreatedRepo {
  repo: GitHubRepo;
  api: ApiOptions;
  signInInstallUrl?: string;
}

/** How an account creates repositories: with the person's own token, or through the sign-in worker. */
interface Creator {
  user: GitUser;
  owners(): Promise<SetupOwner[]>;
  isAvailable(owner: SetupOwner, name: string): Promise<boolean>;
  create(site: NewSiteRepository): Promise<CreatedRepo>;
  /** Who the first commit names, when the token is an app's rather than the person's. */
  author?: { name: string; email: string };
}

/** The steps after the repository exists, which are the same however it was created. */
function setupAccount(creator: Creator): SetupAccount {
  /** Each repository created, and the token for setting it up, for connecting it to another one later. */
  const createdApis = new Map<string, ApiOptions>();
  /** Makes `main` the default branch, which the deploy setups build from. */
  async function useMainBranch(api: ApiOptions, repo: GitHubRepo): Promise<void> {
    if (repo.default_branch === MAIN) return;
    const base = `/repos/${repoPath(repo.full_name)}`;
    const ref = await githubJson<{ object: { sha: string } }>(api, `${base}/git/ref/heads/${repo.default_branch}`);
    await githubRequest(api, `${base}/git/refs`, {
      method: "POST",
      body: { ref: `refs/heads/${MAIN}`, sha: ref.object.sha },
    });
    await githubRequest(api, base, { method: "PATCH", body: { default_branch: MAIN } });
    await githubRequest(api, `${base}/git/refs/heads/${repo.default_branch}`, { method: "DELETE" });
  }

  /** Turns on GitHub Pages, published by the site's own workflow. Returns the site's address. */
  async function turnOnPages(api: ApiOptions, repo: GitHubRepo): Promise<string | undefined> {
    try {
      const pages = await githubJson<{ html_url?: string }>(api, `/repos/${repoPath(repo.full_name)}/pages`, {
        method: "POST",
        body: { build_type: "workflow" },
      });
      return pages.html_url;
    } catch (error) {
      // GitHub's free plan has no Pages for private repositories.
      if (error instanceof GitApiError && [403, 404, 409, 422].includes(error.status)) return undefined;
      throw error;
    }
  }

  /** Gives the repository's Pages a domain of its own, saying whether GitHub took it. */
  async function setDomain(api: ApiOptions, repo: GitHubRepo, domain: string): Promise<boolean> {
    try {
      await githubRequest(api, `/repos/${repoPath(repo.full_name)}/pages`, { method: "PUT", body: { cname: domain } });
      return true;
    } catch (error) {
      // Another site has it, or it isn't a domain GitHub accepts.
      if (error instanceof GitApiError && [400, 403, 404, 409, 422].includes(error.status)) return false;
      throw error;
    }
  }

  /** Writes every file in one commit, which replaces the starting README rather than following it. */
  async function writeFiles(api: ApiOptions, repo: GitHubRepo, site: NewSiteRepository): Promise<void> {
    const base = `/repos/${repoPath(repo.full_name)}`;
    const tree: { path: string; mode: "100644"; type: "blob"; content?: string; sha?: string }[] = [];
    for (const file of site.files) {
      if ("delete" in file) continue;
      if ("content" in file) {
        tree.push({ path: file.path, mode: "100644", type: "blob", content: file.content });
        continue;
      }
      // Files that may not be text, such as images, are uploaded on their own.
      const blob = await githubJson<{ sha: string }>(api, `${base}/git/blobs`, {
        method: "POST",
        body: { content: encodeBase64Bytes(file.bytes), encoding: "base64" },
      });
      tree.push({ path: file.path, mode: "100644", type: "blob", sha: blob.sha });
    }
    try {
      const created = await githubJson<{ sha: string }>(api, `${base}/git/trees`, { method: "POST", body: { tree } });
      const commit = await githubJson<{ sha: string }>(api, `${base}/git/commits`, {
        method: "POST",
        body: {
          message: site.message,
          tree: created.sha,
          parents: [],
          ...(creator.author && { author: { ...creator.author, date: new Date().toISOString() } }),
        },
      });
      await githubRequest(api, `${base}/git/refs/heads/${MAIN}`, {
        method: "PATCH",
        body: { sha: commit.sha, force: true },
      });
    } catch (error) {
      // Writing `.github/workflows/` needs the workflow permission, which the token may not have.
      if (error instanceof GitApiError && (error.status === 403 || error.status === 404)) {
        throw new SetupError("not-allowed", "This sign-in can't write the site's files, or its build setup.");
      }
      throw error;
    }
  }

  /** Stops anyone rewriting or deleting the main branch's history. Not every plan allows it. */
  async function protectMain(api: ApiOptions, repo: GitHubRepo): Promise<boolean> {
    const response = await githubRequest(api, `/repos/${repoPath(repo.full_name)}/rulesets`, {
      method: "POST",
      body: {
        name: "Protect the published history",
        target: "branch",
        enforcement: "active",
        conditions: { ref_name: { include: ["~DEFAULT_BRANCH"], exclude: [] } },
        rules: [{ type: "non_fast_forward" }, { type: "deletion" }],
      },
      allow: [403, 404, 422],
    });
    return response.ok;
  }

  /**
   * Lets each private repository's workflows read the other, as their setup
   * files say: a read-only deploy key on the one read, with its private half
   * a secret of the one reading. Public repositories need nothing. Returns
   * whether it worked: an older sign-in may not be allowed to set secrets.
   */
  async function connectRepositories(link: RepositoryLink): Promise<boolean> {
    if (!link.private) return true;
    const { newDeployKey, sealSecret } = await import("./deploy-keys.js");
    try {
      for (const { reader, read, secret } of link.links.reads) {
        if (!secret) continue;
        const readerRepo = link[reader];
        const readRepo = link[read];
        const readerApi = createdApis.get(readerRepo.toLowerCase());
        const readApi = createdApis.get(readRepo.toLowerCase());
        if (!readerApi || !readApi) throw new Error(`${readerRepo} and ${readRepo} have to be created first.`);
        const key = await newDeployKey(`goodfellow-${secret.toLowerCase()}`);
        await githubRequest(readApi, `/repos/${repoPath(readRepo)}/keys`, {
          method: "POST",
          body: { title: `${readerRepo}'s builds`, key: key.publicKey, read_only: true },
        });
        const base = `/repos/${repoPath(readerRepo)}/actions/secrets`;
        const publicKey = await githubJson<{ key_id: string; key: string }>(readerApi, `${base}/public-key`);
        const sealed = await sealSecret(key.privateKey, decodeBase64(publicKey.key));
        await githubRequest(readerApi, `${base}/${secret}`, {
          method: "PUT",
          body: { encrypted_value: encodeBase64Bytes(sealed), key_id: publicKey.key_id },
        });
      }
      return true;
    } catch (error) {
      if (error instanceof GitApiError && [403, 404, 422].includes(error.status)) return false;
      throw error;
    }
  }

  return {
    user: creator.user,
    owners: () => creator.owners(),
    isAvailable: (owner, name) => creator.isAvailable(owner, name),
    async createSite(site, onStep?: (step: SetupStep) => void): Promise<CreatedSiteRepository> {
      const warnings: SetupWarning[] = [];
      onStep?.("repository");
      const { repo, api, signInInstallUrl } = await creator.create(site);
      const connect = async (link: RepositoryLink) => {
        onStep?.("connect");
        return connectRepositories(link);
      };
      await useMainBranch(api, repo);
      let siteUrl: string | undefined;
      if (site.pages) {
        // Before the files, so the first build, which starts as soon as they're written, can publish.
        onStep?.("pages");
        siteUrl = await turnOnPages(api, repo);
        if (!siteUrl) warnings.push("pages-unavailable");
        else if (site.domain) {
          if (await setDomain(api, repo, site.domain)) siteUrl = `https://${site.domain}/`;
          else warnings.push("domain-unavailable");
        }
      }
      createdApis.set(repo.full_name.toLowerCase(), api);
      if (site.link && !(await connect(site.link))) warnings.push("connect-unavailable");
      onStep?.("files");
      await writeFiles(api, repo, site);
      onStep?.("protection");
      if (!(await protectMain(api, repo))) warnings.push("protection-unavailable");
      if (signInInstallUrl) warnings.push("sign-in-not-installed");
      return {
        repo: repo.full_name,
        webUrl: repo.html_url,
        siteUrl,
        buildsUrl: `${repo.html_url}/actions`,
        pagesUrl: site.pages ? `${repo.html_url}/settings/pages` : undefined,
        ...(signInInstallUrl && { signInInstallUrl }),
        warnings,
      };
    },
  };
}

/** Creating repositories with the person's own token. */
async function tokenCreator(api: ApiOptions): Promise<Creator> {
  const user = await githubJson<{ login: string; name?: string | null; avatar_url?: string }>(api, "/user");

  async function isAvailable(owner: SetupOwner, name: string): Promise<boolean> {
    const response = await githubRequest(api, `/repos/${repoPath(`${owner.path}/${name}`)}`, { allow: [404] });
    return response.status === 404;
  }

  return {
    user: { login: user.login, name: user.name ?? undefined, avatarUrl: user.avatar_url },
    async owners() {
      const own: SetupOwner = { path: user.login, name: user.name || user.login, kind: "personal" };
      // A fine-grained token may not be allowed to list organizations; the person's own account still works.
      const orgs = await githubJson<{ login: string }[]>(api, "/user/orgs?per_page=100").catch(() => []);
      return [own, ...orgs.map((org): SetupOwner => ({ path: org.login, name: org.login, kind: "organization" }))];
    },
    isAvailable,
    async create(site) {
      const path =
        site.owner.kind === "personal" ? "/user/repos" : `/orgs/${encodeURIComponent(site.owner.path)}/repos`;
      // GitHub's answer when a name is taken doesn't say so in its message, so it's checked first.
      if (!(await isAvailable(site.owner, site.name))) {
        throw new SetupError("name-taken", `There's already a repository called ${site.owner.path}/${site.name}.`);
      }
      try {
        // GitHub's API can't write files to an empty repository, so it starts with a README that the first commit replaces.
        const repo = await githubJson<GitHubRepo>(api, path, {
          method: "POST",
          body: { name: site.name, private: site.private, description: site.description, auto_init: true },
        });
        return { repo, api };
      } catch (error) {
        if (error instanceof GitApiError && error.status === 422) {
          throw new SetupError("name-invalid", `GitHub can't use "${site.name}" as a repository name.`);
        }
        if (error instanceof GitApiError && (error.status === 403 || error.status === 404)) {
          throw new SetupError("not-allowed", `This sign-in can't create repositories in ${site.owner.path}.`);
        }
        throw error;
      }
    },
  };
}

/**
 * Creating repositories through the sign-in worker, which uses the person's
 * GitHub token itself and gives back a token for the new repository only.
 */
function workerCreator(service: SignInService, apiUrl: string, fetcher: typeof fetch, signedIn: SignedIn): Creator {
  let session = signedIn.session;

  async function call<T>(path: string, body: Record<string, unknown>): Promise<Partial<T>> {
    const answer = await service.postAnswer<T & { session?: string }>(path, { session, ...body });
    if (typeof answer.body.session === "string") session = answer.body.session;
    if (!answer.ok) throw setupProblem(answer.body);
    return answer.body;
  }

  const { user } = signedIn;
  return {
    user: { login: user.login, name: user.name, avatarUrl: user.avatarUrl },
    author: { name: user.name || user.login, email: user.email },
    async owners() {
      const found = await call<{ owners: Array<SetupOwner & { installed: boolean }>; installUrl: string }>(
        "/github/setup/owners",
        {},
      );
      return (found.owners ?? []).map(({ installed, ...owner }) => ({
        ...owner,
        ...(!installed && found.installUrl && { installUrl: found.installUrl }),
      }));
    },
    async isAvailable(owner, name) {
      const found = await call<{ available: boolean }>("/github/setup/available", { owner: owner.path, name });
      return found.available === true;
    },
    async create(site) {
      if (site.owner.installUrl) {
        throw new SetupError(
          "not-installed",
          `Goodfellow isn't installed on ${site.owner.path}.`,
          site.owner.installUrl,
        );
      }
      const created = await call<{ repo: GitHubRepo; token: string; editInstallUrl?: string }>(
        "/github/setup/repository",
        {
          owner: site.owner.path,
          name: site.name,
          private: site.private,
          description: site.description,
          ...(site.more && { more: true }),
        },
      );
      if (!created.repo || !created.token) throw new SignInError("unavailable", "The sign-in service didn't answer.");
      return {
        repo: created.repo,
        api: { apiUrl, token: created.token, fetch: fetcher },
        ...(created.editInstallUrl && { signInInstallUrl: created.editInstallUrl }),
      };
    },
  };
}

interface SignedIn {
  session: string;
  user: SignInUser;
}

/** The worker's answer when it couldn't create the repository, as a `SetupError` or `SignInError`. */
function setupProblem(answer: WorkerProblem): Error {
  switch (answer.problem) {
    case "name-taken":
      return new SetupError("name-taken", "There's already a repository with that name.");
    case "name-invalid":
      return new SetupError("name-invalid", "GitHub can't use that as a repository name.");
    case "not-allowed":
      return new SetupError("not-allowed", "This sign-in can't create repositories there.");
    case "not-installed":
      return new SetupError("not-installed", "Goodfellow isn't installed there.", answer.installUrl);
    default:
      return signInProblem(answer);
  }
}

/** Signing in to GitHub to create a site's repository, with GitHub Pages if wanted. */
export function githubSetup(options: GitHubSetupOptions = {}): SetupHost {
  const apiUrl = (options.apiUrl ?? "https://api.github.com").replace(/\/$/, "");
  const links = githubSetupTokenLinks(options.webUrl);
  const fetcher: typeof fetch = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const location = options.location ?? browserLocation();
  const signInUrl = options.signIn;
  const service =
    signInUrl && location && !isLocalAddress(location.href()) ? new SignInService(signInUrl, fetcher) : undefined;
  // Only this tab's verifier, while the browser is at GitHub: tokens are kept in memory only.
  const pending = credentialStorage("goodfellow:github:setup:pending", options.storage);

  return {
    name: "GitHub",
    canRedirect: service !== undefined,
    tokenLinks: [
      { url: links.fineGrained, label: "signIn.token.create" },
      { url: links.classic, label: "signIn.token.createBroad", hint: "signIn.token.createBroadHint" },
    ],
    async restore() {
      if (!location) return null;
      const url = new URL(location.href());
      const grant = url.searchParams.get(GRANT_PARAM);
      const failed = url.searchParams.get(ERROR_PARAM);
      if (!grant && !failed) return null;
      url.searchParams.delete(GRANT_PARAM);
      url.searchParams.delete(ERROR_PARAM);
      location.replace(url.toString());
      const verifier = pending.load();
      pending.clear();
      if (failed || !grant || !verifier || !service) throw signInProblem({ problem: failed ?? "cancelled" });
      const signedIn = await service.session<SignedIn>(grant, verifier);
      return setupAccount(workerCreator(service, apiUrl, fetcher, signedIn));
    },
    async signInWithToken(token) {
      const trimmed = token.trim();
      if (!trimmed) throw new SignInError("invalid", "Paste a token to sign in.");
      return setupAccount(await tokenCreator({ apiUrl, token: trimmed, fetch: fetcher }));
    },
    async startRedirect({ install } = {}) {
      if (!service || !location) throw new SignInError("unavailable", "Signing in with GitHub isn't available here.");
      await service.health();
      const { verifier, challenge } = await newVerifier();
      pending.save(verifier, false);
      location.assign(
        service.startUrl({ purpose: "setup", back: location.href(), challenge, remember: false, install }),
      );
    },
  };
}
