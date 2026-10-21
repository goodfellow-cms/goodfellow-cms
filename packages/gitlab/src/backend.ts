import {
  assertContentChanges,
  type BuildProblem,
  branchDrafts,
  buildStepFor,
  ConflictError,
  type DeployStatus,
  DraftError,
  type DraftHost,
  EDITABLE_FOLDERS,
  encodeBase64Bytes,
  type FileChange,
  type FileVersion,
  findBuildCause,
  GitApiError,
  type GitBackend,
  type GitUser,
  type HistoryOptions,
  type PagesDomains,
  REBUILD_JOB,
  type RepositoryVisibility,
  type ScheduledBuilds,
  SignInError,
  type SiteDrafts,
  type SiteEditors,
  type SiteUpdates,
  type WriteOptions,
} from "@goodfellow-cms/core";
import { type ApiOptions, gitlabJson, gitlabRequest } from "./api.js";
import { gitlabEditors } from "./editors.js";
import { gitlabPages } from "./pages.js";
import { gitlabScheduledBuilds } from "./scheduled-builds.js";
import { gitlabCodeUpdates, gitlabUpdates } from "./updates.js";

const PAGE_SIZE = 100;

/** How many files one GraphQL request reads. */
const GRAPHQL_BATCH = 50;

/** The color and section codes in GitLab's job logs. */
const ANSI_CODES = new RegExp(`${String.fromCharCode(27)}\\[[\\d;]*[A-Za-z]`, "g");

export interface GitLabBackendOptions {
  api: ApiOptions;
  project: string;
  branch: string;
  user: GitUser;
  onSignOut: () => void;
  /** Who commits name as their author, where that isn't the token's owner, as on a full-stack site's server. */
  author?: { name: string; email: string };
  /** The commit reads see until `revision()` is next called, as a full-stack site's server reads what a browser loaded. */
  revision?: string;
  /** The project holds only the site's content, with its code in a project of its own (`GitBackend.contentOnly`). */
  contentOnly?: boolean;
  /** The code project, for a project that holds only content, where the site's updates run. */
  code?: { project: string; webUrl: string };
}

/**
 * The site's files on GitLab. Reads come from the commit `revision()` last
 * returned. Saves are single commits; each changed file carries the commit it
 * was last changed in, so GitLab refuses to overwrite anyone else's edits.
 */
export class GitLabBackend implements GitBackend {
  readonly user: GitUser;
  readonly pages: PagesDomains;
  readonly editors: SiteEditors;
  /** Absent where the project holds only content: the update job runs where the code is. */
  readonly updates?: SiteUpdates;
  readonly drafts: SiteDrafts;
  readonly scheduledBuilds: ScheduledBuilds;
  readonly contentOnly: boolean;
  private readonly options: GitLabBackendOptions;
  private readonly api: ApiOptions;
  private readonly project: string;
  private readonly branch: string;
  private readonly onSignOut: () => void;
  private pinned?: string;
  private readonly trees = new Map<string, Promise<Map<string, string>>>();
  private readonly blobs = new Map<string, Promise<string>>();

  constructor(options: GitLabBackendOptions) {
    this.options = options;
    this.api = options.api;
    this.project = encodeURIComponent(options.project);
    this.branch = options.branch;
    this.user = options.user;
    this.onSignOut = options.onSignOut;
    this.pinned = options.revision;
    this.pages = gitlabPages(this.api, options.project);
    this.editors = gitlabEditors(this.api, options.project, this.branch, this.user.login);
    this.contentOnly = options.contentOnly === true;
    // Its setup files are outside the folders the backend lists, so they're read directly.
    if (!this.contentOnly) {
      this.updates = gitlabUpdates(this.api, options.project, this.branch, async (path) =>
        this.readAt(path, this.pinned ?? (await this.revision())),
      );
    } else if (options.code) {
      const code = options.code;
      this.updates = gitlabCodeUpdates({
        api: this.api,
        project: code.project,
        webUrl: code.webUrl,
        open: (branch) =>
          new GitLabBackend({ api: this.api, project: code.project, branch, user: this.user, onSignOut: () => {} }),
      });
    }
    this.drafts = branchDrafts(this, this.draftHost());
    // Pipeline schedules run this project's pipeline, which builds the site, where the content is kept apart too.
    this.scheduledBuilds = gitlabScheduledBuilds(this.api, options.project, this.branch, async () =>
      this.readAt(".gitlab-ci.yml", this.pinned ?? (await this.revision())),
    );
  }

