/**
 * A fake of the parts of Bitbucket Cloud's API that `@goodfellow-cms/bitbucket`
 * uses, backed by an in-memory repository, including the browser sign-in that
 * sends a token back in the address. For tests only.
 */
import { BITBUCKET_PIPELINE_NAMES, type FileChange, TASK_BRANCH_PREFIX, TASK_RESULT_FILE } from "@goodfellow-cms/core";
import { FakeConflictError, FakeRepo, fakeFileBytes } from "@goodfellow-cms/core/testing";

export interface FakeBitbucketUser {
  nickname: string;
  displayName?: string;
  /** What they can do in the site's repository. Defaults to `admin`. */
  permission?: "admin" | "write" | "read";
}

export interface FakeBitbucketOptions {
  /** `workspace/repository`. */
  repo: string;
  files?: Record<string, string>;
  /**
   * Tokens and who they are: an account's API token, sent with its email
   * address as `email:token`, or, with `access`, a repository access token,
   * which belongs to no account.
   */
  tokens?: Record<string, FakeBitbucketUser & { email?: string; access?: boolean }>;
  /**
   * The OAuth consumer's key, its callback URL, and the user who signs in
   * through it; with `secret`, a private consumer, which can also use the code
   * grant, as the Claude connector does.
   */
  oauth?: { clientId: string; callback: string; user: FakeBitbucketUser; secret?: string };
  /** Simulates Vercel building each published commit, live after being checked this many times. Off by default. */
  deployAfterChecks?: number;
  /** Other people in the repository's workspace, who can be given permissions. */
  members?: string[];
  /** Who can see the repository. Private by default. */
  private?: boolean;
  /** Whether Pipelines is turned on. Off by default, as in a new repository. */
  pipelines?: boolean;
  /**
   * Answers plugins' tasks, as the site's `plugin-task` pipeline would: given
   * its variables, the text it leaves on its answer branch, or nothing for a
   * pipeline that fails. Without it, task pipelines fail.
   */
  tasks?: (variables: Record<string, string>) => string | undefined | Promise<string | undefined>;
  /** Workspaces the users can create repositories in, besides their own. */
  workspaces?: string[];
}

/** A run of one of the repository's custom pipelines. */
export interface FakePipeline {
  uuid: string;
  buildNumber: number;
  pattern: string;
  variables: Record<string, string>;
  state: "PENDING" | "IN_PROGRESS" | "COMPLETED";
  result?: "SUCCESSFUL" | "FAILED";
  createdOn: string;
  /** What its one step logged. */
  log: string;
}

/** A schedule that runs one of the repository's custom pipelines. */
export interface FakeSchedule {
  uuid: string;
  pattern: string;
  branch: string;
  cron: string;
  enabled: boolean;
}

