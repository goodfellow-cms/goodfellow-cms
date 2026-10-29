import {
  assertContentChanges,
  type BuildProblem,
  branchDrafts,
  buildStepFor,
  ConflictError,
  type DeployStatus,
  DraftError,
  type DraftHost,
  encodeBase64,
  encodeBase64Bytes,
  type FileChange,
  type FileVersion,
  GitApiError,
  type GitBackend,
  type GitUser,
  type HistoryOptions,
  type OwnerAccess,
  type PagesDomains,
  type PluginTasks,
  REBUILD_JOB,
  type RedirectOptions,
  type RepositoryVisibility,
  type RevisionFiles,
  type ScheduledBuilds,
  SignInError,
  type SiteDrafts,
  type SiteEditors,
  type SiteUpdates,
  type TokenLink,
  type WriteOptions,
} from "@goodfellow-cms/core";
import { type ApiOptions, githubJson, githubRequest, repoPath, type TokenSource } from "./api.js";
import { githubEditors, githubOwnerAccess } from "./editors.js";
import { githubPages } from "./pages.js";
import { githubScheduledBuilds } from "./scheduled-builds.js";
import { type GitHubTasksOptions, githubTasks } from "./tasks.js";
import { githubCodeUpdates, githubUpdates } from "./updates.js";

interface TreeResponse {
  tree: Array<{ path: string; type: string; sha: string; size?: number }>;
  truncated: boolean;
}

interface WorkflowRun {
  id: number;
  status: string;
  conclusion: string | null;
  name?: string;
  path?: string;
  html_url?: string;
}

/** A check run, such as the one Cloudflare Pages' GitHub App adds for its build. */
interface CheckRun {
  name: string;
  app?: { slug?: string } | null;
  status: string;
  conclusion: string | null;
  details_url?: string | null;
  html_url?: string | null;
  output?: { title?: string | null } | null;
}

/** A commit status, which Cloudflare Pages may report its build as. */
interface CommitStatus {
  context: string;
  state: "error" | "failure" | "pending" | "success";
  target_url?: string | null;
  description?: string | null;
}

/** Cloudflare Pages' check runs (its GitHub App is "Cloudflare Workers and Pages") and commit statuses. */
const CLOUDFLARE = /cloudflare/i;

interface Job {
  name: string;
  conclusion: string | null;
  steps?: Array<{ name: string; conclusion: string | null }>;
}

interface CommitResponse {
  sha: string;
  commit: { message: string; author?: { name?: string; date?: string } | null };
  author?: { login: string } | null;
}

interface GraphQLResponse {
  data?: { createCommitOnBranch?: { commit?: { oid: string } } };
  errors?: Array<{ type?: string; message: string }>;
}

/** How many files one GraphQL request reads. */
const GRAPHQL_BATCH = 100;
/** The most files GitHub's compare lists. */
const COMPARE_FILES_LIMIT = 300;

/** How many pages of open pull requests are read for drafts' reviews: a thousand. */
const REVIEW_PAGES = 10;

const COMMIT_MUTATION = `mutation ($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid } }
}`;

export interface GitHubBackendOptions {
  api: ApiOptions;
  repo: string;
  branch: string;
  user: GitUser;
  onSignOut: () => void;
  /** Where to create the owner token, which can change editors and GitHub Pages settings. */
  ownerTokenLink: TokenLink;
  /** Signs in as an owner through the sign-in worker instead of with a token, where it's available. */
  ownerRedirect?: (options?: RedirectOptions) => Promise<void>;
  /**
   * Who commits name as their author. Set when the token is an app's
   * installation token from the sign-in worker, whose commits would otherwise
   * name the app. Commits are then made with Git's data API, which can name them.
   */
  author?: { name: string; email: string };
  /** The commit reads see until `revision()` is next called, as a full-stack site's server reads what a browser loaded. */
  revision?: string;
  /** How plugins' tasks wait for their answers; tests pass short waits. */
  tasks?: GitHubTasksOptions;
  /** The repository holds only the site's content, with its code in a repository of its own (`GitBackend.contentOnly`). */
  contentOnly?: boolean;
  /**
   * The code repository, for a repository that holds only content, where the
   * site's updates run: `api` reads it, absent where the sign-in can't.
   */
  code?: { repo: string; webUrl: string; api?: ApiOptions };
}