  async repositoryVisibility(): Promise<RepositoryVisibility> {
    const { visibility } = await gitlabJson<{ visibility?: string }>(this.api, `/projects/${this.project}`);
    return visibility === "public" || visibility === "internal" ? visibility : "private";
  }

  /** Drafts on branches of the project, with merge requests for review. */
  private draftHost(): DraftHost {
    const project = `/projects/${this.project}`;
    return {
      liveBranch: this.branch,
      branchStore: (branch) => new GitLabBackend({ ...this.options, branch }),
      createBranch: async (branch, revision) => {
        const response = await gitlabRequest(
          this.api,
          this.repo(`/branches?${new URLSearchParams({ branch, ref: revision })}`),
          { method: "POST", allow: [400] },
        );
        if (response.status === 400) throw new DraftError("exists", `There's already a draft called ${branch}.`);
      },
      deleteBranch: async (branch) => {
        await gitlabRequest(this.api, this.repo(`/branches/${encodeURIComponent(branch)}`), {
          method: "DELETE",
          allow: [404],
        });
      },
      mergeBase: async (branch) => {
        const query = new URLSearchParams();
        query.append("refs[]", this.branch);
        query.append("refs[]", branch);
        const response = await gitlabRequest(this.api, this.repo(`/merge_base?${query}`), { allow: [400, 404] });
        if (!response.ok) throw new DraftError("not-found", `There's no draft ${branch}.`);
        return ((await response.json()) as { id: string }).id;
      },
      openReview: async ({ branch, title, description }) => {
        const response = await gitlabRequest(this.api, `${project}/merge_requests`, {
          method: "POST",
          body: { source_branch: branch, target_branch: this.branch, title, description, remove_source_branch: true },
          allow: [403, 404, 409],
        });
        if (response.ok) return { url: ((await response.json()) as { web_url: string }).web_url };
        if (response.status !== 409) {
          throw new DraftError("no-reviews", "This sign-in can't open merge requests on the site's project.");
        }
        // One is open already: give its address.
        const query = new URLSearchParams({ source_branch: branch, state: "opened" });
        const [open] = await gitlabJson<Array<{ web_url: string }>>(this.api, `${project}/merge_requests?${query}`);
        if (!open) throw new GitApiError(409, "GitLab couldn't open the merge request.");
        return { url: open.web_url };
      },
    };
  }

  private repo(path: string): string {
    return `/projects/${this.project}/repository${path}`;
  }

  async revision(): Promise<string> {
    const branch = await gitlabJson<{ commit: { id: string } }>(
      this.api,
      this.repo(`/branches/${encodeURIComponent(this.branch)}`),
    );
    this.pinned = branch.commit.id;
    return this.pinned;
  }

