/**
 * A fake of the parts of GitLab's API that `@goodfellow-cms/gitlab` uses, backed by
 * an in-memory repository, including OAuth with PKCE. For tests only.
 */
import { decodeBase64, type FileChange } from "@goodfellow-cms/core";
import { FakeRepo, fakeFileBytes } from "@goodfellow-cms/core/testing";

export interface FakeGitLabUser {
  username: string;
  name?: string;
  /** GitLab access level: 30 is Developer, 40 Maintainer. Defaults to 40. */
  accessLevel?: number;
}

export interface FakeGitLabOptions {
  project: string;
  url?: string;
  files?: Record<string, string>;
  /** Personal access tokens and their users. */
  tokens?: Record<string, FakeGitLabUser>;
  /** The OAuth application's ID, and the user who signs in through it. */
  oauth?: { clientId: string; user: FakeGitLabUser; expiresIn?: number };
  /** Simulates a GitLab Pages pipeline that succeeds after being checked this many times. Off by default. */
  deployAfterChecks?: number;
  /** The job each published commit's pipeline runs: `pages` by default. */
  deployJob?: string;
  /**
   * Has `deployJob` report as a host outside GitLab does, such as Cloudflare
   * Pages: a commit status with no pipeline the project lists.
   */
  external?: boolean;
  /** The job the update runs in, which `addUpdateRun()` logs: `pages` by default, as in the starters, or a code project's `update`. */
  updateJob?: string;
  /** Groups the users belong to, which new projects can be created in. */
  groups?: string[];
  /** Publishes the site with GitLab Pages. Off by default. */
  pages?: { uniqueDomain?: boolean };
  /** Domains another GitLab Pages site already uses. */
  takenDomains?: string[];
  /** Other GitLab accounts that exist, which can be added to the project. Every token's user exists and is a member. */
  accounts?: string[];
  /** Who can see the project. Private by default. */
  visibility?: "public" | "internal" | "private";
}

/** A pipeline schedule, such as the nightly one or one the admin panel adds for a scheduled change. */
export interface FakeSchedule {
  id: number;
  ref: string;
  cron: string;
  cronTimezone?: string;
  description?: string;
  active: boolean;
  /** Who added it, who alone (with Maintainers) can change it. */
  owner?: string;
  variables?: Record<string, string>;
}

/** A member of the site's project. */
export interface FakeMember {
  id: number;
  username: string;
  name?: string;
  accessLevel: number;
  /** A member through a group rather than the project itself. */
  inherited?: boolean;
}

/** A custom domain added to the site's GitLab Pages. */
export interface FakePagesDomain {
  verified: boolean;
  verificationCode: string;
  /** Whether Let's Encrypt has issued the certificate. */
  certificate: boolean;
}

/** The site's GitLab Pages settings, which tests can change. */
export interface FakeGitLabPages {
  uniqueDomain: boolean;
  forceHttps: boolean;
  primaryDomain: string | null;
  domains: Map<string, FakePagesDomain>;
  /** Domains whose TXT record GitLab would find, so verifying them works. */
  dnsReady: Set<string>;
}