/** The files under a folder of a tree, in order. */
function listFrom(tree: Map<string, string>, dir: string): string[] {
  const prefix = `${dir}/`;
  return [...tree.keys()].filter((path) => path.startsWith(prefix)).sort();
}

/**
 * The site's files on GitHub. Reads come from the commit `revision()` last
 * returned; saves are single commits made with GraphQL's `createCommitOnBranch`,
 * which fails if the branch has moved, so nothing is ever overwritten.
 */
export class GitHubBackend implements GitBackend {
  readonly user: GitUser;
  readonly pages: PagesDomains;
  readonly editors: SiteEditors;
  readonly ownerAccess: OwnerAccess;
  /** Absent where the repository holds only content: the update job runs where the code is. */
  readonly updates?: SiteUpdates;
  readonly drafts: SiteDrafts;
  readonly scheduledBuilds: ScheduledBuilds;
  readonly tasks: PluginTasks;
  readonly contentOnly: boolean;
  private readonly options: GitHubBackendOptions;
  private readonly api: ApiOptions;
  private readonly repo: string;
  private readonly branch: string;
  private readonly onSignOut: () => void;
  private readonly author?: { name: string; email: string };
  private readonly owner: ReturnType<typeof githubOwnerAccess>;
  private pinned?: string;
  private readonly trees = new Map<string, Promise<Map<string, string>>>();
  /** Each file's size in bytes at a commit, which GitHub lists with its tree. */
  private readonly treeSizes = new Map<string, Map<string, number>>();
  private readonly blobs = new Map<string, Promise<string>>();

  constructor(options: GitHubBackendOptions) {
    this.options = options;
    this.api = options.api;
    this.repo = repoPath(options.repo);
    this.branch = options.branch;
    this.user = options.user;
    this.onSignOut = options.onSignOut;
    this.author = options.author;
    this.pinned = options.revision;
    const owner = githubOwnerAccess(this.api, this.repo, options.ownerTokenLink, options.ownerRedirect);
    this.owner = owner;
    this.ownerAccess = owner.access;
    this.pages = githubPages(() => owner.api() ?? this.api, this.repo);
    this.editors = githubEditors(this.api, owner.api, this.repo, this.user.login);
    this.contentOnly = options.contentOnly === true;
    if (!this.contentOnly) this.updates = githubUpdates(this.api, owner.api, this.repo, this.branch, this);
    else if (options.code) {
      this.updates = githubCodeUpdates({
        repo: options.code.repo,
        webUrl: options.code.webUrl,
        read: options.code.api,
        manage: owner.codeApi,
        open: (api, branch) =>
          new GitHubBackend({
            api,
            repo: options.code?.repo ?? "",
            branch,
            user: this.user,
            onSignOut: () => {},
            ownerTokenLink: options.ownerTokenLink,
          }),
      });
    }
    this.drafts = branchDrafts(this, this.draftHost());
    // The workflows are the repository's own, where the content is kept apart too.
    this.scheduledBuilds = githubScheduledBuilds((path) => this.read(path));
    this.tasks = githubTasks(this.api, this.repo, this.branch, options.tasks);
  }

  async repositoryVisibility(): Promise<RepositoryVisibility> {
    const found = await githubJson<{ private?: boolean; visibility?: string }>(this.api, `/repos/${this.repo}`);
    if (found.visibility === "internal") return "internal";
    return found.private === false || found.visibility === "public" ? "public" : "private";
  }