/** A repository created through the fake's API, as `bitbucketSetup()` creates them. */
export interface FakeCreatedRepo {
  repo: FakeRepo;
  private: boolean;
  description?: string;
  mainBranch?: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function error(status: number, message: string): Response {
  return json({ type: "error", error: { message } }, status);
}

/** Bitbucket's filters (`q=`) as the backend writes them: one field, an operator and a quoted value. */
function filterValue(query: string | null, field: string): { op: string; value: string } | undefined {
  if (!query) return undefined;
  const match = new RegExp(`${field.replace(/\./g, "\\.")}\\s*(~|=|IN)\\s*\\(?"((?:[^"\\\\]|\\\\.)*)"`).exec(query);
  return match ? { op: match[1] ?? "=", value: (match[2] ?? "").replace(/\\(.)/g, "$1") } : undefined;
}

function account(user: FakeBitbucketUser) {
  return {
    uuid: `{${user.nickname}}`,
    account_id: `account-${user.nickname}`,
    nickname: user.nickname,
    username: user.nickname,
    display_name: user.displayName ?? user.nickname,
    links: { avatar: { href: `https://avatar.example/${user.nickname}.png` } },
  };
}

export function fakeBitbucket(options: FakeBitbucketOptions) {
  const api = "https://api.bitbucket.org/2.0";
  const web = "https://bitbucket.org";
  const [workspace = ""] = options.repo.split("/");
  const repo = new FakeRepo(options.files);
  const tokens = new Map(
    Object.entries(
      options.tokens ?? { "editor@example.org:test-token": { nickname: "editor", displayName: "Test Editor" } },
    ),
  );
  /** Who each commit that named its author did name, by commit. */
  const commitAuthors = new Map<string, string>();
  /** Explicit permissions on the repository, by account uuid. */
  const permissions = new Map<string, { user: FakeBitbucketUser; permission: "admin" | "write" | "read" }>();
  /** Everyone in the workspace. */
  const members = new Map<string, FakeBitbucketUser>();
  for (const user of [...tokens.values(), ...(options.oauth ? [options.oauth.user] : [])]) {
    if ("access" in user && user.access) continue;
    members.set(user.nickname, user);
    permissions.set(`{${user.nickname}}`, { user, permission: user.permission ?? "admin" });
  }
  for (const name of options.members ?? []) if (!members.has(name)) members.set(name, { nickname: name });
  const oauthTokens = new Map<string, FakeBitbucketUser>();
  /** Codes and refresh tokens the code grant gave, which each work once here. */
  const oauthCodes = new Set<string>();
  const refreshTokens = new Set<string>();
  const pipelines: FakePipeline[] = [];
  const schedules: FakeSchedule[] = [];
  const variables = new Map<string, { uuid: string; value: string; secured: boolean }>();
  const settings = { pipelines: options.pipelines ?? false, private: options.private ?? true };
  const created = new Map<string, FakeCreatedRepo>();
  const failed = new Set<string>();
  const checks = new Map<string, number>();
  const requests: Array<{ method: string; path: string }> = [];
  let count = 0;
  const nextId = () => `{${(++count).toString(16).padStart(8, "0")}-0000-4000-8000-000000000000}`;

  /** Who a request's `Authorization` header says it's from. */
  function who(request: Request): (FakeBitbucketUser & { access?: boolean }) | undefined {
    const header = request.headers.get("authorization") ?? "";
    if (header.startsWith("Basic ")) return tokens.get(atob(header.slice(6)));
    if (header.startsWith("Bearer ")) {
      const token = header.slice(7);
      return tokens.get(token) ?? oauthTokens.get(token);
    }
    return undefined;
  }

  function permissionOf(user: FakeBitbucketUser & { access?: boolean }): "admin" | "write" | "read" {
    if (user.access) return user.permission ?? "write";
    return permissions.get(`{${user.nickname}}`)?.permission ?? user.permission ?? "admin";
  }

  function commitJson(sha: string) {
    const commit = repo.commitAt(sha);
    if (!commit) return undefined;
    const author = commitAuthors.get(sha) ?? commit.author ?? "Someone <someone@example.org>";
    return {
      hash: sha,
      date: commit.date,
      message: `${commit.message}\n`,
      author: { raw: author.includes("<") ? author : `${author} <${author}@example.org>` },
      parents: commit.parent ? [{ hash: commit.parent }] : [],
    };
  }

  function resolve(ref: string, target: FakeRepo = repo): string | undefined {
    const decoded = decodeURIComponent(ref);
    return target.branches.get(decoded) ?? (target.commitAt(decoded) ? decoded : undefined);
  }

  /** A list's page: `pagelen` items, and the address of the next page. */
  function page<T>(url: URL, items: T[]): Response {
    const size = Number(url.searchParams.get("pagelen") ?? 10);
    const at = Number(url.searchParams.get("page") ?? 1);
    const values = items.slice((at - 1) * size, at * size);
    const next = new URL(url);
    next.searchParams.set("page", String(at + 1));
    return json({ values, pagelen: size, page: at, ...(at * size < items.length && { next: next.toString() }) });
  }

  /** The commit Vercel reports on: in progress until it's been checked enough times, or failed. */
  function statuses(sha: string) {
    if (options.deployAfterChecks === undefined) return [];
    const seen = (checks.get(sha) ?? 0) + 1;
    checks.set(sha, seen);
    const state = failed.has(sha) ? "FAILED" : seen > options.deployAfterChecks ? "SUCCESSFUL" : "INPROGRESS";
    return [{ key: "vercel", name: "Vercel", state, url: `https://vercel.com/parish/site/${sha.slice(0, 7)}` }];
  }

  async function commitForm(form: FormData, target: FakeRepo, user: FakeBitbucketUser & { access?: boolean }) {
    const branch = String(form.get("branch") ?? target.defaultBranch);
    const parents = form.get("parents");
    const changes: FileChange[] = [];
    for (const [key, value] of form.entries()) {
      if (key === "files" && typeof value === "string") {
        // A path in `files` with no content of its own is deleted.
        if (!form.has(`/${value}`) && !form.has(value)) changes.push({ path: value, delete: true });
        continue;
      }
      if (typeof value === "string") continue;
      changes.push({ path: key.replace(/^\/+/, ""), bytes: new Uint8Array(await value.arrayBuffer()) });
    }
    const message = String(form.get("message") ?? "Edited online with Bitbucket");
    const author = form.get("author");
    const name =
      typeof author === "string" ? author : `${user.displayName ?? user.nickname} <${user.nickname}@example.org>`;
    if (!target.branches.has(branch)) {
      const from = typeof parents === "string" ? parents : target.head();
      target.branches.set(branch, from);
    }
    const sha = target.commit(changes, message, {
      branch,
      ...(typeof parents === "string" && { expectedHead: parents }),
      author: name,
    });
    if (typeof author === "string") commitAuthors.set(sha, author);
    return sha;
  }

  /** Runs a custom pipeline as the site's `bitbucket-pipelines.yml` would. */
  async function runPipeline(pattern: string, vars: Record<string, string>): Promise<FakePipeline> {
    const pipeline: FakePipeline = {
      uuid: nextId(),
      buildNumber: pipelines.length + 1,
      pattern,
      variables: vars,
      state: "COMPLETED",
      result: "SUCCESSFUL",
      createdOn: new Date(Date.UTC(2026, 0, 6, 9, pipelines.length)).toISOString(),
      log: "",
    };
    pipelines.push(pipeline);
    if (pattern === BITBUCKET_PIPELINE_NAMES.task) {
      const answer = await options.tasks?.(vars);
      const request = vars.GOODFELLOW_TASK_REQUEST ?? "";
      if (answer === undefined || !/^[a-z0-9]+$/.test(request)) {
        pipeline.result = "FAILED";
      } else {
        const sha = repo.addCommit(
          undefined,
          `The answer to plugin task ${request}`,
          new Map([[TASK_RESULT_FILE, answer]]),
        );
        repo.branches.set(`${TASK_BRANCH_PREFIX}${request}`, sha);
      }
    }
    return pipeline;
  }

  /** Adds a finished run of the update pipeline, as a schedule would have started it, with what it logged. */
  function addUpdateRun(log: string, state: FakePipeline["state"] = "COMPLETED"): FakePipeline {
    const pipeline: FakePipeline = {
      uuid: nextId(),
      buildNumber: pipelines.length + 1,
      pattern: BITBUCKET_PIPELINE_NAMES.update,
      variables: {},
      state,
      ...(state === "COMPLETED" && { result: "SUCCESSFUL" as const }),
      createdOn: new Date(Date.UTC(2026, 0, 6, 9, pipelines.length)).toISOString(),
      log,
    };
    pipelines.push(pipeline);
    return pipeline;
  }

  /** Answers the repositories' API, for the site's repository or one created through the fake. */
  async function repository(
    request: Request,
    url: URL,
    name: string,
    rest: string,
    user: FakeBitbucketUser & { access?: boolean },
  ): Promise<Response> {
    const own = name === options.repo;
    const made = created.get(name);
    const target = own ? repo : made?.repo;
    const method = request.method;
    if (!target) {
      if (rest === "" && method === "POST") {
        if (created.has(name)) return error(400, "Repository with this Slug and Owner already exists.");
        const body = (await request.json()) as { is_private?: boolean; description?: string };
        const fresh: FakeCreatedRepo = {
          repo: new FakeRepo({}),
          private: body.is_private !== false,
          ...(body.description && { description: body.description }),
        };
        created.set(name, fresh);
        return json({ full_name: name, is_private: fresh.private }, 200);
      }
      return error(404, `Repository ${name} not found`);
    }
    if (rest === "" && method === "POST") return error(400, "Repository with this Slug and Owner already exists.");
    // A repository access token reaches only the repository it was made for.
    if (!own && user.access) return error(403, "This token has no access to this repository.");
    if (own && user.access === undefined && !permissions.has(`{${user.nickname}}`) && settings.private) {
      return error(403, "You don't have access to this repository.");
    }
    const writes = method !== "GET";
    if (writes && permissionOf(user) === "read" && own) return error(403, "You need write access.");

    if (rest === "") {
      if (method === "PUT") {
        const body = (await request.json()) as { mainbranch?: { name: string } };
        if (made && body.mainbranch) made.mainBranch = body.mainbranch.name;
        return json({ full_name: name });
      }
      return json({
        full_name: name,
        is_private: own ? settings.private : made?.private,
        mainbranch: { name: own ? repo.defaultBranch : (made?.mainBranch ?? "main") },
      });
    }

    const branchMatch = rest.match(/^\/refs\/branches\/(.+)$/);
    if (branchMatch?.[1]) {
      const branch = decodeURIComponent(branchMatch[1]);
      const sha = target.branches.get(branch);
      if (method === "DELETE") {
        if (!sha) return error(404, "Branch not found");
        target.branches.delete(branch);
        return new Response(null, { status: 204 });
      }
      return sha ? json({ name: branch, target: { hash: sha } }) : error(404, "Branch not found");
    }
    if (rest === "/refs/branches") {
      if (method === "POST") {
        const body = (await request.json()) as { name: string; target: { hash: string } };
        if (target.branches.has(body.name)) return error(400, "BRANCH_ALREADY_EXISTS");
        if (!target.commitAt(body.target.hash)) return error(404, "No such commit");
        target.branches.set(body.name, body.target.hash);
        return json({ name: body.name, target: { hash: body.target.hash } }, 201);
      }
      const filter = filterValue(url.searchParams.get("q"), "name");
      const names = [...target.branches.keys()].filter(
        (branch) => !filter || (filter.op === "~" ? branch.includes(filter.value) : branch === filter.value),
      );
      return page(
        url,
        names.map((branch) => ({ name: branch, target: { hash: target.branches.get(branch) } })),
      );
    }

    if (rest === "/src" && method === "POST") {
      const form = await request.formData();
      try {
        await commitForm(form, target, user);
      } catch (thrown) {
        if (thrown instanceof FakeConflictError) return error(409, "Parent is not the branch's head.");
        throw thrown;
      }
      return new Response(null, { status: 201 });
    }
    const src = rest.match(/^\/src\/([^/]+)\/(.*)$/);
    if (src?.[1] !== undefined) {
      const sha = resolve(src[1], target);
      if (!sha) return error(404, "No such commit");
      const path = decodeURIComponent(src[2] ?? "").replace(/\/$/, "");
      const files = target.files(sha);
      const file = files.get(path);
      if (file !== undefined && !rest.endsWith("/")) {
        if (url.searchParams.get("format") === "meta") {
          return json({ path, type: "commit_file", size: fakeFileBytes(file).length });
        }
        return new Response(fakeFileBytes(file));
      }
      const prefix = path ? `${path}/` : "";
      const inside = [...files.keys()].filter((candidate) => candidate.startsWith(prefix)).sort();
      if (inside.length === 0) return error(404, "No such file or directory");
      const entries = inside.map((candidate) => ({
        type: "commit_file",
        path: candidate,
        size: fakeFileBytes(files.get(candidate) ?? "").length,
      }));
      return page(url, entries);
    }

    const commits = rest.match(/^\/commits\/(.+)$/);
    if (commits?.[1]) {
      const sha = resolve(commits[1], target);
      if (!sha) return error(404, "No such commit");
      const path = url.searchParams.get("path");
      const found = path ? target.history(path, sha) : historyOf(target, sha);
      return page(
        url,
        found.map((commit) => commitJson(commit.sha)),
      );
    }
    const commit = rest.match(/^\/commit\/([0-9a-f]{40})(\/statuses)?$/);
    if (commit?.[1]) {
      if (commit[2]) return page(url, statuses(commit[1]));
      const found = commitJson(commit[1]);
      return found ? json(found) : error(404, "No such commit");
    }
    const diffstat = rest.match(/^\/diffstat\/([0-9a-f]{40})\.\.([0-9a-f]{40})$/);
    if (diffstat?.[1] && diffstat[2]) {
      // The newer commit first, as Bitbucket names them.
      const changed = target.changedPaths(diffstat[2], diffstat[1]);
      const before = target.files(diffstat[2]);
      const after = target.files(diffstat[1]);
      return page(
        url,
        changed.map((path) => ({
          old: before.has(path) ? { path } : null,
          new: after.has(path) ? { path } : null,
        })),
      );
    }
    const mergeBase = rest.match(/^\/merge-base\/(.+)\.\.(.+)$/);
    if (mergeBase?.[1] && mergeBase[2]) {
      const base = target.mergeBase(decodeURIComponent(mergeBase[1]), decodeURIComponent(mergeBase[2]));
      return base ? json({ hash: base }) : error(404, "No common ancestor");
    }

    if (rest === "/pullrequests") {
      if (method === "POST") {
        const body = (await request.json()) as {
          title: string;
          description?: string;
          source: { branch: { name: string } };
          destination?: { branch: { name: string } };
          reviewers?: Array<{ account_id?: string }>;
        };
        const open = target.reviews.find(
          (review) => review.branch === body.source.branch.name && review.state === "open",
        );
        if (open) return error(400, "There are no changes to be pulled");
        const reviewers = (body.reviewers ?? []).map((reviewer) => {
          const member = [...members.values()].find((found) => `account-${found.nickname}` === reviewer.account_id);
          return member?.nickname;
        });
        // Bitbucket refuses the pull request where it can't find a reviewer, or the author is one.
        if (reviewers.some((nickname) => !nickname || nickname === user.nickname)) {
          return error(400, "Reviewers must be workspace members other than the author.");
        }
        const review = target.openReview(
          body.source.branch.name,
          body.title,
          body.description ?? "",
          body.destination?.branch.name,
          reviewers.filter((nickname): nickname is string => nickname !== undefined),
        );
        return json(
          { id: review.number, links: { html: { href: `${web}/${name}/pull-requests/${review.number}` } } },
          201,
        );
      }
      const source = filterValue(url.searchParams.get("q"), "source.branch.name");
      const found = target.reviews.filter(
        (review) =>
          review.state === "open" &&
          (!source || (source.op === "~" ? review.branch.includes(source.value) : review.branch === source.value)),
      );
      return page(
        url,
        found.map((review) => ({
          id: review.number,
          title: review.title,
          source: { branch: { name: review.branch } },
          links: { html: { href: `${web}/${name}/pull-requests/${review.number}` } },
        })),
      );
    }
    const decline = rest.match(/^\/pullrequests\/(\d+)\/decline$/);
    if (decline && method === "POST") {
      const review = target.reviews.find((found) => found.number === Number(decline[1]));
      if (!review) return error(404, "No such pull request");
      review.state = "closed";
      return json({ id: review.number, state: "DECLINED" });
    }

    // Everything below needs Admin, as Bitbucket's settings do.
    const admin = permissionOf(user) === "admin";
    const people = rest.match(/^\/permissions-config\/users(?:\/(.+))?$/);
    if (people) {
      if (!admin || user.access) return error(403, "You need admin access.");
      if (!people[1]) {
        return page(
          url,
          [...permissions.values()].map(({ user: person, permission }) => ({ user: account(person), permission })),
        );
      }
      const id = decodeURIComponent(people[1]);
      const person = [...members.values()].find((member) => `{${member.nickname}}` === id);
      if (!person) return error(404, "No such user");
      if (method === "GET") {
        const found = permissions.get(id);
        return found ? json({ user: account(person), permission: found.permission }) : error(404, "No permission");
      }
      if (method === "DELETE") {
        permissions.delete(id);
        return new Response(null, { status: 204 });
      }
      const body = (await request.json()) as { permission: "admin" | "write" | "read" };
      permissions.set(id, { user: person, permission: body.permission });
      return json({ user: account(person), permission: body.permission });
    }

    if (rest === "/pipelines/" || rest === "/pipelines") {
      if (method === "POST") {
        if (!settings.pipelines) return error(400, "Pipelines is not enabled for this repository.");
        const body = (await request.json()) as {
          target: { ref_name: string; selector: { pattern: string } };
          variables?: Array<{ key: string; value: string }>;
        };
        const vars = Object.fromEntries((body.variables ?? []).map((variable) => [variable.key, variable.value]));
        const pipeline = await runPipeline(body.target.selector.pattern, vars);
        return json(pipelineJson(pipeline), 201);
      }
      const pattern = url.searchParams.get("target.selector.pattern");
      const found = pipelines.filter((pipeline) => !pattern || pipeline.pattern === pattern).reverse();
      return page(url, found.map(pipelineJson));
    }
    const plain = decodeURIComponent(rest);
    const pipelineMatch = plain.match(/^\/pipelines\/(\{[^/]+\})(\/steps(?:\/(\{[^/]+\})(\/log)?)?)?$/);
    if (pipelineMatch?.[1]) {
      const pipeline = pipelines.find((candidate) => candidate.uuid === pipelineMatch[1]);
      if (!pipeline) return error(404, "No such pipeline");
      if (!pipelineMatch[2]) return json(pipelineJson(pipeline));
      const step = `{step-${pipeline.uuid.slice(1)}`;
      if (pipelineMatch[4]) return new Response(pipeline.log, { headers: { "content-type": "text/plain" } });
      return page(url, [{ uuid: step, state: { name: pipeline.state } }]);
    }

    if (rest === "/pipelines_config") {
      if (!admin) return error(403, "You need admin access.");
      if (method === "PUT") {
        const body = (await request.json()) as { enabled?: boolean };
        settings.pipelines = body.enabled === true;
      }
      return json({ enabled: settings.pipelines });
    }
    const schedule = plain.match(/^\/pipelines_config\/schedules(?:\/(\{[^/]+\}))?$/);
    if (schedule) {
      if (!admin) return error(403, "You need admin access.");
      if (!schedule[1]) {
        if (method === "POST") {
          const body = (await request.json()) as {
            cron_pattern: string;
            enabled: boolean;
            target: { ref_name: string; selector: { pattern: string } };
          };
          // Bitbucket's patterns have seven fields: seconds first, the year last.
          if (body.cron_pattern.trim().split(/\s+/).length !== 7) return error(400, "Invalid cron pattern");
          const added: FakeSchedule = {
            uuid: nextId(),
            pattern: body.target.selector.pattern,
            branch: body.target.ref_name,
            cron: body.cron_pattern,
            enabled: body.enabled,
          };
          schedules.push(added);
          return json(scheduleJson(added), 201);
        }
        return page(url, schedules.map(scheduleJson));
      }
      const found = schedules.find((candidate) => candidate.uuid === schedule[1]);
      if (!found) return error(404, "No such schedule");
      if (method === "DELETE") {
        schedules.splice(schedules.indexOf(found), 1);
        return new Response(null, { status: 204 });
      }
      if (method === "PUT") found.enabled = ((await request.json()) as { enabled: boolean }).enabled;
      return json(scheduleJson(found));
    }
    const variable = plain.match(/^\/pipelines_config\/variables(?:\/(\{[^/]+\}))?$/);
    if (variable) {
      if (!admin) return error(403, "You need admin access.");
      const byUuid = [...variables].find(([, found]) => found.uuid === variable[1]);
      if (!variable[1]) {
        if (method === "POST") {
          const body = (await request.json()) as { key: string; value: string; secured?: boolean };
          if (variables.has(body.key)) return error(409, "A variable with that name already exists.");
          const added = { uuid: nextId(), value: body.value, secured: body.secured === true };
          variables.set(body.key, added);
          return json({ uuid: added.uuid, key: body.key, value: added.secured ? "" : added.value }, 201);
        }
        return page(
          url,
          [...variables].map(([key, found]) => ({ uuid: found.uuid, key, value: found.secured ? "" : found.value })),
        );
      }
      if (!byUuid) return error(404, "No such variable");
      if (method === "DELETE") {
        variables.delete(byUuid[0]);
        return new Response(null, { status: 204 });
      }
      const body = (await request.json()) as { value: string };
      byUuid[1].value = body.value;
      return json({ uuid: byUuid[1].uuid, key: byUuid[0], value: body.value });
    }
    return error(404, `The fake doesn't answer ${method} ${rest}`);
  }

  function historyOf(target: FakeRepo, sha: string) {
    const found = [];
    for (
      let commit = target.commitAt(sha);
      commit;
      commit = commit.parent ? target.commitAt(commit.parent) : undefined
    ) {
      found.push(commit);
    }
    return found;
  }

  function pipelineJson(pipeline: FakePipeline) {
    return {
      uuid: pipeline.uuid,
      build_number: pipeline.buildNumber,
      created_on: pipeline.createdOn,
      target: { selector: { type: "custom", pattern: pipeline.pattern } },
      state: { name: pipeline.state, ...(pipeline.result && { result: { name: pipeline.result } }) },
    };
  }

  function scheduleJson(found: FakeSchedule) {
    return {
      uuid: found.uuid,
      enabled: found.enabled,
      cron_pattern: found.cron,
      target: { ref_name: found.branch, selector: { type: "custom", pattern: found.pattern } },
    };
  }

  /**
   * Bitbucket's sign-in page, which comes straight back with a token in the
   * address's fragment, or with a code in its query for `response_type=code`.
   */
  function authorize(url: URL): Response {
    if (!options.oauth || url.searchParams.get("client_id") !== options.oauth.clientId) {
      return error(400, "Invalid client_id");
    }
    if (url.searchParams.get("response_type") === "code") {
      const code = `code-${oauthCodes.size + 1}`;
      oauthCodes.add(code);
      const query = new URLSearchParams({ code, state: url.searchParams.get("state") ?? "" });
      return new Response(null, { status: 302, headers: { location: `${options.oauth.callback}?${query}` } });
    }
    const token = `oauth-${oauthTokens.size + 1}`;
    oauthTokens.set(token, options.oauth.user);
    const state = url.searchParams.get("state") ?? "";
    const fragment = new URLSearchParams({ access_token: token, token_type: "bearer", expires_in: "7200", state });
    return new Response(null, { status: 302, headers: { location: `${options.oauth.callback}#${fragment}` } });
  }

  /** The code grant's token endpoint, which only a consumer with a secret can use. */
  async function accessToken(request: Request): Promise<Response> {
    const oauth = options.oauth;
    const header = request.headers.get("authorization") ?? "";
    if (!oauth?.secret || header !== `Basic ${btoa(`${oauth.clientId}:${oauth.secret}`)}`) {
      return Response.json({ error: "invalid_client", error_description: "Bad client credentials" }, { status: 401 });
    }
    const body = new URLSearchParams(await request.text());
    const grant = body.get("grant_type");
    const given = grant === "authorization_code" ? body.get("code") : body.get("refresh_token");
    const known = grant === "authorization_code" ? oauthCodes : grant === "refresh_token" ? refreshTokens : undefined;
    if (!known || !given || !known.delete(given)) {
      return Response.json({ error: "invalid_grant", error_description: "Invalid grant" }, { status: 400 });
    }
    const access = `oauth-${oauthTokens.size + 1}`;
    oauthTokens.set(access, oauth.user);
    const refresh = `refresh-${oauthTokens.size}`;
    refreshTokens.add(refresh);
    return Response.json({
      access_token: access,
      refresh_token: refresh,
      token_type: "bearer",
      expires_in: 7200,
      scopes: "account repository:write pullrequest:write",
    });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin === web && url.pathname === "/site/oauth2/authorize") return authorize(url);
    if (url.origin === web && url.pathname === "/site/oauth2/access_token" && request.method === "POST") {
      return accessToken(request);
    }
    if (!request.url.startsWith(api)) return error(404, "Not the API");
    const path = url.pathname.slice("/2.0".length);
    requests.push({ method: request.method, path: `${path}${url.search}` });
    const user = who(request);
    if (!user) return error(401, "Invalid credentials");

    if (path === "/user") {
      if (user.access) return error(401, "Access tokens are invalid or not supported for this endpoint.");
      return json(account(user));
    }
    if (path === "/user/workspaces") {
      if (user.access) return error(401, "Not supported for access tokens.");
      return page(
        url,
        [user.nickname, ...(options.workspaces ?? [])].map((slug) => ({
          workspace: { slug, name: slug },
          permission: "owner",
        })),
      );
    }
    const permissionsMatch = path.match(/^\/user\/workspaces\/([^/]+)\/permissions\/repositories$/);
    if (permissionsMatch) {
      if (user.access) return error(401, "Not supported for access tokens.");
      return page(url, [{ permission: permissionOf(user), repository: { full_name: options.repo } }]);
    }
    const membersMatch = path.match(/^\/workspaces\/([^/]+)\/members$/);
    if (membersMatch) {
      if (membersMatch[1] !== workspace) return error(404, "No such workspace");
      const email = filterValue(url.searchParams.get("q"), "user.email");
      const found = [...members.values()].filter(
        (member) => !email || `${member.nickname}@example.org` === email.value,
      );
      return page(
        url,
        found.map((member) => ({ user: account(member) })),
      );
    }
    const repoMatch = path.match(/^\/repositories\/([^/]+\/[^/]+)(\/.*)?$/);
    if (repoMatch?.[1]) return repository(request, url, repoMatch[1], repoMatch[2] ?? "", user);
    return error(404, `The fake doesn't answer ${request.method} ${path}`);
  }

  return {
    repo,
    /** Who commits that named their author did name, by commit. */
    commitAuthors,
    /** Explicit permissions on the repository by account uuid, and the workspace's people, which tests can change. */
    permissions,
    members,
    /** Adds another repository in the workspace, such as a site's code repository, which the same sign-ins can read. */
    addRepo(name: string, files: Record<string, string> = {}): FakeRepo {
      const added = new FakeRepo(files);
      created.set(name, { repo: added, private: true, mainBranch: added.defaultBranch });
      return added;
    },
    /** Pipelines started, schedules and repository variables, which tests can read and change. */
    pipelines,
    schedules,
    variables,
    /** Whether Pipelines is on, and whether the repository is private. */
    settings,
    /** Repositories created through the API, by `workspace/repository`. */
    created,
    requests,
    addUpdateRun,
    /** Has Vercel's build of a commit fail. */
    failBuild(sha: string) {
      failed.add(sha);
    },
    /** Simulates someone else publishing: commits straight to the branch. */
    commit(path: string, content: string, message?: string) {
      return repo.write(path, content, message);
    },
    handle,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init))) as typeof fetch,
  };
}

export type FakeBitbucket = ReturnType<typeof fakeBitbucket>;