  /** Every file in one folder at a commit, page by page. */
  private async listFolder(sha: string, dir: string): Promise<Array<[string, string]>> {
    const files: Array<[string, string]> = [];
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({
        ref: sha,
        path: dir,
        recursive: "true",
        per_page: String(PAGE_SIZE),
        page: String(page),
      });
      const response = await gitlabRequest(this.api, this.repo(`/tree?${query}`), { allow: [404] });
      if (response.status === 404) return files;
      const entries = (await response.json()) as Array<{ id: string; type: string; path: string }>;
      for (const entry of entries) if (entry.type === "blob") files.push([entry.path, entry.id]);
      if (entries.length < PAGE_SIZE) return files;
    }
  }

  /** Path → blob id for the editable files at a commit. Commits never change, so this is cached. */
  private tree(sha: string): Promise<Map<string, string>> {
    let tree = this.trees.get(sha);
    if (!tree) {
      tree = Promise.all(EDITABLE_FOLDERS.map((folder) => this.listFolder(sha, folder))).then(
        (folders) => new Map(folders.flat()),
      );
      tree.catch(() => this.trees.delete(sha));
      this.trees.set(sha, tree);
    }
    return tree;
  }

  private async currentTree(): Promise<Map<string, string>> {
    return this.tree(this.pinned ?? (await this.revision()));
  }

  async read(path: string): Promise<string | undefined> {
    const sha = (await this.currentTree()).get(path);
    if (!sha) return undefined;
    let blob = this.blobs.get(sha);
    if (!blob) {
      blob = gitlabRequest(this.api, this.repo(`/blobs/${sha}/raw`)).then((response) => response.text());
      blob.catch(() => this.blobs.delete(sha));
      this.blobs.set(sha, blob);
    }
    return blob;
  }

  /** Reads many text files in a few GraphQL requests rather than one request each. */
  async readFiles(paths: string[]): Promise<Map<string, string>> {
    const tree = await this.currentTree();
    const wanted = paths.filter((path) => tree.has(path));
    const fetch = wanted.filter((path) => !this.blobs.has(tree.get(path) ?? ""));
    const ref = this.pinned ?? (await this.revision());
    for (let start = 0; start < fetch.length; start += GRAPHQL_BATCH) {
      const batch = fetch.slice(start, start + GRAPHQL_BATCH);
      // GitLab's GraphQL API is beside its REST API, at /api/graphql.
      const response = await gitlabJson<{
        data?: {
          project?: { repository?: { blobs?: { nodes?: Array<{ path: string; rawTextBlob: string | null }> } } };
        };
      }>(this.api, "/../graphql", {
        method: "POST",
        body: {
          query: `query ($project: ID!, $ref: String!, $paths: [String!]!) {
  project(fullPath: $project) { repository { blobs(ref: $ref, paths: $paths) { nodes { path rawTextBlob } } } }
}`,
          variables: { project: decodeURIComponent(this.project), ref, paths: batch },
        },
      });
      for (const node of response.data?.project?.repository?.blobs?.nodes ?? []) {
        const sha = tree.get(node.path);
        // GitLab leaves out the text of large files; those are read one by one below.
        if (sha && typeof node.rawTextBlob === "string") this.blobs.set(sha, Promise.resolve(node.rawTextBlob));
      }
    }
    const result = new Map<string, string>();
    for (const path of wanted) {
      const text = await this.read(path);
      if (text !== undefined) result.set(path, text);
    }
    return result;
  }

  async readBytes(path: string): Promise<Uint8Array | undefined> {
    const sha = (await this.currentTree()).get(path);
    if (!sha) return undefined;
    const response = await gitlabRequest(this.api, this.repo(`/blobs/${sha}/raw`));
    return new Uint8Array(await response.arrayBuffer());
  }

  async list(dir: string): Promise<string[]> {
    const prefix = `${dir}/`;
    return [...(await this.currentTree()).keys()].filter((path) => path.startsWith(prefix)).sort();
  }

  /** GitLab's tree doesn't say how large files are, so they're asked for with GraphQL, in batches. */
  async fileSizes(dir: string): Promise<Map<string, number>> {
    const paths = await this.list(dir);
    const ref = this.pinned ?? (await this.revision());
    const sizes = new Map<string, number>();
    for (let start = 0; start < paths.length; start += GRAPHQL_BATCH) {
      const response = await gitlabJson<{
        data?: { project?: { repository?: { blobs?: { nodes?: Array<{ path: string; size: string | number }> } } } };
      }>(this.api, "/../graphql", {
        method: "POST",
        body: {
          query: `query ($project: ID!, $ref: String!, $paths: [String!]!) {
  project(fullPath: $project) { repository { blobs(ref: $ref, paths: $paths) { nodes { path size } } } }
}`,
          variables: {
            project: decodeURIComponent(this.project),
            ref,
            paths: paths.slice(start, start + GRAPHQL_BATCH),
          },
        },
      });
      for (const node of response.data?.project?.repository?.blobs?.nodes ?? []) {
        const size = Number(node.size);
        if (Number.isFinite(size)) sizes.set(node.path, size);
      }
    }
    return sizes;
  }

  private async lastCommitFor(path: string, ref: string): Promise<string> {
    const file = await gitlabJson<{ last_commit_id: string }>(
      this.api,
      this.repo(`/files/${encodeURIComponent(path)}?ref=${ref}`),
    );
    return file.last_commit_id;
  }

  async write(changes: FileChange[], { message, expectedRevision }: WriteOptions): Promise<{ revision: string }> {
    if (this.contentOnly) assertContentChanges(changes);
    // GitLab has no "only if the branch hasn't moved" option, so check first. The
    // per-file last_commit_id below still protects the files being saved from races.
    if ((await this.revision()) !== expectedRevision) throw new ConflictError();

    const existing = await this.tree(expectedRevision);
    const actions = await Promise.all(
      changes.map(async (change) => {
        const exists = existing.has(change.path);
        if ("delete" in change) {
          return exists
            ? {
                action: "delete",
                file_path: change.path,
                last_commit_id: await this.lastCommitFor(change.path, expectedRevision),
              }
            : undefined;
        }
        // Uploads such as images are sent as base64; text as it is, so commits stay readable.
        const content =
          "bytes" in change
            ? { content: encodeBase64Bytes(change.bytes), encoding: "base64" }
            : { content: change.content };
        return exists
          ? {
              action: "update",
              file_path: change.path,
              ...content,
              last_commit_id: await this.lastCommitFor(change.path, expectedRevision),
            }
          : { action: "create", file_path: change.path, ...content };
      }),
    );
    const toApply = actions.filter((action) => action !== undefined);
    if (toApply.length === 0) return { revision: expectedRevision };

    try {
      const commit = await gitlabJson<{ id: string }>(this.api, this.repo("/commits"), {
        method: "POST",
        body: {
          branch: this.branch,
          commit_message: message,
          actions: toApply,
          ...(this.options.author && {
            author_name: this.options.author.name,
            author_email: this.options.author.email,
          }),
        },
      });
      this.pinned = commit.id;
      return { revision: commit.id };
    } catch (error) {
      if (!(error instanceof GitApiError)) throw error;
      if (error.status === 403) throw new SignInError("cant-publish", "This GitLab account can't publish to the site.");
      // A file changed or appeared since the editor loaded, or the branch moved.
      const fileConflict = error.status === 400 && /already exists|changed since/i.test(error.message);
      if (fileConflict || (await this.revision()) !== expectedRevision) throw new ConflictError();
      throw error;
    }
  }

  async history(path: string, { page = 1, perPage = 20 }: HistoryOptions = {}): Promise<FileVersion[]> {
    const query = new URLSearchParams({
      ref_name: this.pinned ?? (await this.revision()),
      path,
      per_page: String(perPage),
      page: String(page),
    });
    const commits = await gitlabJson<
      Array<{ id: string; title: string; author_name?: string; authored_date?: string; committed_date?: string }>
    >(this.api, this.repo(`/commits?${query}`));
    return commits.map((commit) => ({
      revision: commit.id,
      date: commit.authored_date ?? commit.committed_date ?? "",
      author: commit.author_name || undefined,
      message: commit.title,
    }));
  }

  async readAt(path: string, revision: string): Promise<string | undefined> {
    const response = await gitlabRequest(
      this.api,
      this.repo(`/files/${encodeURIComponent(path)}/raw?${new URLSearchParams({ ref: revision })}`),
      { allow: [404] },
    );
    return response.ok ? response.text() : undefined;
  }

  async changedPaths(from: string, to: string): Promise<string[]> {
    const comparison = await gitlabJson<{ diffs?: Array<{ old_path: string; new_path: string }> }>(
      this.api,
      this.repo(`/compare?${new URLSearchParams({ from, to, straight: "true" })}`),
    );
    return [...new Set((comparison.diffs ?? []).flatMap((diff) => [diff.old_path, diff.new_path]))];
  }

  /**
   * Reads the commit's pipeline and external statuses (GitLab Pages jobs, or
   * Vercel). Before any exist, the site counts as building if it has pipelines.
   */
  async deployStatus(revision: string): Promise<DeployStatus> {
    try {
      const all = await gitlabJson<Array<{ name?: string; status: string; target_url?: string | null }>>(
        this.api,
        this.repo(`/commits/${revision}/statuses`),
      );
      // A job that only asks another host to rebuild the site, where the content is kept apart from the code,
      // says nothing about when it's live.
      const statuses = all.filter((status) => status.name !== REBUILD_JOB);
      if (all.length > 0 && statuses.length === 0) return { state: "unknown" };
      if (statuses.length === 0) {
        const pipelines = await gitlabJson<unknown[]>(this.api, `/projects/${this.project}/pipelines?per_page=1`);
        return { state: pipelines.length > 0 ? "building" : "unknown" };
      }
      const failed = statuses.find((status) => status.status === "failed" || status.status === "canceled");
      if (failed) {
        const problem = await this.jobProblem(revision).catch(() => undefined);
        return { state: "failed", detailsUrl: failed.target_url ?? undefined, ...(problem && { problem }) };
      }
      if (statuses.every((status) => status.status === "success" || status.status === "skipped")) {
        return { state: "live", detailsUrl: statuses[0]?.target_url ?? undefined };
      }
      return { state: "building", detailsUrl: statuses[0]?.target_url ?? undefined };
    } catch (error) {
      if (error instanceof GitApiError) return { state: "unknown" };
      throw error;
    }
  }

  /** Why a commit's pipeline failed: the failed job's reason, and its log for which command failed and why. */
  private async jobProblem(revision: string): Promise<BuildProblem | undefined> {
    const [pipeline] = await gitlabJson<Array<{ id: number }>>(
      this.api,
      `/projects/${this.project}/pipelines?${new URLSearchParams({ sha: revision, per_page: "1" })}`,
    );
    if (!pipeline) return undefined;
    const jobs = await gitlabJson<Array<{ id: number; name: string; status: string; failure_reason?: string }>>(
      this.api,
      `/projects/${this.project}/pipelines/${pipeline.id}/jobs?per_page=100`,
    );
    const failed = jobs.find((job) => job.status === "failed");
    if (!failed) return undefined;
    const reason = failed.failure_reason ?? "";
    const detail = `${failed.name}: ${reason}`;
    if (reason === "ci_quota_exceeded") return { step: "not-started", detail };
    if (/runner_system|stuck_or_timeout|scheduler|api_failure|data_integrity|job_execution_timeout/.test(reason)) {
      return { step: "host", detail };
    }
    if (failed.name === "pages:deploy") return { step: "deploy", detail };
    const response = await gitlabRequest(this.api, `/projects/${this.project}/jobs/${failed.id}/trace`, {
      allow: [403, 404],
    });
    const trace = response.ok ? await response.text() : "";
    const cause = findBuildCause(trace);
    // The command that was running when the job failed: GitLab logs each one on a line starting with "$ ".
    const command = trace
      .split("\n")
      .map((line) => line.replace(ANSI_CODES, "").replace(/^.*\r/, ""))
      .filter((line) => line.startsWith("$ "))
      .at(-1);
    const step: BuildProblem["step"] = cause ? "build" : ((command ? buildStepFor(command) : undefined) ?? "build");
    return { step, detail, ...(cause && { cause }) };
  }

  signOut(): void {
    this.onSignOut();
  }
}