  /** Drafts on branches of the repository, with pull requests for review. */
  private draftHost(): DraftHost {
    const base = `/repos/${this.repo}`;
    const ref = (branch: string) => `${base}/git/refs/heads/${encodeURIComponent(branch)}`;
    const openPulls = (branch: string) => {
      const owner = decodeURIComponent(this.repo).split("/")[0];
      const query = new URLSearchParams({ head: `${owner}:${branch}`, state: "open" });
      return githubJson<Array<{ number: number; html_url: string }>>(this.api, `${base}/pulls?${query}`);
    };
    return {
      liveBranch: this.branch,
      branchStore: (branch) => new GitHubBackend({ ...this.options, branch }),
      createBranch: async (branch, revision) => {
        const response = await githubRequest(this.api, `${base}/git/refs`, {
          method: "POST",
          body: { ref: `refs/heads/${branch}`, sha: revision },
          allow: [422],
        });
        if (response.status === 422) throw new DraftError("exists", `There's already a draft called ${branch}.`);
      },
      deleteBranch: async (branch) => {
        await githubRequest(this.api, ref(branch), { method: "DELETE", allow: [404, 422] });
      },
      mergeBase: async (branch) => {
        const response = await githubRequest(
          this.api,
          `${base}/compare/${encodeURIComponent(this.branch)}...${encodeURIComponent(branch)}`,
          { allow: [404] },
        );
        if (response.status === 404) throw new DraftError("not-found", `There's no draft ${branch}.`);
        const comparison = (await response.json()) as { merge_base_commit: { sha: string } };
        return comparison.merge_base_commit.sha;
      },
      listBranches: async (prefix) => {
        const refs = await githubJson<Array<{ ref: string }>>(
          this.api,
          `${base}/git/matching-refs/heads/${encodeURIComponent(prefix)}`,
        );
        return refs.map((found) => found.ref.replace(/^refs\/heads\//, ""));
      },
      openReview: async ({ branch, title, description, reviewers = [] }) => {
        const response = await githubRequest(this.api, `${base}/pulls`, {
          method: "POST",
          body: { title, head: branch, base: this.branch, body: description },
          allow: [403, 404, 422],
        });
        let review: { number: number; html_url: string } | undefined;
        if (response.ok) review = (await response.json()) as { number: number; html_url: string };
        else if (response.status !== 422) {
          throw new DraftError("no-reviews", "This sign-in can't open pull requests on the site's repository.");
        } else {
          // One is open already: give its address.
          [review] = await openPulls(branch);
          if (!review) throw new GitApiError(422, "GitHub couldn't open the pull request.");
        }
        // GitHub refuses the whole request where one person can't review, such as the one who opened it, so each is asked alone.
        for (const reviewer of reviewers) {
          await githubRequest(this.api, `${base}/pulls/${review.number}/requested_reviewers`, {
            method: "POST",
            body: { reviewers: [reviewer] },
            allow: [403, 404, 422],
          });
        }
        return { url: review.html_url };
      },
      listReviews: async (prefix) => {
        type Pull = { html_url: string; title: string; head: { ref: string; repo?: { full_name?: string } | null } };
        const pulls: Pull[] = [];
        // A site with many pull requests open has its drafts' further down the list.
        for (let page = 1; page <= REVIEW_PAGES; page++) {
          const query = new URLSearchParams({ state: "open", per_page: "100", page: String(page) });
          const found = await githubJson<Pull[]>(this.api, `${base}/pulls?${query}`);
          pulls.push(...found);
          if (found.length < 100) break;
        }
        const repo = decodeURIComponent(this.repo).toLowerCase();
        return pulls
          .filter(
            (pull) => pull.head.ref.startsWith(prefix) && (pull.head.repo?.full_name ?? repo).toLowerCase() === repo,
          )
          .map((pull) => ({ branch: pull.head.ref, url: pull.html_url, title: pull.title }));
      },
      closeReview: async (branch) => {
        for (const pull of await openPulls(branch)) {
          await githubRequest(this.api, `${base}/pulls/${pull.number}`, {
            method: "PATCH",
            body: { state: "closed" },
            allow: [403, 404, 422],
          });
        }
      },
    };
  }

  async revision(): Promise<string> {
    this.pinned = await this.head();
    return this.pinned;
  }

  /** The branch's latest commit, without moving the revision reads are pinned to. */
  private async head(): Promise<string> {
    const ref = await githubJson<{ object: { sha: string } }>(
      this.api,
      `/repos/${this.repo}/git/ref/heads/${encodeURIComponent(this.branch)}`,
    );
    return ref.object.sha;
  }

  /** Path → blob id for every file at a commit. Commits never change, so this is cached. */
  private tree(sha: string): Promise<Map<string, string>> {
    let tree = this.trees.get(sha);
    if (!tree) {
      tree = githubJson<TreeResponse>(this.api, `/repos/${this.repo}/git/trees/${sha}?recursive=1`).then((response) => {
        if (response.truncated) {
          throw new GitApiError(413, "The repository has too many files for GitHub to list at once.");
        }
        const blobs = response.tree.filter((entry) => entry.type === "blob");
        this.treeSizes.set(
          sha,
          new Map(blobs.flatMap((entry) => (entry.size === undefined ? [] : [[entry.path, entry.size] as const]))),
        );
        return new Map(blobs.map((entry) => [entry.path, entry.sha]));
      });
      tree.catch(() => this.trees.delete(sha));
      this.trees.set(sha, tree);
    }
    return tree;
  }

  private async currentTree(): Promise<Map<string, string>> {
    return this.tree(this.pinned ?? (await this.revision()));
  }

  async read(path: string): Promise<string | undefined> {
    return this.readFrom(await this.currentTree(), path);
  }

  private readFrom(tree: Map<string, string>, path: string): Promise<string | undefined> {
    const sha = tree.get(path);
    if (!sha) return Promise.resolve(undefined);
    let blob = this.blobs.get(sha);
    if (!blob) {
      blob = githubRequest(this.api, `/repos/${this.repo}/git/blobs/${sha}`, {
        accept: "application/vnd.github.raw+json",
      }).then((response) => response.text());
      blob.catch(() => this.blobs.delete(sha));
      this.blobs.set(sha, blob);
    }
    return blob;
  }

  /** Reads many text files in a few GraphQL requests rather than one request each. */
  async readFiles(paths: string[]): Promise<Map<string, string>> {
    return this.readFilesFrom(await this.currentTree(), paths);
  }

  private async readFilesFrom(tree: Map<string, string>, paths: string[]): Promise<Map<string, string>> {
    const wanted = paths.flatMap((path) => {
      const sha = tree.get(path);
      return sha ? [[path, sha] as const] : [];
    });
    const fetch = [...new Set(wanted.map(([, sha]) => sha).filter((sha) => !this.blobs.has(sha)))];
    const [owner, name] = decodeURIComponent(this.repo).split("/");
    for (let start = 0; start < fetch.length; start += GRAPHQL_BATCH) {
      const batch = fetch.slice(start, start + GRAPHQL_BATCH);
      const fields = batch.map((sha, index) => `f${index}: object(oid: "${sha}") { ... on Blob { text isBinary } }`);
      const response = await githubJson<{
        data?: { repository?: Record<string, { text: string | null; isBinary: boolean } | null> };
      }>(this.api, "/graphql", {
        method: "POST",
        body: {
          query: `query ($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { ${fields.join(" ")} } }`,
          variables: { owner, name },
        },
      });
      batch.forEach((sha, index) => {
        const blob = response.data?.repository?.[`f${index}`];
        // GitHub leaves out the text of large files; those are read one by one below.
        if (blob && !blob.isBinary && typeof blob.text === "string") this.blobs.set(sha, Promise.resolve(blob.text));
      });
    }
    const result = new Map<string, string>();
    for (const [path] of wanted) {
      const text = await this.readFrom(tree, path);
      if (text !== undefined) result.set(path, text);
    }
    return result;
  }

  async readBytes(path: string): Promise<Uint8Array | undefined> {
    return this.bytesFrom(await this.currentTree(), path);
  }

  private async bytesFrom(tree: Map<string, string>, path: string): Promise<Uint8Array | undefined> {
    const sha = tree.get(path);
    if (!sha) return undefined;
    const response = await githubRequest(this.api, `/repos/${this.repo}/git/blobs/${sha}`, {
      accept: "application/vnd.github.raw+json",
    });
    return new Uint8Array(await response.arrayBuffer());
  }

  async list(dir: string): Promise<string[]> {
    return listFrom(await this.currentTree(), dir);
  }

  filesAt(revision: string): RevisionFiles {
    return {
      read: async (path) => this.readFrom(await this.tree(revision), path),
      readFiles: async (paths) => this.readFilesFrom(await this.tree(revision), paths),
      readBytes: async (path) => this.bytesFrom(await this.tree(revision), path),
      list: async (dir) => listFrom(await this.tree(revision), dir),
    };
  }

  async fileSizes(dir: string): Promise<Map<string, number>> {
    const prefix = `${dir}/`;
    await this.currentTree();
    const sizes = this.treeSizes.get(this.pinned ?? "") ?? new Map<string, number>();
    return new Map([...sizes].filter(([path]) => path.startsWith(prefix)));
  }

  /** Uses an owner's sign-in through the worker for editors and GitHub Pages settings, until it's forgotten. */
  useOwnerSignIn(token: TokenSource, end: () => void, codeToken?: TokenSource): void {
    this.owner.useSignIn(token, end, codeToken);
  }

  /** Remembers why an owner's sign-in through the worker didn't work, which the Editors and Domain screens show. */
  ownerSignInFailed(error: unknown): void {
    this.owner.failed(error);
  }

  async write(changes: FileChange[], options: WriteOptions): Promise<{ revision: string }> {
    if (this.contentOnly) assertContentChanges(changes);
    return this.author ? this.writeCommit(changes, options, this.author) : this.writeGraphQL(changes, options);
  }

  /**
   * Saves with Git's data API, naming the editor as the commit's author:
   * GitHub refuses to move the branch unless the commit follows on from it, so
   * nothing is overwritten.
   */
  private async writeCommit(
    changes: FileChange[],
    { message, expectedRevision }: WriteOptions,
    author: { name: string; email: string },
  ): Promise<{ revision: string }> {
    const existing = await this.tree(expectedRevision);
    const base = `/repos/${this.repo}`;
    const entries: Array<{ path: string; mode: "100644"; type: "blob"; content?: string; sha?: string | null }> = [];
    try {
      for (const change of changes) {
        if ("delete" in change) {
          // Nothing to do for files that don't exist.
          if (existing.has(change.path)) entries.push({ path: change.path, mode: "100644", type: "blob", sha: null });
        } else if ("bytes" in change) {
          const blob = await githubJson<{ sha: string }>(this.api, `${base}/git/blobs`, {
            method: "POST",
            body: { content: encodeBase64Bytes(change.bytes), encoding: "base64" },
          });
          entries.push({ path: change.path, mode: "100644", type: "blob", sha: blob.sha });
        } else {
          entries.push({ path: change.path, mode: "100644", type: "blob", content: change.content });
        }
      }
      if (entries.length === 0) return { revision: expectedRevision };
      const parent = await githubJson<{ tree: { sha: string } }>(this.api, `${base}/git/commits/${expectedRevision}`);
      const tree = await githubJson<{ sha: string }>(this.api, `${base}/git/trees`, {
        method: "POST",
        body: { base_tree: parent.tree.sha, tree: entries },
      });
      const commit = await githubJson<{ sha: string }>(this.api, `${base}/git/commits`, {
        method: "POST",
        body: {
          message,
          tree: tree.sha,
          parents: [expectedRevision],
          author: { ...author, date: new Date().toISOString() },
        },
      });
      const moved = await githubRequest(this.api, `${base}/git/refs/heads/${encodeURIComponent(this.branch)}`, {
        method: "PATCH",
        body: { sha: commit.sha, force: false },
        allow: [422],
      });
      if (moved.status === 422) {
        // The branch has moved: someone else saved first.
        if ((await this.revision()) !== expectedRevision) throw new ConflictError();
        throw new GitApiError(422, "GitHub couldn't save the changes.");
      }
      this.pinned = commit.sha;
      return { revision: commit.sha };
    } catch (error) {
      if (error instanceof GitApiError && (error.status === 403 || error.status === 404)) {
        throw new SignInError("cant-publish", "This sign-in can't publish to the site.");
      }
      throw error;
    }
  }

  private async writeGraphQL(changes: FileChange[], { message, expectedRevision }: WriteOptions) {
    const existing = await this.tree(expectedRevision);
    const additions = changes.flatMap((change) =>
      "delete" in change
        ? []
        : [
            {
              path: change.path,
              contents: "bytes" in change ? encodeBase64Bytes(change.bytes) : encodeBase64(change.content),
            },
          ],
    );
    // GitHub refuses to delete files that don't exist, and there's nothing to do for them anyway.
    const deletions = changes.flatMap((change) =>
      "delete" in change && existing.has(change.path) ? [{ path: change.path }] : [],
    );
    if (additions.length === 0 && deletions.length === 0) return { revision: expectedRevision };

    const response = await githubJson<GraphQLResponse>(this.api, "/graphql", {
      method: "POST",
      body: {
        query: COMMIT_MUTATION,
        variables: {
          input: {
            branch: { repositoryNameWithOwner: decodeURIComponent(this.repo), branchName: this.branch },
            message: { headline: message },
            expectedHeadOid: expectedRevision,
            fileChanges: { additions, deletions },
          },
        },
      },
    });

    const oid = response.data?.createCommitOnBranch?.commit?.oid;
    if (oid) {
      this.pinned = oid;
      return { revision: oid };
    }

    // The mutation failed. If the branch has moved, that's why: someone else saved first.
    if ((await this.revision()) !== expectedRevision) throw new ConflictError();
    const error = response.errors?.[0];
    if (error?.type === "FORBIDDEN")
      throw new SignInError("cant-publish", "This GitHub account can't publish to the site.");
    throw new GitApiError(422, `GitHub couldn't save the changes: ${error?.message ?? "unknown error"}`);
  }

  async history(path: string, { page = 1, perPage = 20 }: HistoryOptions = {}): Promise<FileVersion[]> {
    const query = new URLSearchParams({
      sha: this.pinned ?? (await this.revision()),
      path,
      per_page: String(perPage),
      page: String(page),
    });
    const commits = await githubJson<CommitResponse[]>(this.api, `/repos/${this.repo}/commits?${query}`);
    return commits.map((commit) => ({
      revision: commit.sha,
      date: commit.commit.author?.date ?? "",
      author: commit.commit.author?.name || commit.author?.login || undefined,
      message: commit.commit.message.split("\n")[0] ?? "",
    }));
  }

  async readAt(path: string, revision: string): Promise<string | undefined> {
    return this.readFrom(await this.tree(revision), path);
  }

  async changedPaths(from: string, to: string): Promise<string[]> {
    const comparison = await githubJson<{ files?: Array<{ filename: string; previous_filename?: string }> }>(
      this.api,
      `/repos/${this.repo}/compare/${from}...${to}`,
    );
    const files = comparison.files ?? [];
    // GitHub lists at most 300 files: past that, some changes would be missing, which callers take as unchanged.
    if (files.length >= COMPARE_FILES_LIMIT) {
      throw new GitApiError(0, `More files changed between ${from} and ${to} than GitHub lists.`);
    }
    return [...new Set(files.flatMap((file) => [file.filename, file.previous_filename ?? []].flat()))];
  }

  /**
   * Reads the deployment GitHub Pages or Vercel created for a commit, or what
   * Cloudflare Pages reports on it, and for GitHub Actions, the workflow run
   * that builds it: a build that fails never creates a deployment. Before any
   * exists, the site counts as building if it has ever been deployed, or if
   * Cloudflare reported on the commit before.
   */
  async deployStatus(revision: string): Promise<DeployStatus> {
    try {
      const deployments = await githubJson<Array<{ id: number }>>(
        this.api,
        `/repos/${this.repo}/deployments?sha=${revision}&per_page=5`,
      );
      const latest = deployments[0];
      if (latest) {
        const [status] = await githubJson<Array<{ state: string; log_url?: string; target_url?: string }>>(
          this.api,
          `/repos/${this.repo}/deployments/${latest.id}/statuses?per_page=1`,
        );
        const detailsUrl = status?.log_url || status?.target_url || undefined;
        switch (status?.state) {
          case "success":
          case "inactive":
            return { state: "live", detailsUrl };
          case "failure":
          case "error": {
            const run = await this.workflowRun(revision);
            return { state: "failed", detailsUrl, problem: run ? await this.runProblem(run) : { step: "deploy" } };
          }
          default:
            return { state: "building", detailsUrl };
        }
      }
      const cloudflare = await this.cloudflareBuild(revision);
      if (cloudflare) return cloudflare;
      const run = await this.workflowRun(revision);
      if (run?.status === "completed" && run.conclusion === "cancelled") {
        // A newer publish's run replaces one still waiting in the workflow's concurrency group, and builds this
        // commit with its own.
        const head = await this.head();
        if (head !== revision) return this.deployStatus(head);
      }
      if (run?.status === "completed" && run.conclusion !== "success" && run.conclusion !== "skipped") {
        return { state: "failed", detailsUrl: run.html_url, problem: await this.runProblem(run) };
      }
      if (run) return { state: "building", detailsUrl: run.html_url };
      const any = await githubJson<unknown[]>(this.api, `/repos/${this.repo}/deployments?per_page=1`);
      if (any.length > 0) return { state: "building" };
      // Cloudflare reports a build a little after the commit, so one it reported on the commit before is coming.
      const parent = await this.parentOf(revision);
      return { state: parent && (await this.cloudflareBuild(parent)) ? "building" : "unknown" };
    } catch (error) {
      // Tokens without the Deployments permission can still publish; they just can't see deploys.
      if (error instanceof GitApiError) return { state: "unknown" };
      throw error;
    }
  }

  /**
   * What Cloudflare Pages reports on a commit: a check run of its GitHub App,
   * or a commit status, which fine-grained tokens can read where check runs
   * need a GitHub App's permission. `undefined` if it reported nothing.
   */
  private async cloudflareBuild(revision: string): Promise<DeployStatus | undefined> {
    const checks = await githubRequest(this.api, `/repos/${this.repo}/commits/${revision}/check-runs?per_page=50`, {
      allow: [403, 404],
    });
    if (checks.ok) {
      const { check_runs: found = [] } = (await checks.json()) as { check_runs?: CheckRun[] };
      const run = found.find((candidate) => CLOUDFLARE.test(`${candidate.app?.slug ?? ""} ${candidate.name}`));
      if (run) {
        const detailsUrl = run.details_url ?? run.html_url ?? undefined;
        if (run.status !== "completed") return { state: "building", detailsUrl };
        if (run.conclusion === "success" || run.conclusion === "neutral" || run.conclusion === "skipped") {
          return { state: "live", detailsUrl };
        }
        return { state: "failed", detailsUrl, problem: { step: "build", detail: run.output?.title ?? undefined } };
      }
    }
    const statuses = await githubRequest(this.api, `/repos/${this.repo}/commits/${revision}/statuses?per_page=50`, {
      allow: [403, 404],
    });
    if (!statuses.ok) return undefined;
    // Newest first, so the first is where the build is up to.
    const status = ((await statuses.json()) as CommitStatus[]).find((candidate) => CLOUDFLARE.test(candidate.context));
    if (!status) return undefined;
    const detailsUrl = status.target_url ?? undefined;
    if (status.state === "success") return { state: "live", detailsUrl };
    if (status.state === "pending") return { state: "building", detailsUrl };
    return { state: "failed", detailsUrl, problem: { step: "build", detail: status.description ?? undefined } };
  }

  /** The commit a commit was made on top of, if the token can see it. */
  private async parentOf(revision: string): Promise<string | undefined> {
    const response = await githubRequest(this.api, `/repos/${this.repo}/commits/${revision}`, {
      allow: [403, 404, 422],
    });
    if (!response.ok) return undefined;
    return ((await response.json()) as { parents?: Array<{ sha: string }> }).parents?.[0]?.sha;
  }

  /** The site's deploy workflow run for a commit, or `undefined` if there's none or the token can't see Actions. */
  private async workflowRun(revision: string): Promise<WorkflowRun | undefined> {
    const response = await githubRequest(
      this.api,
      `/repos/${this.repo}/actions/runs?head_sha=${revision}&per_page=20`,
      { allow: [403, 404] },
    );
    if (!response.ok) return undefined;
    const { workflow_runs: runs = [] } = (await response.json()) as { workflow_runs?: WorkflowRun[] };
    // The workflow that deploys the site, rather than other checks the repository runs. One that only asks
    // another host to rebuild the site, where the content is kept apart from the code, says nothing about it.
    const builds = runs.filter((run) => !run.path?.endsWith(`/${REBUILD_JOB}.yml`));
    return builds.find((run) => /deploy|pages/i.test(`${run.path ?? ""} ${run.name ?? ""}`)) ?? builds[0];
  }

  /** Which step of a failed run failed. */
  private async runProblem(run: WorkflowRun): Promise<BuildProblem> {
    const response = await githubRequest(this.api, `/repos/${this.repo}/actions/runs/${run.id}/jobs?per_page=50`, {
      allow: [403, 404],
    });
    const jobs = response.ok ? (((await response.json()) as { jobs?: Job[] }).jobs ?? []) : [];
    const failed = jobs.find((job) => job.conclusion === "failure");
    if (!failed) {
      return {
        step: run.conclusion === "startup_failure" ? "not-started" : "host",
        detail: run.conclusion ?? undefined,
      };
    }
    const step = failed.steps?.find((candidate) => candidate.conclusion === "failure");
    // A job that failed without running a step wasn't started, such as when the account's minutes have run out.
    if (!step) return { step: "not-started", detail: failed.name };
    return {
      step: buildStepFor(step.name) ?? (/deploy/i.test(failed.name) ? "deploy" : "build"),
      detail: `${failed.name}: ${step.name}`,
    };
  }

  signOut(): void {
    this.ownerAccess.forget();
    this.onSignOut();
  }
}