/** A project created through the fake's API, as the setup page creates them. */
export interface FakeCreatedProject {
  id: number;
  path: string;
  visibility: string;
  description?: string;
  pagesAccessLevel?: string;
  repo: FakeRepo;
  /** The projects whose job tokens may reach this one (its job token allowlist), by id. */
  jobTokenAllowlist: number[];
  /** Whether its pipelines' job tokens may push to it. */
  jobTokenPush: boolean;
  schedules: Array<{ description: string; ref: string; cron: string; active: boolean }>;
  /** Domains of its own its Pages were given. */
  pagesDomains: string[];
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function sha256Base64Url(text: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  let binary = "";
  for (const byte of digest) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fakeGitLab(options: FakeGitLabOptions) {
  const webUrl = options.url ?? "https://gitlab.com";
  const repo = new FakeRepo(options.files);
  /** Who each commit that named its author did name, by commit. */
  const commitAuthors = new Map<string, { name: string; email: string }>();
  const tokens = new Map<string, FakeGitLabUser>(
    Object.entries(options.tokens ?? { "test-token": { username: "editor", name: "Test Editor" } }),
  );
  let nextUserId = 1;
  /** Every GitLab account, by username, with its id. */
  const accounts = new Map<string, number>();
  for (const name of [
    ...[...tokens.values(), ...(options.oauth ? [options.oauth.user] : [])].map((user) => user.username),
    ...(options.accounts ?? []),
  ]) {
    if (!accounts.has(name)) accounts.set(name, nextUserId++);
  }
  const members = new Map<number, FakeMember>();
  for (const user of [...tokens.values(), ...(options.oauth ? [options.oauth.user] : [])]) {
    const id = accounts.get(user.username) ?? 0;
    members.set(id, { id, username: user.username, name: user.name, accessLevel: user.accessLevel ?? 40 });
  }
  const invitations = new Map<string, number>();
  /** Protected branches and who may push to them: GitLab protects the default branch for Maintainers. */
  const protectedBranches = new Map<string, { push: number; merge: number; forcePush: boolean }>([
    [repo.defaultBranch, { push: 40, merge: 40, forcePush: false }],
  ]);

  /** The project's members and invitations, and its protected branches. */
  async function handleMembers(request: Request, url: URL, rest: string, accessLevel: number) {
    const forbidden = () => json({ message: "403 Forbidden" }, 403);
    const list = (items: unknown[]) => {
      const perPage = Number(url.searchParams.get("per_page") ?? 20);
      const page = Number(url.searchParams.get("page") ?? 1);
      return json(items.slice((page - 1) * perPage, page * perPage));
    };
    const shown = (member: FakeMember) => ({
      id: member.id,
      username: member.username,
      name: member.name ?? member.username,
      avatar_url: `https://avatars.example/${member.username}`,
      access_level: member.accessLevel,
    });
    if (rest === "/members/all" && request.method === "GET") return list([...members.values()].map(shown));
    if (rest === "/members" && request.method === "GET") {
      return list([...members.values()].filter((member) => !member.inherited).map(shown));
    }
    if (rest === "/members" && request.method === "POST") {
      if (accessLevel < 40) return forbidden();
      const body = (await request.json()) as { user_id: number; access_level: number };
      const username = [...accounts].find(([, id]) => id === body.user_id)?.[0];
      if (!username) return json({ message: "404 User Not Found" }, 404);
      if (members.has(body.user_id)) return json({ message: "Member already exists" }, 409);
      members.set(body.user_id, { id: body.user_id, username, accessLevel: body.access_level });
      return json(shown(members.get(body.user_id) as FakeMember), 201);
    }
    const member = rest.match(/^\/members\/(\d+)$/);
    if (member) {
      if (accessLevel < 40) return forbidden();
      const found = members.get(Number(member[1]));
      if (!found || found.inherited) return json({ message: "404 Member Not Found" }, 404);
      if (request.method === "DELETE") {
        members.delete(found.id);
        return new Response(null, { status: 204 });
      }
      if (request.method === "PUT") {
        found.accessLevel = ((await request.json()) as { access_level: number }).access_level;
        return json(shown(found));
      }
    }
    if (rest === "/invitations") {
      if (accessLevel < 40) return forbidden();
      if (request.method === "GET") {
        return list([...invitations].map(([email, level]) => ({ invite_email: email, access_level: level })));
      }
      if (request.method === "POST") {
        const body = (await request.json()) as { email: string; access_level: number };
        if (invitations.has(body.email)) {
          return json({ status: "error", message: { [body.email]: "Invite email has already been taken" } }, 201);
        }
        invitations.set(body.email, body.access_level);
        return json({ status: "success" }, 201);
      }
    }
    const invitation = rest.match(/^\/invitations\/([^/]+)$/);
    if (invitation) {
      if (accessLevel < 40) return forbidden();
      const email = decodeURIComponent(invitation[1] ?? "");
      if (!invitations.has(email)) return json({ message: "404 Not Found" }, 404);
      if (request.method === "DELETE") {
        invitations.delete(email);
        return new Response(null, { status: 204 });
      }
      if (request.method === "PUT") {
        invitations.set(email, ((await request.json()) as { access_level: number }).access_level);
        return json({ invite_email: email });
      }
    }
    const protection = rest.match(/^\/protected_branches\/([^/]+)$/);
    if (protection) {
      const name = decodeURIComponent(protection[1] ?? "");
      const found = protectedBranches.get(name);
      if (!found) return json({ message: "404 Not found" }, 404);
      if (request.method === "GET") {
        return json({
          name,
          push_access_levels: [{ access_level: found.push }],
          merge_access_levels: [{ access_level: found.merge }],
          allow_force_push: found.forcePush,
        });
      }
      if (request.method === "DELETE") {
        if (accessLevel < 40) return forbidden();
        protectedBranches.delete(name);
        return new Response(null, { status: 204 });
      }
    }
    if (rest === "/protected_branches" && request.method === "POST") {
      if (accessLevel < 40) return forbidden();
      const body = (await request.json()) as {
        name: string;
        push_access_level?: number;
        merge_access_level?: number;
        allow_force_push?: boolean;
      };
      if (protectedBranches.has(body.name)) return json({ message: "Protected branch already exists" }, 409);
      protectedBranches.set(body.name, {
        push: body.push_access_level ?? 40,
        merge: body.merge_access_level ?? 40,
        forcePush: body.allow_force_push ?? false,
      });
      return json({ name: body.name }, 201);
    }
    return undefined;
  }
  const codes = new Map<string, { challenge: string; redirectUri: string }>();
  const refreshTokens = new Map<string, FakeGitLabUser>();
  const pipelines = new Map<string, { checks: number }>();
  /** The project's settings for updates: whether job tokens may push, and its pipeline schedules. */
  const updateSettings = {
    jobTokenPush: false,
    schedules: [] as FakeSchedule[],
  };
  let scheduleIds = 0;
  /** Pipelines the update ran in: scheduled, or started through the API, with the pages job's log. */
  const updateRuns: Array<{
    id: number;
    source: string;
    status: string;
    variables?: Array<{ key: string; value: string }>;
    trace: string;
  }> = [];
  /** Simulates a scheduled (or API) pipeline whose pages job logged `trace`. */
  function addUpdateRun(run: {
    source?: string;
    status?: string;
    trace?: string;
    variables?: Array<{ key: string; value: string }>;
  }) {
    const added = { id: 1000 + updateRuns.length, source: "schedule", status: "success", trace: "", ...run };
    updateRuns.push(added);
    return added;
  }

  /** Failed jobs, by commit, which tests add with `failBuild()` and `cancelBuild()`. */
  const failures = new Map<
    string,
    { job: string; status: "failed" | "canceled"; failureReason: string; trace: string }
  >();

  /**
   * Simulates the pipeline for a commit failing: its `pages` job (or another,
   * such as `pages:deploy`) fails for a GitLab failure reason, with a log.
   */
  function failBuild(sha: string, failure: { job?: string; failureReason?: string; trace?: string } = {}): void {
    if (!pipelines.has(sha)) pipelines.set(sha, { checks: 0 });
    failures.set(sha, {
      job: failure.job ?? "pages",
      status: "failed",
      failureReason: failure.failureReason ?? "script_failure",
      trace: failure.trace ?? "",
    });
  }

  /** Simulates a commit's `pages` job being cancelled, as a newer pipeline on the branch cancels an interruptible one. */
  function cancelBuild(sha: string): void {
    if (!pipelines.has(sha)) pipelines.set(sha, { checks: 0 });
    failures.set(sha, { job: "pages", status: "canceled", failureReason: "", trace: "" });
  }

  const pipelineId = (sha: string) => [...pipelines.keys()].indexOf(sha) + 1;
  const requests: Request[] = [];
  let counter = 0;
  let graphqlReads = 0;
  const created = new Map<string, FakeCreatedProject>();
  const pages: FakeGitLabPages | undefined = options.pages
    ? {
        uniqueDomain: options.pages.uniqueDomain ?? true,
        forceHttps: true,
        primaryDomain: null,
        domains: new Map(),
        dnsReady: new Set(),
      }
    : undefined;

  function pagesUrl(): string {
    const [namespace = "", ...rest] = options.project.split("/");
    return pages?.uniqueDomain
      ? `https://${rest.join("-")}-1a2b3c.gitlab.io`
      : `https://${namespace}.gitlab.io/${rest.join("/")}`;
  }

  /** GitLab Pages' settings and custom domains, for the site's own project. */
  async function handlePages(request: Request, rest: string, accessLevel: number): Promise<Response | undefined> {
    if (!rest.startsWith("/pages")) return undefined;
    if (!pages) return json({ message: "404 Not Found" }, 404);
    if (accessLevel < 40) return json({ message: "403 Forbidden" }, 403);
    const method = request.method;
    const domainJson = (name: string, domain: FakePagesDomain) => ({
      domain: name,
      url: `https://${name}`,
      verified: domain.verified,
      verification_code: domain.verificationCode,
      auto_ssl_enabled: true,
      certificate: domain.certificate ? { subject: `/CN=${name}`, expired: false } : null,
    });
    if (rest === "/pages" && method === "GET") {
      return json({
        url: pagesUrl(),
        is_unique_domain_enabled: pages.uniqueDomain,
        force_https: pages.forceHttps,
        primary_domain: pages.primaryDomain,
      });
    }
    if (rest === "/pages" && method === "PATCH") {
      const body = (await request.json()) as {
        pages_unique_domain_enabled?: boolean;
        pages_https_only?: boolean;
        pages_primary_domain?: string;
      };
      if (body.pages_primary_domain !== undefined && !pages.domains.has(body.pages_primary_domain)) {
        return json({ message: "Primary domain must be one of the project's domains" }, 400);
      }
      if (body.pages_unique_domain_enabled !== undefined) pages.uniqueDomain = body.pages_unique_domain_enabled;
      if (body.pages_https_only !== undefined) pages.forceHttps = body.pages_https_only;
      if (body.pages_primary_domain !== undefined) pages.primaryDomain = body.pages_primary_domain;
      return json({ url: pagesUrl(), is_unique_domain_enabled: pages.uniqueDomain, force_https: pages.forceHttps });
    }
    if (rest === "/pages/domains" && method === "GET") {
      return json([...pages.domains].map(([name, domain]) => domainJson(name, domain)));
    }
    if (rest === "/pages/domains" && method === "POST") {
      const body = (await request.json()) as { domain: string };
      if (pages.domains.has(body.domain)) return json({ message: { domain: ["has already been taken"] } }, 400);
      if (!/^[a-z0-9.-]+\.[a-z]+$/.test(body.domain)) return json({ message: { domain: ["is invalid"] } }, 400);
      counter += 1;
      const domain = { verified: false, verificationCode: `code-${counter}`, certificate: false };
      pages.domains.set(body.domain, domain);
      return json(domainJson(body.domain, domain), 201);
    }
    const one = rest.match(/^\/pages\/domains\/([^/]+)(\/verify)?$/);
    const name = decodeURIComponent(one?.[1] ?? "");
    const domain = pages.domains.get(name);
    if (!one || !domain) return json({ message: "404 Not Found" }, 404);
    if (one[2] && method === "PUT") {
      if (!pages.dnsReady.has(name)) return json({ message: "Failed to verify domain ownership" }, 400);
      domain.verified = true;
      return json(domainJson(name, domain));
    }
    if (method === "GET") return json(domainJson(name, domain));
    if (method === "DELETE") {
      pages.domains.delete(name);
      if (pages.primaryDomain === name) pages.primaryDomain = null;
      return new Response(null, { status: 204 });
    }
    return json({ message: "404 Not Found" }, 404);
  }
  const groups = (options.groups ?? []).map((group, index) => ({ id: 100 + index, path: group }));

  /** Creating projects, and committing to the projects created, as the setup page does. */
  async function handleCreated(request: Request, path: string, user: FakeGitLabUser): Promise<Response | undefined> {
    if (path === "/namespaces") {
      return json([
        { id: 1, kind: "user", full_path: user.username, name: user.name ?? user.username },
        ...groups.map((group) => ({ id: group.id, kind: "group", full_path: group.path, name: group.path })),
      ]);
    }
    if (path === "/projects" && request.method === "POST") {
      const body = (await request.json()) as {
        name: string;
        path: string;
        namespace_id?: number;
        visibility: string;
        description?: string;
        pages_access_level?: string;
      };
      const namespace =
        body.namespace_id === undefined || body.namespace_id === 1
          ? user.username
          : groups.find((group) => group.id === body.namespace_id)?.path;
      if (!namespace) return json({ message: "404 Namespace Not Found" }, 404);
      if (!/^[\w.-]+$/.test(body.path)) return json({ message: { path: ["is invalid"] } }, 400);
      const fullPath = `${namespace}/${body.path}`;
      if (created.has(fullPath) || fullPath === options.project) {
        return json({ message: { name: ["has already been taken"] } }, 400);
      }
      counter += 1;
      const project: FakeCreatedProject = {
        id: 1000 + counter,
        path: fullPath,
        visibility: body.visibility,
        description: body.description,
        pagesAccessLevel: body.pages_access_level,
        repo: new FakeRepo({}),
        jobTokenAllowlist: [],
        jobTokenPush: false,
        schedules: [],
        pagesDomains: [],
      };
      created.set(fullPath, project);
      return json({ id: project.id, path_with_namespace: fullPath, web_url: `${webUrl}/${fullPath}` }, 201);
    }
    const match = path.match(/^\/projects\/([^/]+)(\/.*)?$/);
    const key = decodeURIComponent(match?.[1] ?? "");
    const project = created.get(key) ?? [...created.values()].find((candidate) => String(candidate.id) === key);
    if (!match || !project) return undefined;
    const rest = match[2] ?? "";
    if (rest === "" && request.method === "GET") {
      return json({
        id: project.id,
        path_with_namespace: project.path,
        default_branch: "main",
        ci_push_repository_for_job_token_allowed: project.jobTokenPush,
      });
    }
    if (rest === "" && request.method === "PUT") {
      const body = (await request.json()) as { ci_push_repository_for_job_token_allowed?: boolean };
      if (body.ci_push_repository_for_job_token_allowed !== undefined) {
        project.jobTokenPush = body.ci_push_repository_for_job_token_allowed;
      }
      return json({ id: project.id, ci_push_repository_for_job_token_allowed: project.jobTokenPush });
    }
    if (rest === "/job_token_scope/allowlist" && request.method === "POST") {
      const body = (await request.json()) as { target_project_id: number };
      if (![...created.values()].some((candidate) => candidate.id === body.target_project_id)) {
        return json({ message: "404 Project Not Found" }, 404);
      }
      if (!project.jobTokenAllowlist.includes(body.target_project_id)) {
        project.jobTokenAllowlist.push(body.target_project_id);
      }
      return json({ source_project_id: project.id, target_project_id: body.target_project_id }, 201);
    }
    if (rest === "/pages/domains" && request.method === "POST") {
      const body = (await request.json()) as { domain: string };
      if (options.takenDomains?.includes(body.domain))
        return json({ message: { domain: ["has already been taken"] } }, 400);
      project.pagesDomains.push(body.domain);
      return json({ domain: body.domain, url: `https://${body.domain}` }, 201);
    }
    if (rest === "/pipeline_schedules" && request.method === "POST") {
      const body = (await request.json()) as { description: string; ref: string; cron: string; active?: boolean };
      project.schedules.push({ ...body, active: body.active !== false });
      return json({ id: project.schedules.length, ...body }, 201);
    }
    if (rest === "/repository/commits" && request.method === "POST") {
      const body = (await request.json()) as {
        branch: string;
        commit_message: string;
        actions: { action: string; file_path: string; content?: string; encoding?: string }[];
      };
      const sha = project.repo.commit(
        body.actions.map((action) =>
          action.encoding === "base64"
            ? { path: action.file_path, bytes: decodeBase64(action.content ?? "") }
            : { path: action.file_path, content: action.content ?? "" },
        ),
        body.commit_message,
        { branch: body.branch },
      );
      return json({ id: sha, message: body.commit_message }, 201);
    }
    return json({ message: "404 Not Found" }, 404);
  }

  function commit(changes: FileChange[], message: string, author?: string, branch = repo.defaultBranch): string {
    const sha = repo.commit(changes, message, { author, branch });
    // Only the default branch runs the pages job, as the starters' pipeline does.
    if (options.deployAfterChecks !== undefined && branch === repo.defaultBranch) pipelines.set(sha, { checks: 0 });
    return sha;
  }

  function issueTokens(user: FakeGitLabUser) {
    counter += 1;
    const access = `oauth-access-${counter}`;
    const refresh = `oauth-refresh-${counter}`;
    tokens.set(access, user);
    refreshTokens.set(refresh, user);
    return {
      access_token: access,
      refresh_token: refresh,
      expires_in: options.oauth?.expiresIn ?? 7200,
      token_type: "Bearer",
    };
  }

  /**
   * What GitLab's sign-in page does once the person approves: returns the
   * address the browser is sent back to, with a one-time code.
   */
  function authorize(authorizeUrl: string): string {
    const url = new URL(authorizeUrl);
    const params = url.searchParams;
    if (params.get("client_id") !== options.oauth?.clientId) throw new Error("Unknown OAuth application");
    if (params.get("code_challenge_method") !== "S256") throw new Error("PKCE with S256 is required");
    counter += 1;
    const code = `code-${counter}`;
    codes.set(code, { challenge: params.get("code_challenge") ?? "", redirectUri: params.get("redirect_uri") ?? "" });
    const back = new URL(params.get("redirect_uri") ?? "");
    back.searchParams.set("code", code);
    back.searchParams.set("state", params.get("state") ?? "");
    return back.toString();
  }

  async function handle(request: Request): Promise<Response> {
    requests.push(request.clone());
    const url = new URL(request.url);

    if (url.pathname === "/oauth/token" && request.method === "POST") {
      const body = new URLSearchParams(await request.text());
      if (body.get("client_id") !== options.oauth?.clientId || !options.oauth)
        return json({ error: "invalid_client" }, 401);
      if (body.get("grant_type") === "authorization_code") {
        const issued = codes.get(body.get("code") ?? "");
        codes.delete(body.get("code") ?? "");
        if (!issued || issued.redirectUri !== body.get("redirect_uri")) return json({ error: "invalid_grant" }, 400);
        if ((await sha256Base64Url(body.get("code_verifier") ?? "")) !== issued.challenge) {
          return json({ error: "invalid_grant", error_description: "PKCE verification failed" }, 400);
        }
        return json(issueTokens(options.oauth.user));
      }
      if (body.get("grant_type") === "refresh_token") {
        const user = refreshTokens.get(body.get("refresh_token") ?? "");
        refreshTokens.delete(body.get("refresh_token") ?? "");
        return user ? json(issueTokens(user)) : json({ error: "invalid_grant" }, 400);
      }
      return json({ error: "unsupported_grant_type" }, 400);
    }

    if (url.pathname === "/api/graphql" && request.method === "POST") {
      if (!tokens.has(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "")) {
        return json({ message: "401 Unauthorized" }, 401);
      }
      const { variables } = (await request.json()) as {
        variables: { project: string; ref: string; paths: string[] };
      };
      if (variables.project !== options.project) return json({ data: { project: null } });
      graphqlReads += 1;
      const files = repo.files(variables.ref);
      const nodes = variables.paths.flatMap((path) => {
        const content = files.get(path);
        if (content === undefined) return [];
        // GitLab gives sizes as BigInt, which arrive as strings.
        return [
          {
            path,
            rawTextBlob: typeof content === "string" ? content : null,
            size: String(fakeFileBytes(content).length),
          },
        ];
      });
      return json({ data: { project: { repository: { blobs: { nodes } } } } });
    }
    if (!url.pathname.startsWith("/api/v4/")) return json({ message: "404 Not Found" }, 404);
    const user = tokens.get(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    if (!user) return json({ message: "401 Unauthorized" }, 401);
    // Keep the encoded project path intact: split on raw slashes only.
    const path = url.pathname.slice("/api/v4".length);

    if (path === "/user")
      return json({ username: user.username, name: user.name, avatar_url: `https://avatars.example/${user.username}` });

    const setup = await handleCreated(request, path, user);
    if (setup) return setup;

    // The projects the user is a member of, as the Claude connector lists them.
    if (path === "/projects" && request.method === "GET") {
      const level = members.get(accounts.get(user.username) ?? 0)?.accessLevel ?? 0;
      const min = Number(url.searchParams.get("min_access_level") ?? "0");
      return json(
        level > 0 && level >= min ? [{ path_with_namespace: options.project, default_branch: repo.defaultBranch }] : [],
      );
    }

    if (path === "/users") {
      const name = url.searchParams.get("username") ?? "";
      const id = [...accounts].find(([username]) => username.toLowerCase() === name.toLowerCase())?.[1];
      return json(id === undefined ? [] : [{ id, username: name }]);
    }

    const projectMatch = path.match(/^\/projects\/([^/]+)(\/.*)?$/);
    if (!projectMatch || decodeURIComponent(projectMatch[1] ?? "") !== options.project)
      return json({ message: "404 Project Not Found" }, 404);
    const rest = projectMatch[2] ?? "";
    const accessLevel = members.get(accounts.get(user.username) ?? 0)?.accessLevel ?? 0;
    const pagesResponse = await handlePages(request, rest, accessLevel);
    if (pagesResponse) return pagesResponse;
    const membersResponse = await handleMembers(request, url, rest, accessLevel);
    if (membersResponse) return membersResponse;

    if (rest === "" && request.method !== "PUT") {
      return json({
        default_branch: repo.defaultBranch,
        visibility: options.visibility ?? "private",
        permissions: { project_access: { access_level: accessLevel }, group_access: null },
        ci_push_repository_for_job_token_allowed: updateSettings.jobTokenPush,
      });
    }

    if (rest === "/repository/branches" && request.method === "POST") {
      if (accessLevel < 30) return json({ message: "403 Forbidden" }, 403);
      const name = url.searchParams.get("branch") ?? "";
      const ref = url.searchParams.get("ref") ?? "";
      if (repo.branches.has(name)) return json({ message: "Branch already exists" }, 400);
      const sha = repo.branches.get(ref) ?? (repo.commitAt(ref) ? ref : undefined);
      if (!sha) return json({ message: "Invalid reference name" }, 400);
      repo.branches.set(name, sha);
      return json({ name, commit: { id: sha } }, 201);
    }
    const branch = rest.match(/^\/repository\/branches\/(.+)$/);
    if (branch && request.method === "DELETE") {
      if (accessLevel < 30) return json({ message: "403 Forbidden" }, 403);
      const name = decodeURIComponent(branch[1] ?? "");
      if (!repo.branches.has(name)) return json({ message: "404 Branch Not Found" }, 404);
      repo.branches.delete(name);
      return new Response(null, { status: 204 });
    }
    if (branch) {
      const sha = repo.branches.get(decodeURIComponent(branch[1] ?? ""));
      return sha ? json({ commit: { id: sha } }) : json({ message: "404 Branch Not Found" }, 404);
    }

    if (rest === "/repository/merge_base") {
      const refs = url.searchParams.getAll("refs[]").map((ref) => repo.branches.get(ref) ?? ref);
      if (refs.length !== 2 || refs.some((ref) => !repo.commitAt(ref))) {
        return json({ message: "Could not find ref" }, 400);
      }
      const base = repo.mergeBase(refs[0] ?? "", refs[1] ?? "");
      return base ? json({ id: base }) : json({ message: "404 Not Found" }, 404);
    }

    if (rest === "/merge_requests" && request.method === "POST") {
      if (accessLevel < 30) return json({ message: "403 Forbidden" }, 403);
      const body = (await request.json()) as {
        source_branch: string;
        target_branch: string;
        title: string;
        description?: string;
      };
      if (!repo.branches.has(body.source_branch) || !repo.branches.has(body.target_branch)) {
        return json({ message: ["Source branch does not exist"] }, 422);
      }
      if (repo.reviews.some((review) => review.branch === body.source_branch && review.state === "open")) {
        return json({ message: ["Another open merge request already exists for this source branch"] }, 409);
      }
      const review = repo.openReview(body.source_branch, body.title, body.description ?? "", body.target_branch);
      return json(
        { iid: review.number, web_url: `${webUrl}/${options.project}/-/merge_requests/${review.number}` },
        201,
      );
    }
    if (rest === "/merge_requests" && request.method === "GET") {
      const source = url.searchParams.get("source_branch");
      const found = repo.reviews.filter((review) => review.state === "open" && (!source || review.branch === source));
      return json(
        found.map((review) => ({
          iid: review.number,
          web_url: `${webUrl}/${options.project}/-/merge_requests/${review.number}`,
        })),
      );
    }

    if (rest === "/repository/tree") {
      const ref = url.searchParams.get("ref") ?? repo.defaultBranch;
      const dir = url.searchParams.get("path") ?? "";
      const perPage = Number(url.searchParams.get("per_page") ?? 20);
      const page = Number(url.searchParams.get("page") ?? 1);
      const entries = [...repo.files(ref)]
        .filter(([file]) => file.startsWith(`${dir}/`))
        .map(([file, content]) => ({
          id: repo.blobSha(content),
          type: "blob",
          path: file,
          name: file.split("/").at(-1),
        }));
      if (entries.length === 0) return json({ message: "404 Tree Not Found" }, 404);
      return json(entries.slice((page - 1) * perPage, page * perPage));
    }

    const blob = rest.match(/^\/repository\/blobs\/([0-9a-f]{40})\/raw$/);
    if (blob) {
      const content = repo.blobs.get(blob[1] ?? "");
      return content === undefined
        ? json({ message: "404 Blob Not Found" }, 404)
        : new Response(fakeFileBytes(content));
    }

    const raw = rest.match(/^\/repository\/files\/([^/]+)\/raw$/);
    if (raw) {
      const ref = url.searchParams.get("ref") ?? repo.defaultBranch;
      if (!repo.commitAt(repo.branches.get(ref) ?? ref)) return json({ message: "404 Commit Not Found" }, 404);
      const content = repo.files(ref).get(decodeURIComponent(raw[1] ?? ""));
      return content === undefined
        ? json({ message: "404 File Not Found" }, 404)
        : new Response(fakeFileBytes(content));
    }

    const file = rest.match(/^\/repository\/files\/([^/]+)$/);
    if (file) {
      const filePath = decodeURIComponent(file[1] ?? "");
      const ref = url.searchParams.get("ref") ?? repo.defaultBranch;
      const lastCommit = repo.files(ref).has(filePath) ? repo.lastCommitFor(filePath, ref) : undefined;
      return lastCommit
        ? json({ file_path: filePath, last_commit_id: lastCommit })
        : json({ message: "404 File Not Found" }, 404);
    }

    if (rest === "/repository/commits" && request.method === "POST") {
      if (accessLevel < 30) return json({ message: "403 Forbidden" }, 403);
      const pushTo = (await request.clone().json()) as { branch: string };
      if (accessLevel < (protectedBranches.get(pushTo.branch)?.push ?? 0)) {
        return json({ message: "You are not allowed to push into this branch" }, 403);
      }
      const body = (await request.json()) as {
        branch: string;
        commit_message: string;
        author_name?: string;
        author_email?: string;
        actions: Array<{
          action: string;
          file_path: string;
          content?: string;
          encoding?: string;
          last_commit_id?: string;
        }>;
      };
      const files = repo.files(body.branch);
      for (const action of body.actions) {
        if (action.action === "create" && files.has(action.file_path)) {
          return json({ message: "A file with this name already exists" }, 400);
        }
        if ((action.action === "update" || action.action === "delete") && !files.has(action.file_path)) {
          return json({ message: "A file with this name doesn't exist" }, 400);
        }
        if (action.last_commit_id && repo.lastCommitFor(action.file_path, body.branch) !== action.last_commit_id) {
          return json(
            { message: "You are attempting to update a file that has changed since you started editing it." },
            400,
          );
        }
      }
      const sha = commit(
        body.actions.map((action) =>
          action.action === "delete"
            ? { path: action.file_path, delete: true as const }
            : action.encoding === "base64"
              ? { path: action.file_path, bytes: decodeBase64(action.content ?? "") }
              : { path: action.file_path, content: action.content ?? "" },
        ),
        body.commit_message,
        // A commit can name another author, as a full-stack site's server names its editors.
        body.author_name ?? user.name ?? user.username,
        body.branch,
      );
      if (body.author_name && body.author_email) {
        commitAuthors.set(sha, { name: body.author_name, email: body.author_email });
      }
      return json({ id: sha, message: body.commit_message }, 201);
    }

    if (rest === "/repository/commits" && request.method === "GET") {
      const ref = url.searchParams.get("ref_name") ?? repo.defaultBranch;
      const file = url.searchParams.get("path");
      if (!repo.commitAt(repo.branches.get(ref) ?? ref)) return json({ message: "404 Reference Not Found" }, 404);
      const perPage = Number(url.searchParams.get("per_page") ?? 20);
      const page = Number(url.searchParams.get("page") ?? 1);
      const commits = file ? repo.history(file, ref) : [];
      return json(
        commits.slice((page - 1) * perPage, page * perPage).map((commit) => ({
          id: commit.sha,
          title: commit.message.split("\n")[0],
          message: commit.message,
          author_name: commit.author ?? "GitLab",
          authored_date: commit.date,
          committed_date: commit.date,
        })),
      );
    }

    const commitSha = rest.match(/^\/repository\/commits\/([0-9a-f]{40})$/)?.[1];
    if (commitSha) {
      const found = repo.commitAt(commitSha);
      if (!found) return json({ message: "404 Commit Not Found" }, 404);
      return json({ id: commitSha, parent_ids: found.parent ? [found.parent] : [] });
    }

    if (rest === "/repository/compare") {
      const changed = repo.changedPaths(url.searchParams.get("from") ?? "", url.searchParams.get("to") ?? "");
      return json({ diffs: changed.map((changedPath) => ({ old_path: changedPath, new_path: changedPath })) });
    }

    const statuses = rest.match(/^\/repository\/commits\/([0-9a-f]{40})\/statuses$/);
    if (statuses) {
      const pipeline = pipelines.get(statuses[1] ?? "");
      if (!pipeline) return json([]);
      const failure = failures.get(statuses[1] ?? "");
      if (failure) {
        const id = pipelineId(statuses[1] ?? "");
        return json([
          { name: failure.job, status: failure.status, target_url: `${webUrl}/${options.project}/-/jobs/${id}` },
        ]);
      }
      pipeline.checks += 1;
      const done = pipeline.checks > (options.deployAfterChecks ?? 0);
      return json([
        {
          name: options.deployJob ?? "pages",
          status: done ? "success" : "running",
          target_url: `${webUrl}/${options.project}/-/jobs/1`,
        },
      ]);
    }

    if (rest === "/pipelines" && url.searchParams.has("ref")) {
      return json(
        [...updateRuns].reverse().map((run) => ({
          id: run.id,
          source: run.source,
          status: run.status,
          created_at: "2026-01-05T04:17:00Z",
          web_url: `${webUrl}/${options.project}/-/pipelines/${run.id}`,
        })),
      );
    }
    if (rest === "/pipeline" && request.method === "POST") {
      if (accessLevel < 30) return json({ message: "403 Forbidden" }, 403);
      const body = (await request.json()) as { ref: string; variables?: Array<{ key: string; value: string }> };
      const run = addUpdateRun({ source: "api", status: "created", variables: body.variables });
      return json({ id: run.id, status: run.status }, 201);
    }
    if (rest === "/pipeline_schedules") {
      if (accessLevel < 30) return json({ message: "403 Forbidden" }, 403);
      if (request.method === "POST") {
        const body = (await request.json()) as {
          ref: string;
          cron: string;
          cron_timezone?: string;
          description?: string;
          active?: boolean;
        };
        // Schedules for a protected branch need permission to merge to it, as on GitLab.
        const protection = protectedBranches.get(body.ref);
        if (protection && accessLevel < protection.merge) return json({ message: "403 Forbidden" }, 403);
        const schedule: FakeSchedule = {
          id: ++scheduleIds,
          ref: body.ref,
          cron: body.cron,
          active: body.active ?? true,
          ...(body.description !== undefined && { description: body.description }),
          ...(body.cron_timezone !== undefined && { cronTimezone: body.cron_timezone }),
          owner: user.username,
        };
        updateSettings.schedules.push(schedule);
        return json(schedule, 201);
      }
      return json(updateSettings.schedules);
    }
    const scheduleMatch = rest.match(/^\/pipeline_schedules\/(\d+)(\/variables)?$/);
    if (scheduleMatch) {
      const schedule = updateSettings.schedules.find((candidate) => candidate.id === Number(scheduleMatch[1]));
      if (!schedule) return json({ message: "404 Not found" }, 404);
      // Only a schedule's owner or a Maintainer can change it.
      if (accessLevel < 30 || (accessLevel < 40 && schedule.owner !== user.username)) {
        return json({ message: "403 Forbidden" }, 403);
      }
      if (scheduleMatch[2] && request.method === "POST") {
        const body = (await request.json()) as { key: string; value: string };
        schedule.variables = { ...schedule.variables, [body.key]: body.value };
        return json(body, 201);
      }
      if (!scheduleMatch[2] && request.method === "DELETE") {
        updateSettings.schedules = updateSettings.schedules.filter((candidate) => candidate !== schedule);
        return new Response(null, { status: 204 });
      }
    }
    if (rest === "" && request.method === "PUT") {
      if (accessLevel < 40) return json({ message: "403 Forbidden" }, 403);
      const body = (await request.json()) as { ci_push_repository_for_job_token_allowed?: boolean };
      if (body.ci_push_repository_for_job_token_allowed !== undefined) {
        updateSettings.jobTokenPush = body.ci_push_repository_for_job_token_allowed;
      }
      return json({ ci_push_repository_for_job_token_allowed: updateSettings.jobTokenPush });
    }
    const updateJobs = rest.match(/^\/pipelines\/(\d{4,})\/jobs$/);
    if (updateJobs) {
      const run = updateRuns.find((candidate) => candidate.id === Number(updateJobs[1]));
      return run
        ? json([{ id: run.id, name: options.updateJob ?? "pages", status: run.status }])
        : json({ message: "404 Not Found" }, 404);
    }
    const updateTrace = rest.match(/^\/jobs\/(\d{4,})\/trace$/);
    if (updateTrace) {
      const run = updateRuns.find((candidate) => candidate.id === Number(updateTrace[1]));
      return run ? new Response(run.trace) : json({ message: "404 Not Found" }, 404);
    }

    if (rest === "/pipelines") {
      const sha = url.searchParams.get("sha");
      return json(
        [...(options.external ? [] : pipelines.keys())]
          .map((pipelineSha, index) => ({ id: index + 1, sha: pipelineSha }))
          .filter((pipeline) => !sha || pipeline.sha === sha),
      );
    }

    const pipelineJobs = rest.match(/^\/pipelines\/(\d+)\/jobs$/);
    if (pipelineJobs) {
      const id = Number(pipelineJobs[1]);
      const sha = [...pipelines.keys()][id - 1];
      if (!sha) return json({ message: "404 Not Found" }, 404);
      const failure = failures.get(sha);
      return json([
        failure
          ? { id, name: failure.job, status: failure.status, failure_reason: failure.failureReason }
          : { id, name: "pages", status: "success" },
      ]);
    }

    const trace = rest.match(/^\/jobs\/(\d+)\/trace$/);
    if (trace) {
      const sha = [...pipelines.keys()][Number(trace[1]) - 1];
      const failure = sha ? failures.get(sha) : undefined;
      return failure ? new Response(failure.trace) : json({ message: "404 Not Found" }, 404);
    }

    return json({ message: "404 Not Found" }, 404);
  }

  return {
    /** How many GraphQL requests read files, as `readFiles()` makes. */
    get graphqlReads() {
      return graphqlReads;
    },
    /** The project's members by user id, invitations by email, and protected branches, which tests can change. */
    members,
    invitations,
    protectedBranches,
    failBuild,
    cancelBuild,
    /** The project's update settings, and the pipelines the update ran in, which tests add with `addUpdateRun()`. */
    updateSettings,
    updateRuns,
    addUpdateRun,
    repo,
    /** Projects created through the API, by full path. */
    created,
    /** The site's GitLab Pages, if it has them, which tests can change. */
    pages,
    /** Who commits that named their author did name, by commit. */
    commitAuthors,
    requests,
    commit,
    authorize,
    handle,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init))) as typeof fetch,
  };
}

export type FakeGitLab = ReturnType<typeof fakeGitLab>;
