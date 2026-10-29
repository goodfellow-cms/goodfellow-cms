import {
  assertContentChanges,
  branchDrafts,
  ConflictError,
  type DeployStatus,
  DraftError,
  type DraftHost,
  EDITABLE_FOLDERS,
  type FileChange,
  type FileVersion,
  GitApiError,
  type GitBackend,
  type GitUser,
  type HistoryOptions,
  type OwnerAccess,
  type PluginTasks,
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
import { type ApiOptions, allPages, bitbucketJson, bitbucketRequest, type Paged, quoted } from "./api.js";
import { bitbucketCodeUpdates } from "./code-updates.js";
import { bitbucketEditors, bitbucketOwnerAccess, type Permission } from "./editors.js";
import { bitbucketScheduledBuilds } from "./scheduled-builds.js";
import { type BitbucketTasksOptions, bitbucketTasks } from "./tasks.js";
import { bitbucketUpdates } from "./updates.js";
import { BITBUCKET_WEB } from "./web.js";

/** How deep a folder's listing goes in one request: deeper than any of the site's folders. */
const LIST_DEPTH = 10;

/** How many files are read at once. */
const READ_BATCH = 8;

export interface BitbucketBackendOptions {
  api: ApiOptions;
  /** `workspace/repository`. */
  repo: string;
  branch: string;
  user: GitUser;
  /** What the sign-in can do in the repository, as Bitbucket says, where it says. */
  permission?: Permission;
  onSignOut: () => void;
  /** Who commits name as their author, where that isn't the sign-in's account, as on a full-stack site's server. */
  author?: { name: string; email: string };
  /** The commit reads see until `revision()` is next called, as a full-stack site's server reads what a browser loaded. */
  revision?: string;
  /** How plugins' tasks wait for their answers; tests pass short waits. */
  tasks?: BitbucketTasksOptions;
  /** The repository holds only the site's content (`GitBackend.contentOnly`). */
  contentOnly?: boolean;
  /** With `contentOnly`, the code's repository, whose updates the Updates screen follows. */
  code?: string;
  /** Where to make the owner token, which can change editors and the repository's Pipelines settings. */
  ownerTokenLink?: TokenLink;
}

/** A file or folder in one of Bitbucket's folder listings. */
interface Entry {
  type: "commit_file" | "commit_directory";
  path: string;
  size?: number;
}

/** A commit as Bitbucket lists it. */
interface Commit {
  hash: string;
  date?: string;
  message?: string;
  author?: { raw?: string; user?: { display_name?: string; nickname?: string } };
  parents?: Array<{ hash: string }>;
}

/** A build status another service, such as Vercel, reported on a commit, or one of Bitbucket Pipelines' own. */
interface CommitStatus {
  state: "SUCCESSFUL" | "FAILED" | "INPROGRESS" | "STOPPED";
  key?: string;
  name?: string;
  url?: string;
}

/**
 * Whether a status says when the site is live: Vercel's, or another host's.
 * Bitbucket Pipelines' own runs, the nightly update, scheduled changes'
 * check and plugins' tasks among them, link to Bitbucket and don't build it.
 */
function builds(status: CommitStatus): boolean {
  return !(status.url ?? "").startsWith(`${BITBUCKET_WEB}/`);
}

/** A path for Bitbucket's addresses: each part encoded, the slashes kept. */
export function encodePath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function listFrom(tree: Map<string, number>, dir: string): string[] {
  const prefix = `${dir}/`;
  return [...tree.keys()].filter((path) => path.startsWith(prefix)).sort();
}

/** The first line of a commit's message, as other hosts name a publish. */
function title(message: string | undefined): string {
  return (message ?? "").split("\n")[0]?.trim() ?? "";
}

/** The name in a commit's raw author, `Name <email>`. */
function authorName(commit: Commit): string | undefined {
  return commit.author?.user?.display_name || commit.author?.raw?.replace(/\s*<[^>]*>\s*$/, "").trim() || undefined;
}

/**
 * The site's files on Bitbucket Cloud. Reads come from the commit
 * `revision()` last returned. Saves are single commits made with the `src`
 * endpoint, which takes the commit the editor loaded as the new commit's
 * parent and refuses with 409 when the branch has moved since, so nobody's
 * change is overwritten.
 */
export class BitbucketBackend implements GitBackend {
  readonly user: GitUser;
  readonly editors: SiteEditors;
  readonly ownerAccess: OwnerAccess;
  /** Absent where the repository holds only content: its update runs where the code is. */
  readonly updates?: SiteUpdates;
  readonly drafts: SiteDrafts;
  readonly scheduledBuilds: ScheduledBuilds;
  readonly tasks: PluginTasks;
  readonly contentOnly: boolean;
  private readonly options: BitbucketBackendOptions;
  private readonly api: ApiOptions;
  private readonly repo: string;
  private readonly branch: string;
  private readonly onSignOut: () => void;
  private readonly owner: ReturnType<typeof bitbucketOwnerAccess>;
  private pinned?: string;
  /** Path → size for the editable files at a commit. */
  private readonly trees = new Map<string, Promise<Map<string, number>>>();
  /** File texts by `commit:path`, carried over to later commits where a file didn't change. */
  private readonly texts = new Map<string, Promise<string>>();

  constructor(options: BitbucketBackendOptions) {
    this.options = options;
    this.api = options.api;
    this.repo = options.repo;
    this.branch = options.branch;
    this.user = options.user;
    this.onSignOut = options.onSignOut;
    this.pinned = options.revision;
    this.contentOnly = options.contentOnly === true;
    this.owner = bitbucketOwnerAccess(
      this.api,
      this.repo,
      options.ownerTokenLink ?? {
        url: `${BITBUCKET_WEB}/${this.repo}/admin/access-tokens`,
        label: "owner.token.create",
      },
    );
    this.ownerAccess = this.owner.access;
    const setup = async () => this.readAt("bitbucket-pipelines.yml", this.pinned ?? (await this.revision()));
    this.editors = bitbucketEditors(this.api, this.owner.api, this.repo, this.user, options.permission);
    if (!this.contentOnly) {
      this.updates = bitbucketUpdates(this.api, this.owner.api, this.repo, this.branch, setup);
    } else if (options.code) {
      const code = options.code;
      this.updates = bitbucketCodeUpdates(
        this.api,
        this.owner.api,
        code,
        (branch) => new BitbucketBackend({ api: this.api, repo: code, branch, user: this.user, onSignOut: () => {} }),
      );
    }
    this.drafts = branchDrafts(this, this.draftHost());
    this.scheduledBuilds = bitbucketScheduledBuilds(this.api, this.owner.api, this.repo, this.branch, setup);
    this.tasks = bitbucketTasks(this.api, this.repo, this.branch, setup, options.tasks);
  }

  private path(rest: string): string {
    return `/repositories/${this.repo}${rest}`;
  }

  async repositoryVisibility(): Promise<RepositoryVisibility> {
    const { is_private: hidden } = await bitbucketJson<{ is_private?: boolean }>(this.api, this.path(""));
    return hidden === false ? "public" : "private";
  }

  /** Drafts on branches of the repository, with pull requests for review. */
  private draftHost(): DraftHost {
    const head = async (branch: string) => {
      const response = await bitbucketRequest(this.api, this.path(`/refs/branches/${encodeURIComponent(branch)}`), {
        allow: [404],
      });
      if (!response.ok) return undefined;
      return ((await response.json()) as { target: { hash: string } }).target.hash;
    };
    const openRequests = async (branch: string) => {
      const query = new URLSearchParams({ q: `source.branch.name = ${quoted(branch)} AND state = "OPEN"` });
      const open = await bitbucketJson<Paged<{ id: number; links: { html: { href: string } } }>>(
        this.api,
        this.path(`/pullrequests?${query}`),
      );
      return open.values;
    };
    /** Reviewers as Bitbucket names them, by account id, from the workspace's members; people it doesn't have are left out. */
    const reviewerAccounts = async (nicknames: readonly string[]) => {
      const workspace = this.repo.split("/")[0] ?? "";
      const members = await allPages<{ user: { account_id?: string; nickname?: string } }>(
        this.api,
        `/workspaces/${workspace}/members?pagelen=100`,
        10,
      ).catch(() => []);
      return nicknames.flatMap((nickname) => {
        const found = members.find((member) => member.user.nickname?.toLowerCase() === nickname.toLowerCase());
        return found?.user.account_id ? [{ account_id: found.user.account_id }] : [];
      });
    };
    return {
      liveBranch: this.branch,
      branchStore: (branch) => new BitbucketBackend({ ...this.options, branch, revision: undefined }),
      createBranch: async (branch, revision) => {
        const response = await bitbucketRequest(this.api, this.path("/refs/branches"), {
          body: { name: branch, target: { hash: revision } },
          allow: [400, 409],
        });
        if (response.ok) return;
        if (await head(branch)) throw new DraftError("exists", `There's already a draft called ${branch}.`);
        throw new GitApiError(response.status, `Bitbucket couldn't make the branch ${branch}.`);
      },
      deleteBranch: async (branch) => {
        await bitbucketRequest(this.api, this.path(`/refs/branches/${encodeURIComponent(branch)}`), {
          method: "DELETE",
          allow: [404],
        });
      },
      mergeBase: async (branch) => {
        const [draft, live] = await Promise.all([head(branch), head(this.branch)]);
        if (!draft || !live) throw new DraftError("not-found", `There's no draft ${branch}.`);
        const base = await bitbucketJson<{ hash: string }>(this.api, this.path(`/merge-base/${draft}..${live}`));
        return base.hash;
      },
      listBranches: async (prefix) => {
        const query = new URLSearchParams({ q: `name ~ ${quoted(prefix)}`, pagelen: "100" });
        const branches = await allPages<{ name: string }>(this.api, this.path(`/refs/branches?${query}`), 5);
        return branches.map((found) => found.name).filter((name) => name.startsWith(prefix));
      },
      openReview: async ({ branch, title: name, description, reviewers = [] }) => {
        const open = (people: Array<{ account_id: string }>) =>
          bitbucketRequest(this.api, this.path("/pullrequests"), {
            body: {
              title: name,
              description,
              source: { branch: { name: branch } },
              destination: { branch: { name: this.branch } },
              close_source_branch: true,
              ...(people.length > 0 && { reviewers: people }),
            },
            allow: [400, 403, 404],
          });
        // The one who opens it can't review it.
        const people = await reviewerAccounts(
          reviewers.filter((login) => login.toLowerCase() !== this.user.login.toLowerCase()),
        );
        let response = await open(people);
        // Bitbucket refuses the whole pull request over a reviewer it won't take, so it's opened without them.
        if (response.status === 400 && people.length > 0) response = await open([]);
        if (response.ok)
          return { url: ((await response.json()) as { links: { html: { href: string } } }).links.html.href };
        if (response.status !== 400) {
          throw new DraftError("no-reviews", "This sign-in can't open pull requests on the site's repository.");
        }
        // Bitbucket refuses a second pull request from the same branch: give the open one's address.
        const [found] = await openRequests(branch);
        if (!found) throw new DraftError("no-reviews", "Bitbucket couldn't open the pull request.");
        return { url: found.links.html.href };
      },
      listReviews: async (prefix) => {
        const query = new URLSearchParams({
          q: `source.branch.name ~ ${quoted(prefix)} AND state = "OPEN"`,
          pagelen: "50",
        });
        const open = await allPages<{
          title: string;
          source: { branch: { name: string } };
          links: { html: { href: string } };
        }>(this.api, this.path(`/pullrequests?${query}`), 5);
        return open
          .filter((request) => request.source.branch.name.startsWith(prefix))
          .map((request) => ({
            branch: request.source.branch.name,
            url: request.links.html.href,
            title: request.title,
          }));
      },
      closeReview: async (branch) => {
        for (const request of await openRequests(branch)) {
          await bitbucketRequest(this.api, this.path(`/pullrequests/${request.id}/decline`), {
            body: {},
            allow: [400, 403, 404],
          });
        }
      },
    };
  }

  async revision(): Promise<string> {
    const before = this.pinned;
    this.pinned = await this.head();
    // Files nobody changed since are read again from what's kept rather than from Bitbucket.
    if (before && before !== this.pinned && this.hasTextsAt(before)) {
      const changed = await this.changedPaths(before, this.pinned).catch(() => undefined);
      if (changed) this.carryOver(before, this.pinned, new Set(changed));
    }
    return this.pinned;
  }

  /** The branch's latest commit, without moving the revision reads are pinned to. */
  private async head(): Promise<string> {
    const branch = await bitbucketJson<{ target: { hash: string } }>(
      this.api,
      this.path(`/refs/branches/${encodeURIComponent(this.branch)}`),
    );
    return branch.target.hash;
  }

  private hasTextsAt(sha: string): boolean {
    for (const key of this.texts.keys()) if (key.startsWith(`${sha}:`)) return true;
    return false;
  }

  /** Keeps the texts read at `from` for `to` too, but for the files that changed between them. */
  private carryOver(from: string, to: string, changed: Set<string>): void {
    for (const [key, text] of [...this.texts]) {
      if (!key.startsWith(`${from}:`)) continue;
      const path = key.slice(from.length + 1);
      if (!changed.has(path) && !this.texts.has(`${to}:${path}`)) this.texts.set(`${to}:${path}`, text);
    }
  }

  /** Every file in one folder at a commit, with its size, page by page. */
  private async listFolder(sha: string, dir: string): Promise<Array<[string, number]>> {
    const query = new URLSearchParams({ max_depth: String(LIST_DEPTH), pagelen: "100" });
    const first = await bitbucketRequest(this.api, this.path(`/src/${sha}/${encodePath(dir)}/?${query}`), {
      allow: [404],
    });
    if (first.status === 404) return [];
    const files: Array<[string, number]> = [];
    let page = (await first.json()) as Paged<Entry>;
    for (;;) {
      for (const entry of page.values) if (entry.type === "commit_file") files.push([entry.path, entry.size ?? 0]);
      if (!page.next) return files;
      page = await bitbucketJson<Paged<Entry>>(this.api, page.next);
    }
  }

  /** Path → size for the editable files at a commit. Commits never change, so this is kept. */
  private tree(sha: string): Promise<Map<string, number>> {
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

  private async current(): Promise<string> {
    return this.pinned ?? (await this.revision());
  }

  async read(path: string): Promise<string | undefined> {
    const sha = await this.current();
    return this.readFrom(sha, await this.tree(sha), path);
  }

  private readFrom(sha: string, tree: Map<string, number>, path: string): Promise<string | undefined> {
    if (!tree.has(path)) return Promise.resolve(undefined);
    const key = `${sha}:${path}`;
    let text = this.texts.get(key);
    if (!text) {
      text = bitbucketRequest(this.api, this.path(`/src/${sha}/${encodePath(path)}`)).then((response) =>
        response.text(),
      );
      text.catch(() => this.texts.delete(key));
      this.texts.set(key, text);
    }
    return text;
  }

  /** Reads many text files, a few at a time, since Bitbucket has no way to read several in one request. */
  async readFiles(paths: string[]): Promise<Map<string, string>> {
    const sha = await this.current();
    return this.readFilesFrom(sha, await this.tree(sha), paths);
  }

  private async readFilesFrom(sha: string, tree: Map<string, number>, paths: string[]): Promise<Map<string, string>> {
    const result = new Map<string, string>();
    const wanted = paths.filter((path) => tree.has(path));
    for (let start = 0; start < wanted.length; start += READ_BATCH) {
      const batch = wanted.slice(start, start + READ_BATCH);
      const texts = await Promise.all(batch.map((path) => this.readFrom(sha, tree, path)));
      batch.forEach((path, index) => {
        const text = texts[index];
        if (text !== undefined) result.set(path, text);
      });
    }
    return result;
  }

  async readBytes(path: string): Promise<Uint8Array | undefined> {
    const sha = await this.current();
    return this.bytesFrom(sha, await this.tree(sha), path);
  }

  private async bytesFrom(sha: string, tree: Map<string, number>, path: string): Promise<Uint8Array | undefined> {
    if (!tree.has(path)) return undefined;
    const response = await bitbucketRequest(this.api, this.path(`/src/${sha}/${encodePath(path)}`));
    return new Uint8Array(await response.arrayBuffer());
  }

  async list(dir: string): Promise<string[]> {
    return listFrom(await this.tree(await this.current()), dir);
  }

  filesAt(revision: string): RevisionFiles {
    return {
      read: async (path) => this.readFrom(revision, await this.tree(revision), path),
      readFiles: async (paths) => this.readFilesFrom(revision, await this.tree(revision), paths),
      readBytes: async (path) => this.bytesFrom(revision, await this.tree(revision), path),
      list: async (dir) => listFrom(await this.tree(revision), dir),
    };
  }

  /** Bitbucket's folder listings say how large each file is. */
  async fileSizes(dir: string): Promise<Map<string, number>> {
    const tree = await this.tree(await this.current());
    return new Map(listFrom(tree, dir).map((path) => [path, tree.get(path) ?? 0]));
  }

  /** Whether a file exists at a commit: from the listing in the editable folders, and from Bitbucket elsewhere, such as the config. */
  private async existsAt(tree: Map<string, number>, path: string, sha: string): Promise<boolean> {
    if (EDITABLE_FOLDERS.some((folder) => path.startsWith(`${folder}/`))) return tree.has(path);
    const response = await bitbucketRequest(this.api, this.path(`/src/${sha}/${encodePath(path)}?format=meta`), {
      allow: [404],
    });
    return response.ok;
  }

  async write(changes: FileChange[], { message, expectedRevision }: WriteOptions): Promise<{ revision: string }> {
    if (this.contentOnly) assertContentChanges(changes);
    const existing = await this.tree(expectedRevision);
    const form = new FormData();
    let count = 0;
    for (const change of changes) {
      if ("delete" in change) {
        // Bitbucket deletes a file named in `files` with no content of its own.
        if (!(await this.existsAt(existing, change.path, expectedRevision))) continue;
        form.append("files", change.path);
      } else {
        const content = "bytes" in change ? new Uint8Array(change.bytes) : change.content;
        // A leading slash keeps a file called "message" or "branch" from being taken for the commit's details.
        form.append(`/${change.path}`, new Blob([content]), change.path.split("/").at(-1) ?? change.path);
      }
      count += 1;
    }
    if (count === 0) return { revision: expectedRevision };
    form.append("message", message);
    form.append("branch", this.branch);
    // With the branch and its parent given, Bitbucket refuses (409) when the branch has moved on.
    form.append("parents", expectedRevision);
    if (this.options.author) form.append("author", `${this.options.author.name} <${this.options.author.email}>`);

    const response = await bitbucketRequest(this.api, this.path("/src"), { form, allow: [403, 409] });
    if (response.status === 409) throw new ConflictError();
    if (response.status === 403) {
      throw new SignInError("cant-publish", "This Bitbucket account can't publish to the site.");
    }
    const made = await this.commitAfter(expectedRevision, message);
    if (!made) {
      // Too many commits since to find it: what changed is read from Bitbucket, never assumed.
      this.pinned = expectedRevision;
      return { revision: await this.revision() };
    }
    this.carryOver(expectedRevision, made, new Set(changes.map((change) => change.path)));
    this.pinned = made;
    return { revision: made };
  }

  /**
   * The commit a save just made: Bitbucket doesn't let browsers read the
   * address it answers with, so it's found on the branch, as the newest
   * commit whose parent is the one the save started from, if it's among the
   * branch's newest.
   */
  private async commitAfter(parent: string, message: string): Promise<string | undefined> {
    const query = new URLSearchParams({ pagelen: "20" });
    const recent = await bitbucketJson<Paged<Commit>>(
      this.api,
      this.path(`/commits/${encodeURIComponent(this.branch)}?${query}`),
    );
    const made =
      recent.values.find(
        (commit) => commit.parents?.[0]?.hash === parent && title(commit.message) === title(message),
      ) ?? recent.values.find((commit) => commit.parents?.[0]?.hash === parent);
    return made?.hash;
  }

  async history(path: string, { page = 1, perPage = 20 }: HistoryOptions = {}): Promise<FileVersion[]> {
    const query = new URLSearchParams({ path, pagelen: String(perPage) });
    let next: string | undefined = this.path(`/commits/${await this.current()}?${query}`);
    let found: Paged<Commit> = { values: [] };
    // Bitbucket's pages of commits are reached one after another.
    for (let at = 1; next && at <= page; at++) {
      found = await bitbucketJson<Paged<Commit>>(this.api, next);
      next = found.next;
      if (at < page && !next) return [];
    }
    return found.values.map((commit) => ({
      revision: commit.hash,
      date: commit.date ?? "",
      author: authorName(commit),
      message: title(commit.message),
    }));
  }

  async readAt(path: string, revision: string): Promise<string | undefined> {
    const response = await bitbucketRequest(this.api, this.path(`/src/${revision}/${encodePath(path)}`), {
      allow: [404],
    });
    return response.ok ? response.text() : undefined;
  }

  async changedPaths(from: string, to: string): Promise<string[]> {
    // Bitbucket's diffstat names the newer commit first, the opposite of git's order.
    const query = new URLSearchParams({ topic: "false", pagelen: "500" });
    const diffs = await allPages<{ old?: { path: string } | null; new?: { path: string } | null }>(
      this.api,
      this.path(`/diffstat/${to}..${from}?${query}`),
    );
    const paths = diffs.flatMap((diff) => [diff.old?.path, diff.new?.path]);
    return [...new Set(paths.filter((path): path is string => Boolean(path)))];
  }

  /**
   * Reads the build statuses the host that builds the site, such as Vercel,
   * reported on the commit. Before any exist, the site counts as building
   * if the host reported on the commit before, since it reports a little late.
   */
  async deployStatus(revision: string): Promise<DeployStatus> {
    try {
      const all = await this.statuses(revision);
      const statuses = all.filter(builds);
      if (statuses.length === 0) {
        if (all.length > 0) return { state: "unknown" };
        const commit = await bitbucketJson<Commit>(this.api, this.path(`/commit/${revision}`));
        const parent = commit.parents?.[0]?.hash;
        const before = parent ? (await this.statuses(parent)).filter(builds) : [];
        return { state: before.length > 0 ? "building" : "unknown" };
      }
      const failed =
        statuses.find((status) => status.state === "FAILED") ?? statuses.find((status) => status.state === "STOPPED");
      if (failed?.state === "STOPPED") {
        // A newer publish stops a build that's still running, and its own build includes this commit.
        const head = await this.head();
        if (head !== revision) return this.deployStatus(head);
      }
      if (failed) return { state: "failed", ...(failed.url && { detailsUrl: failed.url }) };
      const detailsUrl = statuses[0]?.url;
      const state = statuses.every((status) => status.state === "SUCCESSFUL") ? "live" : "building";
      return { state, ...(detailsUrl && { detailsUrl }) };
    } catch (error) {
      if (error instanceof GitApiError) return { state: "unknown" };
      throw error;
    }
  }

  private statuses(revision: string): Promise<CommitStatus[]> {
    return allPages<CommitStatus>(this.api, this.path(`/commit/${revision}/statuses?pagelen=100`), 3);
  }

  signOut(): void {
    this.ownerAccess.forget();
    this.onSignOut();
  }
}
