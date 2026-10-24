/**
 * A fake of the parts of GitHub's API that `@goodfellow-cms/github` uses, backed by
 * an in-memory repository. For tests only: pass `fake.fetch` as the backend's
 * `fetch`, or route browser requests to `fake.handle` in end-to-end tests.
 */
import { decodeBase64, encodeBase64Bytes, type FileChange } from "@goodfellow-cms/core";
import {
  FakeConflictError,
  type FakeFile,
  FakeRepo,
  fakeFileBytes,
  fakeFileFromBytes,
} from "@goodfellow-cms/core/testing";
import { openSealedSecret } from "./deploy-keys.js";

export interface FakeGitHubUser {
  login: string;
  name?: string;
  /** GitHub's number for the account. Defaults to one worked out from the login. */
  id?: number;
  /** Whether the user may publish. Defaults to true. */
  push?: boolean;
  /** Whether the token may write `.github/workflows/`. Defaults to true. */
  workflow?: boolean;
  /** Whether the token may change GitHub Pages settings. Defaults to true. */
  pages?: boolean;
  /** Whether the user is an owner (admin) of the site's repository. Defaults to false. */
  admin?: boolean;
  /** Whether the token has GitHub's Administration permission, which changing collaborators needs. Defaults to false. */
  administration?: boolean;
  /** Whether the token may read GitHub Actions. Defaults to true. */
  actions?: boolean;
  /** Whether the token may run workflows, as owner tokens can. Defaults to the `administration` setting. */
  actionsWrite?: boolean;
  /** Whether the token may set Actions secrets and add deploy keys. Defaults to true. */
  secrets?: boolean;
}

/** A GitHub Actions workflow run, with its jobs and their steps. */
export interface FakeRun {
  id: number;
  sha: string;
  /** What started it: `push` (the default), `schedule` or `workflow_dispatch`. */
  event?: string;
  /** For `workflow_dispatch`, the inputs it was given. */
  inputs?: Record<string, string>;
  createdAt?: string;
  status: "queued" | "in_progress" | "completed";
  conclusion: "success" | "failure" | "startup_failure" | "cancelled" | null;
  /** The workflow's file, `.github/workflows/deploy.yml` by default. */
  path?: string;
  jobs: Array<{ name: string; conclusion: string | null; steps: Array<{ name: string; conclusion: string | null }> }>;
}

/** A repository invitation that hasn't been accepted yet. */
export interface FakeInvitation {
  id: number;
  login: string;
  permission: "admin" | "write";
}

/** The site's GitHub Pages settings, as `GET /repos/{repo}/pages` reports them. */
export interface FakePages {
  html_url: string;
  cname: string | null;
  https_enforced: boolean;
  /** The certificate's state, such as `new` while it's being issued and `approved` once it's ready. */
  certificate?: string;
}

export interface FakeDeploymentStatus {
  state: "queued" | "in_progress" | "success" | "failure" | "error" | "inactive";
  log_url?: string;
}

export interface FakeGitHubOptions {
  /** `owner/name`. */
  repo: string;
  files?: Record<string, string>;
  /** Access tokens and the users they belong to. */
  tokens?: Record<string, FakeGitHubUser>;
  /**
   * Simulates GitHub Pages or Vercel: every commit gets a deployment that
   * reports success after being checked this many times. Off by default.
   */
  deployAfterChecks?: number;
  /**
   * Simulates Cloudflare Pages: every commit to the default branch gets a
   * build, which reports success after being checked this many times, as a
   * check run of Cloudflare's GitHub App, or as a commit status. Off by default.
   */
  cloudflare?: { afterChecks: number; report?: "check-runs" | "statuses" };
  /** Answers 403 to reading check runs, as GitHub does for fine-grained tokens, which can't have the permission. */
  checkRunsForbidden?: boolean;
  /** Organizations the users belong to, which new repositories can be created in. */
  orgs?: string[];
  /** The default branch of repositories created through the API, as an account's settings choose. Defaults to `main`. */
  newRepoBranch?: string;
  /** Whether private repositories can have GitHub Pages and rules, as on paid plans. Off by default, as on the free plan. */
  paidPlan?: boolean;
  /** Publishes the site with GitHub Pages, at `https://<owner>.github.io/<name>/`. Off by default. */
  pages?: boolean;
  /** Domains another GitHub Pages site already uses. */
  takenDomains?: string[];
  /** Other GitHub accounts that exist, which can be invited. Every token's user exists too. */
  accounts?: string[];
  /** GitHub Apps, which the sign-in worker signs people in with. */
  apps?: FakeGitHubApp[];
  /** Whether the site's repository is private. Public by default. */
  private?: boolean;
}

/** A GitHub App, as the sign-in worker uses one: its JWTs, installations, OAuth sign-in and tokens. */
export interface FakeGitHubApp {
  id: string;
  slug: string;
  clientId: string;
  clientSecret: string;
  /** The app's public key, which its JWTs are checked against. Without it, any JWT naming the app is accepted. */
  publicKey?: CryptoKey;
  /** The most its tokens may be given, as GitHub names permissions. */
  permissions: Record<string, "read" | "write">;
  installations: FakeInstallation[];
}

/** An app installed on an account, for some or all of its repositories. */
export interface FakeInstallation {
  id: number;
  /** The account it's installed on. */
  account: string;
  accountType?: "User" | "Organization";
  /** The repositories it can use, as `owner/name`, or `all` of the account's. */
  repositories: string[] | "all";
}

/** A token an app's sign-in made: a person's own, or an installation's for some repositories. */
export interface FakeIssuedToken {
  token: string;
  kind: "user" | "installation";
  app: string;
  login?: string;
  repositories?: string[];
  permissions: Record<string, string>;
  revoked?: boolean;
}

/** Who a token belongs to, and for an app's tokens, what they're limited to. */
interface Principal extends FakeGitHubUser {
  app?: FakeGitHubApp;
  /** For an installation's token: the repositories it may use. */
  repositories?: string[];
  /** For an app's tokens: what they may do. */
  permissions?: Record<string, string>;
  /** An installation's token, which acts as the app rather than a person. */
  bot?: boolean;
}

/** GitHub's number for an account, worked out from its login when a test doesn't give one. */
function accountId(login: string): number {
  let hash = 7;
  for (const char of login.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) % 9_000_000;
  return 1_000_000 + hash;
}

function same(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function covers(installation: FakeInstallation, fullName: string): boolean {
  const [owner = ""] = fullName.split("/");
  if (!same(installation.account, owner)) return false;
  return installation.repositories === "all" || installation.repositories.some((repo) => same(repo, fullName));
}

function decodeJwtPart(part: string): Record<string, unknown> | undefined {
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4))) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

/** A repository created through the fake's API, as the setup page creates them. */
export interface FakeCreatedRepo {
  id: number;
  fullName: string;
  private: boolean;
  description?: string;
  repo: FakeRepo;
  pages?: { build_type: string; cname?: string };
  rulesets: unknown[];
  /** Deploy keys added to it, by their public key. */
  deployKeys: Array<{ title: string; key: string; read_only: boolean }>;
  /** Its Actions secrets, opened. */
  secrets: Map<string, string>;
  /** The key pair GitHub seals secrets with. */
  secretKey?: CryptoKeyPair;
  /** People's permission on it, by login, as `collaborators/{login}/permission` says; others have none. */
  collaborators?: Map<string, "admin" | "write" | "read">;
}

interface Deployment {
  id: number;
  sha: string;
  statuses: FakeDeploymentStatus[];
  checks: number;
}

/** A build Cloudflare Pages reports on a commit, which tests can fail with `failCloudflare()`. */
export interface FakeCloudflareBuild {
  checks: number;
  failed?: boolean;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

export function fakeGitHub(options: FakeGitHubOptions) {
  const repo = new FakeRepo(options.files);
  const tokens = options.tokens ?? { "test-token": { login: "editor", name: "Test Editor" } };
  /** Every token that works: the test's own, and those apps' sign-ins make. */
  const principals = new Map<string, Principal>(Object.entries(tokens));
  const apps = options.apps ?? [];
  const issued: FakeIssuedToken[] = [];
  /** OAuth codes waiting to be exchanged, and refresh tokens, by the app and person they're for. */
  const codes = new Map<string, { app: FakeGitHubApp; login: string }>();
  const refreshTokens = new Map<string, { app: FakeGitHubApp; login: string }>();
  /** Who each commit made through the REST API names as its author. */
  const commitAuthors = new Map<string, { name?: string; email?: string }>();
  let nextToken = 1;
  let nextRepoId = 100;
  const deployments: Deployment[] = [];
  const cloudflareBuilds = new Map<string, FakeCloudflareBuild>();
  const runs: FakeRun[] = [];
  const requests: Request[] = [];
  let nextDeployment = 1;
  let graphqlReads = 0;
  const created = new Map<string, FakeCreatedRepo>();
  const [owner = "", name = ""] = options.repo.split("/");
  const pages: { current?: FakePages } = {
    current: options.pages
      ? { html_url: `https://${owner.toLowerCase()}.github.io/${name}/`, cname: null, https_enforced: false }
      : undefined,
  };
  const trees = new Map<string, Map<string, FakeFile>>();
  /** The repository's collaborators and their permission. Every token's user is one. */
  const collaborators = new Map<string, "admin" | "push" | "read">(
    Object.values(tokens).map((user) => [user.login, user.admin ? "admin" : user.push === false ? "read" : "push"]),
  );
  const invitations: FakeInvitation[] = [];
  const accounts = new Set([...Object.values(tokens).map((user) => user.login), ...(options.accounts ?? [])]);
  let nextInvitation = 1;

  /** Collaborators and invitations, which only owners' tokens with the Administration permission can change. */
  async function handleCollaborators(request: Request, rest: string, user: FakeGitHubUser) {
    const forbidden = () => json({ message: "Resource not accessible by personal access token" }, 403);
    const canManage = user.admin === true && user.administration === true;
    if (rest === "/collaborators" && request.method === "GET") {
      return json(
        [...collaborators].map(([login, permission]) => ({
          login,
          avatar_url: `https://avatars.example/${login}`,
          permissions: { admin: permission === "admin", maintain: false, push: permission !== "read", pull: true },
        })),
      );
    }
    if (rest === "/invitations" && request.method === "GET") {
      if (!canManage) return forbidden();
      return json(
        invitations.map((invitation) => ({
          id: invitation.id,
          invitee: { login: invitation.login, avatar_url: `https://avatars.example/${invitation.login}` },
          permissions: invitation.permission,
        })),
      );
    }
    const permission = rest.match(/^\/collaborators\/([^/]+)\/permission$/);
    if (permission && request.method === "GET") {
      const login = decodeURIComponent(permission[1] ?? "");
      if (!accounts.has(login)) return json({ message: "Not Found" }, 404);
      const role = collaborators.get(login);
      const level = role === "admin" ? "admin" : role === "push" ? "write" : role === "read" ? "read" : "none";
      return json({
        permission: level,
        user: {
          login,
          permissions: {
            admin: level === "admin",
            push: level === "admin" || level === "write",
            pull: level !== "none",
          },
        },
      });
    }
    const collaborator = rest.match(/^\/collaborators\/([^/]+)$/);
    if (collaborator) {
      if (!canManage) return forbidden();
      const login = decodeURIComponent(collaborator[1] ?? "");
      if (request.method === "DELETE") {
        collaborators.delete(login);
        return new Response(null, { status: 204 });
      }
      if (request.method === "PUT") {
        if (!accounts.has(login)) return json({ message: "Not Found" }, 404);
        const { permission = "push" } = (await request.json()) as { permission?: "admin" | "push" };
        if (collaborators.has(login)) {
          collaborators.set(login, permission);
          return new Response(null, { status: 204 });
        }
        const existing = invitations.find((invitation) => invitation.login === login);
        const invitation = existing ?? { id: nextInvitation++, login, permission: "write" as const };
        invitation.permission = permission === "admin" ? "admin" : "write";
        if (!existing) invitations.push(invitation);
        return json({ id: invitation.id, invitee: { login }, permissions: invitation.permission }, 201);
      }
    }
    const invitation = rest.match(/^\/invitations\/(\d+)$/);
    if (invitation) {
      if (!canManage) return forbidden();
      const index = invitations.findIndex((candidate) => candidate.id === Number(invitation[1]));
      if (index === -1) return json({ message: "Not Found" }, 404);
      if (request.method === "DELETE") {
        invitations.splice(index, 1);
        return new Response(null, { status: 204 });
      }
      if (request.method === "PATCH") {
        const { permissions } = (await request.json()) as { permissions: "admin" | "write" };
        (invitations[index] as FakeInvitation).permission = permissions;
        return json({ id: invitations[index]?.id, permissions });
      }
    }
    return undefined;
  }

  /**
   * Simulates the deploy workflow failing for a commit at a step, such as
   * `"Run npm ci"`, in the `build` job or another, or before any step ran.
   */
  function failBuild(sha: string, step?: string, job = "build"): FakeRun {
    const run: FakeRun = {
      id: runs.length + 1,
      sha,
      status: "completed",
      conclusion: "failure",
      jobs: [
        {
          name: job,
          conclusion: "failure",
          steps: step
            ? [
                { name: "Set up job", conclusion: "success" },
                { name: step, conclusion: "failure" },
              ]
            : [],
        },
      ],
    };
    runs.push(run);
    return run;
  }

  /**
   * Simulates the deploy workflow's run for a commit being cancelled, as a
   * newer run in its concurrency group replaces one still waiting: it never
   * deploys.
   */
  function cancelBuild(sha: string): FakeRun {
    for (const [index, deployment] of [...deployments.entries()].reverse()) {
      if (deployment.sha === sha) deployments.splice(index, 1);
    }
    const run: FakeRun = { id: runs.length + 1, sha, status: "completed", conclusion: "cancelled", jobs: [] };
    runs.push(run);
    return run;
  }

  /** Simulates an invited person accepting the invitation. */
  function accept(login: string): void {
    const index = invitations.findIndex((invitation) => invitation.login === login);
    const [invitation] = index === -1 ? [] : invitations.splice(index, 1);
    if (invitation) collaborators.set(login, invitation.permission === "admin" ? "admin" : "push");
  }

  /** Adds another repository, as if someone had made it, such as a site's code repository beside its content's. */
  function addRepo(
    fullName: string,
    repoOptions: {
      files?: Record<string, string>;
      private?: boolean;
      collaborators?: Record<string, "admin" | "write" | "read">;
    } = {},
  ): FakeCreatedRepo {
    const added: FakeCreatedRepo = {
      id: nextRepoId++,
      fullName,
      private: repoOptions.private === true,
      repo: new FakeRepo(repoOptions.files ?? {}, "main"),
      rulesets: [],
      deployKeys: [],
      secrets: new Map(),
      collaborators: new Map(Object.entries(repoOptions.collaborators ?? {})),
    };
    created.set(fullName, added);
    return added;
  }

  /** Repository creation and the Git data API, for repositories created through the fake. */
  async function handleCreated(request: Request, path: string, principal: Principal): Promise<Response | undefined> {
    const login = principal.login;
    if (path === "/user/orgs") return json((options.orgs ?? []).map((org) => ({ login: org })));
    const create = path === "/user/repos" ? login : path.match(/^\/orgs\/([^/]+)\/repos$/)?.[1];
    if (create !== undefined && request.method === "POST") {
      if (principal.bot || (principal.app && principal.permissions?.administration !== "write")) {
        return json({ message: "Resource not accessible by integration" }, 403);
      }
      if (path !== "/user/repos" && !options.orgs?.includes(create)) return json({ message: "Not Found" }, 404);
      const body = (await request.json()) as { name: string; private?: boolean; description?: string };
      if (!/^[\w.-]+$/.test(body.name)) return json({ message: "Repository creation failed." }, 422);
      const fullName = `${create}/${body.name}`;
      if (created.has(fullName) || fullName === options.repo) {
        return json(
          { message: "Repository creation failed.", errors: [{ message: "name already exists on this account" }] },
          422,
        );
      }
      const repo = new FakeRepo({ "README.md": `# ${body.name}\n` }, options.newRepoBranch ?? "main");
      const id = nextRepoId++;
      created.set(fullName, {
        id,
        fullName,
        private: body.private === true,
        description: body.description,
        repo,
        rulesets: [],
        deployKeys: [],
        secrets: new Map(),
      });
      return json(
        { id, full_name: fullName, html_url: `https://github.com/${fullName}`, default_branch: repo.defaultBranch },
        201,
      );
    }

    const match = path.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    const site = created.get(decodeURIComponent(match?.[1] ?? ""));
    if (!match || !site) return undefined;
    if (!canSee(principal, site.fullName)) return json({ message: "Not Found" }, 404);
    const { repo } = site;
    const rest = match[2] ?? "";
    const method = request.method;

    if (rest === "" && method === "GET") {
      return json({
        id: site.id,
        full_name: site.fullName,
        private: site.private,
        default_branch: repo.defaultBranch,
        permissions: { push: true, admin: true },
      });
    }
    // Reading files as backends do, for repositories tests add, such as a site's code repository.
    const tree = rest.match(/^\/git\/trees\/([0-9a-f]{40})$/);
    if (tree && method === "GET" && repo.commitAt(tree[1] ?? "")) {
      const entries = [...repo.files(tree[1] ?? "")].map(([file, content]) => ({
        path: file,
        type: "blob",
        sha: repo.blobSha(content),
        size: fakeFileBytes(content).length,
      }));
      return json({ sha: tree[1], tree: entries, truncated: false });
    }
    const blob = rest.match(/^\/git\/blobs\/([0-9a-f]{40})$/);
    if (blob && method === "GET") {
      const content = repo.blobs.get(blob[1] ?? "");
      if (content === undefined) return json({ message: "Not Found" }, 404);
      return new Response(fakeFileBytes(content));
    }
    const contents = rest.match(/^\/contents\/(.+)$/);
    if (contents && method === "GET") {
      if (principal.app && !principal.permissions?.contents) return json({ message: "Resource not accessible" }, 403);
      const file = repo.files().get(decodeURIComponent(contents[1] ?? ""));
      if (file === undefined) return json({ message: "Not Found" }, 404);
      return new Response(typeof file === "string" ? file : fakeFileBytes(file));
    }
    const permission = rest.match(/^\/collaborators\/([^/]+)\/permission$/);
    if (permission && method === "GET") {
      const login = decodeURIComponent(permission[1] ?? "");
      return json({ permission: site.collaborators?.get(login) ?? "none", user: { login } });
    }
    if (rest === "" && method === "PATCH") {
      const body = (await request.json()) as { default_branch?: string };
      if (body.default_branch) {
        if (!repo.branches.has(body.default_branch)) return json({ message: "Not Found" }, 422);
        repo.defaultBranch = body.default_branch;
      }
      return json({ full_name: site.fullName, default_branch: repo.defaultBranch });
    }
    const ref = rest.match(/^\/git\/refs?\/heads\/(.+)$/);
    if (ref && method === "GET") {
      const sha = repo.branches.get(decodeURIComponent(ref[1] ?? ""));
      return sha ? json({ object: { sha } }) : json({ message: "Not Found" }, 404);
    }
    if (ref && method === "DELETE") {
      repo.branches.delete(decodeURIComponent(ref[1] ?? ""));
      return new Response(null, { status: 204 });
    }
    if (rest === "/git/refs" && method === "POST") {
      const body = (await request.json()) as { ref: string; sha: string };
      repo.branches.set(body.ref.replace(/^refs\/heads\//, ""), body.sha);
      return json({ ref: body.ref, object: { sha: body.sha } }, 201);
    }
    const data = await handleGitData(request, rest, repo, principal, site.rulesets.length > 0);
    if (data) return data;
    if (rest === "/pages" && method === "POST") {
      if (site.private && !options.paidPlan) {
        return json({ message: "Your current plan does not support GitHub Pages for this repository." }, 422);
      }
      site.pages = (await request.json()) as { build_type: string };
      const [owner, name] = site.fullName.split("/");
      return json({ html_url: `https://${owner}.github.io/${name}/`, build_type: site.pages.build_type }, 201);
    }
    if (rest === "/pages" && method === "PUT" && site.pages) {
      const body = (await request.json()) as { cname?: string };
      if (body.cname && options.takenDomains?.includes(body.cname)) {
        return json({ message: `The CNAME \`${body.cname}\` is already taken.` }, 422);
      }
      if (body.cname) site.pages.cname = body.cname;
      return new Response(null, { status: 204 });
    }
    const notAllowed = (permission: string) =>
      principal.app ? principal.permissions?.[permission] !== "write" : principal.secrets === false;
    if (rest === "/keys" && method === "POST") {
      if (notAllowed("administration")) return json({ message: "Resource not accessible by integration" }, 403);
      const body = (await request.json()) as { title: string; key: string; read_only?: boolean };
      if (!/^ssh-ed25519 [A-Za-z0-9+/=]+( |$)/.test(body.key)) return json({ message: "key is invalid" }, 422);
      site.deployKeys.push({ title: body.title, key: body.key, read_only: body.read_only === true });
      return json({ id: site.deployKeys.length, ...body }, 201);
    }
    if (rest === "/actions/secrets/public-key" && method === "GET") {
      if (notAllowed("secrets")) return json({ message: "Resource not accessible by integration" }, 403);
      site.secretKey ??= (await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveBits"])) as CryptoKeyPair;
      const raw = new Uint8Array(await crypto.subtle.exportKey("raw", site.secretKey.publicKey));
      return json({ key_id: `key-${site.id}`, key: encodeBase64Bytes(raw) });
    }
    const secret = rest.match(/^\/actions\/secrets\/([A-Z0-9_]+)$/);
    if (secret && method === "PUT") {
      if (notAllowed("secrets")) return json({ message: "Resource not accessible by integration" }, 403);
      const body = (await request.json()) as { encrypted_value: string; key_id: string };
      if (!site.secretKey || body.key_id !== `key-${site.id}`) return json({ message: "Bad key id" }, 422);
      try {
        site.secrets.set(secret[1] ?? "", await openSealedSecret(decodeBase64(body.encrypted_value), site.secretKey));
      } catch {
        return json({ message: "Bad encrypted value" }, 422);
      }
      return new Response(null, { status: 201 });
    }
    if (rest === "/rulesets" && method === "POST") {
      if (site.private && !options.paidPlan) return json({ message: "Upgrade to GitHub Pro" }, 403);
      site.rulesets.push(await request.json());
      return json({ id: site.rulesets.length }, 201);
    }
    return json({ message: "Not Found" }, 404);
  }

  /** Whether a token may see a repository: an app's only where it's installed, and an installation's only its own. */
  function canSee(principal: Principal, fullName: string): boolean {
    if (principal.repositories) return principal.repositories.some((repo) => same(repo, fullName));
    if (principal.app) return principal.app.installations.some((installation) => covers(installation, fullName));
    return true;
  }

  function treeOf(target: FakeRepo, commitSha: string): string {
    const sha = target.blobSha(`tree-of:${commitSha}`);
    if (!trees.has(sha)) trees.set(sha, new Map(target.files(commitSha)));
    return sha;
  }

  /** Git's data API on a repository: blobs, trees, commits and moving a branch, as REST commits need. */
  async function handleGitData(
    request: Request,
    rest: string,
    target: FakeRepo,
    principal: Principal,
    protectedHistory: boolean,
  ): Promise<Response | undefined> {
    const method = request.method;
    const commitSha = rest.match(/^\/git\/commits\/([0-9a-f]{40})$/);
    if (commitSha && method === "GET") {
      const found = target.commitAt(commitSha[1] ?? "");
      if (!found) return json({ message: "Not Found" }, 404);
      return json({
        sha: found.sha,
        tree: { sha: treeOf(target, found.sha) },
        parents: found.parent ? [{ sha: found.parent }] : [],
      });
    }
    if (rest === "/git/blobs" && method === "POST") {
      if (principal.push === false) return json({ message: "Resource not accessible by integration" }, 403);
      const body = (await request.json()) as { content: string; encoding: string };
      return json(
        {
          sha: target.blobSha(
            body.encoding === "base64" ? fakeFileFromBytes(decodeBase64(body.content)) : body.content,
          ),
        },
        201,
      );
    }
    if (rest === "/git/trees" && method === "POST") {
      const body = (await request.json()) as {
        base_tree?: string;
        tree: { path: string; content?: string; sha?: string | null }[];
      };
      if (body.base_tree && !trees.has(body.base_tree)) return json({ message: "Tree not found" }, 422);
      const files = new Map<string, FakeFile>(body.base_tree ? trees.get(body.base_tree) : undefined);
      for (const entry of body.tree) {
        if (entry.path.startsWith(".github/workflows/") && principal.workflow === false) {
          return json({ message: "Resource not accessible by personal access token" }, 404);
        }
        if (entry.sha === null) {
          files.delete(entry.path);
          continue;
        }
        const content = entry.content ?? target.blobs.get(entry.sha ?? "");
        if (content === undefined) return json({ message: `No blob ${entry.sha}` }, 422);
        files.set(entry.path, content);
      }
      const sha = target.blobSha(`tree:${[...files.keys()].join(",")}:${trees.size}`);
      trees.set(sha, files);
      return json({ sha }, 201);
    }
    if (rest === "/git/commits" && method === "POST") {
      const body = (await request.json()) as {
        message: string;
        tree: string;
        parents: string[];
        author?: { name?: string; email?: string };
      };
      const files = trees.get(body.tree);
      if (!files) return json({ message: "Tree not found" }, 422);
      const author = body.author?.name ?? (principal.bot ? principal.login : (principal.name ?? principal.login));
      const sha = target.addCommit(body.parents[0], body.message, new Map(files), author);
      commitAuthors.set(sha, body.author ?? { name: author });
      return json({ sha }, 201);
    }
    const ref = rest.match(/^\/git\/refs?\/heads\/(.+)$/);
    if (ref && method === "PATCH") {
      if (principal.push === false) return json({ message: "Resource not accessible by integration" }, 403);
      const body = (await request.json()) as { sha: string; force?: boolean };
      const branch = decodeURIComponent(ref[1] ?? "");
      const found = target.commitAt(body.sha);
      if (!found || !target.branches.has(branch)) return json({ message: "Reference does not exist" }, 422);
      if (!body.force && found.parent !== target.branches.get(branch)) {
        return json({ message: "Update is not a fast forward" }, 422);
      }
      if (protectedHistory && found.parent !== target.branches.get(branch)) {
        return json({ message: "Cannot force-push to this branch" }, 422);
      }
      target.branches.set(branch, body.sha);
      if (branch === target.defaultBranch) deploy(body.sha);
      return json({ object: { sha: body.sha } });
    }
    return undefined;
  }

  function deploy(sha: string): void {
    if (options.cloudflare) cloudflareBuilds.set(sha, { checks: 0 });
    if (options.deployAfterChecks === undefined) return;
    deployments.unshift({ id: nextDeployment++, sha, statuses: [{ state: "in_progress" }], checks: 0 });
  }

  /** Where a Cloudflare build is up to, counting the check. */
  function cloudflareState(sha: string): "building" | "success" | "failure" | undefined {
    const build = cloudflareBuilds.get(sha);
    if (!build) return undefined;
    build.checks += 1;
    if (build.failed) return "failure";
    return build.checks > (options.cloudflare?.afterChecks ?? 0) ? "success" : "building";
  }

  function failCloudflare(sha: string): void {
    cloudflareBuilds.set(sha, { checks: 0, failed: true });
  }

  function commit(
    changes: FileChange[],
    message: string,
    expectedHead?: string,
    author?: string,
    branch = repo.defaultBranch,
  ): string {
    const sha = repo.commit(changes, message, { expectedHead, author, branch });
    // Only the live branch is built, as the starters' deploy workflow does.
    if (branch === repo.defaultBranch) deploy(sha);
    return sha;
  }

  /** The person a login belongs to, as the test's tokens describe them. */
  function person(login: string): FakeGitHubUser {
    return Object.values(tokens).find((candidate) => same(candidate.login, login)) ?? { login };
  }

  /** Simulates someone signing in to an app on GitHub's page: the code GitHub sends back to the app's callback. */
  function authorize(login: string, clientId: string): string {
    const app = apps.find((candidate) => candidate.clientId === clientId);
    if (!app) throw new Error(`No app with client ID ${clientId}`);
    const code = `code-${nextToken++}`;
    codes.set(code, { app, login });
    return code;
  }

  /**
   * Simulates someone installing an app on GitHub's install page, choosing
   * these repositories, or adding them to its installation on the account,
   * and being signed in as they go: the code GitHub sends back to the app's callback.
   */
  function install(
    slug: string,
    login: string,
    repositories: string[],
    account = repositories[0]?.split("/")[0] ?? login,
  ) {
    const app = apps.find((candidate) => candidate.slug === slug);
    if (!app) throw new Error(`No app ${slug}`);
    let installation = app.installations.find((candidate) => same(candidate.account, account));
    if (!installation) {
      installation = { id: 1000 + nextToken++, account, repositories: [] };
      app.installations.push(installation);
    }
    const chosen = installation.repositories;
    if (chosen !== "all")
      for (const repo of repositories) if (!chosen.some((name) => same(name, repo))) chosen.push(repo);
    return { code: authorize(login, app.clientId), installation: installation.id };
  }

  function userToken(app: FakeGitHubApp, login: string) {
    const access = `ghu_fake${nextToken++}`;
    const refresh = `ghr_fake${nextToken++}`;
    const base = person(login);
    principals.set(access, {
      ...base,
      app,
      permissions: app.permissions,
      administration: app.permissions.administration === "write",
      pages: app.permissions.pages === "write",
      workflow: app.permissions.workflows === "write",
      actions: app.permissions.actions !== undefined,
      actionsWrite: app.permissions.actions === "write",
    });
    refreshTokens.set(refresh, { app, login });
    issued.push({ token: access, kind: "user", app: app.slug, login, permissions: app.permissions });
    return json({
      access_token: access,
      token_type: "bearer",
      scope: "",
      expires_in: 28_800,
      refresh_token: refresh,
      refresh_token_expires_in: 15_897_600,
    });
  }

  async function appFromJwt(jwt: string): Promise<FakeGitHubApp | undefined> {
    const [header, payload, signature] = jwt.split(".");
    const claims = decodeJwtPart(payload ?? "");
    if (!header || !claims || !signature || decodeJwtPart(header)?.alg !== "RS256") return undefined;
    const app = apps.find((candidate) => String(candidate.id) === String(claims.iss));
    if (!app || typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) return undefined;
    if (app.publicKey) {
      const base64 = signature.replace(/-/g, "+").replace(/_/g, "/");
      const bytes = Uint8Array.from(atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4)), (char) =>
        char.charCodeAt(0),
      );
      const valid = await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        app.publicKey,
        bytes,
        new TextEncoder().encode(`${header}.${payload}`),
      );
      if (!valid) return undefined;
    }
    return app;
  }

  /** What GitHub Apps call: OAuth's token exchange, revoking, and the app's own endpoints, which take its JWT. */
  async function handleApps(request: Request, path: string): Promise<Response | undefined> {
    const authorization = request.headers.get("authorization") ?? "";
    if (path === "/login/oauth/access_token" && request.method === "POST") {
      const body = (await request.json()) as Record<string, string>;
      const app = apps.find((candidate) => candidate.clientId === body.client_id);
      if (!app || app.clientSecret !== body.client_secret) return json({ error: "incorrect_client_credentials" });
      if (body.grant_type === "refresh_token") {
        const found = refreshTokens.get(body.refresh_token ?? "");
        if (!found || found.app !== app) return json({ error: "bad_refresh_token" });
        refreshTokens.delete(body.refresh_token ?? "");
        return userToken(app, found.login);
      }
      const found = codes.get(body.code ?? "");
      if (!found || found.app !== app) return json({ error: "bad_verification_code" });
      codes.delete(body.code ?? "");
      return userToken(app, found.login);
    }

    const revoke = path.match(/^\/applications\/([^/]+)\/token$/);
    if (revoke && request.method === "DELETE") {
      const [id, secret] = atob(authorization.replace(/^Basic /, "")).split(":");
      const app = apps.find((candidate) => candidate.clientId === decodeURIComponent(revoke[1] ?? ""));
      if (!app || app.clientId !== id || app.clientSecret !== secret) return json({ message: "Not Found" }, 404);
      const { access_token: token } = (await request.json()) as { access_token: string };
      principals.delete(token);
      for (const item of issued) if (item.token === token) item.revoked = true;
      return new Response(null, { status: 204 });
    }

    if (path === "/installation/token" && request.method === "DELETE") {
      const token = authorization.replace(/^Bearer /, "");
      if (!principals.get(token)?.bot) return json({ message: "Bad credentials" }, 401);
      principals.delete(token);
      for (const item of issued) if (item.token === token) item.revoked = true;
      return new Response(null, { status: 204 });
    }

    if (!/^Bearer ey/.test(authorization)) return undefined;
    const app = await appFromJwt(authorization.slice("Bearer ".length));
    if (!app) return json({ message: "A JSON web token could not be decoded" }, 401);

    const installed = path.match(/^\/repos\/([^/]+\/[^/]+)\/installation$/);
    if (installed) {
      const fullName = decodeURIComponent(installed[1] ?? "");
      const installation = app.installations.find((candidate) => covers(candidate, fullName));
      return installation
        ? json({ id: installation.id, account: { login: installation.account }, app_slug: app.slug })
        : json({ message: "Not Found" }, 404);
    }

    const mint = path.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
    if (mint && request.method === "POST") {
      const installation = app.installations.find((candidate) => candidate.id === Number(mint[1]));
      if (!installation) return json({ message: "Not Found" }, 404);
      const body = (await request.json()) as {
        repositories?: string[];
        permissions?: Record<string, "read" | "write">;
      };
      const repositories = (body.repositories ?? []).map((name) => `${installation.account}/${name}`);
      if (repositories.some((repo) => !covers(installation, repo))) {
        return json({ message: "There is at least one repository that does not exist or is not accessible" }, 422);
      }
      const permissions = body.permissions ?? app.permissions;
      for (const [name, level] of Object.entries(permissions)) {
        const allowed = app.permissions[name];
        if (!allowed || (level === "write" && allowed !== "write")) {
          return json({ message: `The permissions requested are not granted to this installation.` }, 422);
        }
      }
      const token = `ghs_fake${nextToken++}`;
      principals.set(token, {
        login: `${app.slug}[bot]`,
        bot: true,
        app,
        repositories,
        permissions,
        push: permissions.contents === "write",
        workflow: permissions.workflows === "write",
        pages: permissions.pages === "write",
        administration: permissions.administration === "write",
        admin: permissions.administration === "write",
        actions: permissions.actions !== undefined,
        actionsWrite: permissions.actions === "write",
      });
      issued.push({ token, kind: "installation", app: app.slug, repositories, permissions });
      return json({ token, expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions }, 201);
    }
    return json({ message: "Not Found" }, 404);
  }

  async function handle(request: Request): Promise<Response> {
    requests.push(request.clone());
    const url = new URL(request.url);
    const path = url.pathname;
    const fromApp = await handleApps(request, path);
    if (fromApp) return fromApp;
    const user = principals.get(request.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
    if (!user) return json({ message: "Bad credentials" }, 401);

    if (path === "/user") {
      if (user.bot) return json({ message: "Resource not accessible by integration" }, 403);
      return json({
        id: user.id ?? accountId(user.login),
        login: user.login,
        name: user.name ?? null,
        avatar_url: `https://avatars.example/${user.login}`,
      });
    }

    if (path === "/user/installations" && user.app && !user.bot) {
      const mine = user.app.installations.filter(
        (installation) =>
          same(installation.account, user.login) || (options.orgs ?? []).some((org) => same(org, installation.account)),
      );
      return json({
        total_count: mine.length,
        installations: mine.map((installation) => ({
          id: installation.id,
          account: { login: installation.account, type: installation.accountType ?? "User" },
          repository_selection: installation.repositories === "all" ? "all" : "selected",
        })),
      });
    }
    const listRepos = path.match(/^\/user\/installations\/(\d+)\/repositories$/);
    if (listRepos && request.method === "GET" && user.app && !user.bot) {
      const installation = user.app.installations.find((candidate) => candidate.id === Number(listRepos[1]));
      if (!installation) return json({ message: "Not Found" }, 404);
      const names =
        installation.repositories === "all"
          ? [options.repo, ...created.keys()].filter((name) => same(name.split("/")[0] ?? "", installation.account))
          : installation.repositories;
      const repositories = names.map((name) => ({
        full_name: name,
        default_branch: same(name, options.repo)
          ? repo.defaultBranch
          : (created.get(name)?.repo.defaultBranch ?? "main"),
        permissions: { admin: user.admin === true, push: user.push !== false, pull: true },
      }));
      return json({ total_count: repositories.length, repositories });
    }
    const addRepo = path.match(/^\/user\/installations\/(\d+)\/repositories\/(\d+)$/);
    if (addRepo && request.method === "PUT" && user.app && !user.bot) {
      const installation = user.app.installations.find((candidate) => candidate.id === Number(addRepo[1]));
      const target = [...created.values()].find((candidate) => candidate.id === Number(addRepo[2]));
      if (!installation || !target) return json({ message: "Not Found" }, 404);
      if (installation.repositories !== "all" && !installation.repositories.includes(target.fullName)) {
        installation.repositories.push(target.fullName);
      }
      return new Response(null, { status: 204 });
    }

    const setup = await handleCreated(request, path, user);
    if (setup) return setup;

    const account = path.match(/^\/users\/([^/]+)$/);
    if (account) {
      const login = decodeURIComponent(account[1] ?? "");
      return accounts.has(login) ? json({ login }) : json({ message: "Not Found" }, 404);
    }

    if (path === "/graphql" && request.method === "POST") {
      const body = (await request.clone().json()) as { query: string; variables?: { owner?: string; name?: string } };
      if (body.query.trimStart().startsWith("query")) {
        // Reading blobs by id, as `readFiles()` does.
        if (`${body.variables?.owner}/${body.variables?.name}` !== options.repo) {
          return json({ data: { repository: null }, errors: [{ type: "NOT_FOUND", message: "Could not resolve" }] });
        }
        const repository: Record<string, { text: string | null; isBinary: boolean } | null> = {};
        for (const [, alias, oid] of body.query.matchAll(/(\w+): object\(oid: "([0-9a-f]{40})"\)/g)) {
          const content = repo.blobs.get(oid ?? "");
          repository[alias ?? ""] =
            content === undefined
              ? null
              : typeof content === "string"
                ? { text: content, isBinary: false }
                : { text: null, isBinary: true };
        }
        graphqlReads += 1;
        return json({ data: { repository } });
      }
      const { variables } = (await request.json()) as {
        variables: {
          input: {
            branch: { repositoryNameWithOwner: string; branchName: string };
            message: { headline: string };
            expectedHeadOid: string;
            fileChanges: { additions?: Array<{ path: string; contents: string }>; deletions?: Array<{ path: string }> };
          };
        };
      };
      const { input } = variables;
      if (input.branch.repositoryNameWithOwner !== options.repo) {
        return json({ errors: [{ type: "NOT_FOUND", message: "Could not resolve to a Repository" }] });
      }
      if (user.push === false) return json({ errors: [{ type: "FORBIDDEN", message: "Resource not accessible" }] });
      const files = repo.files(input.branch.branchName);
      for (const deletion of input.fileChanges.deletions ?? []) {
        if (!files.has(deletion.path)) return json({ errors: [{ message: `No file at ${deletion.path}` }] });
      }
      try {
        const oid = commit(
          [
            ...(input.fileChanges.additions ?? []).map((addition) => ({
              path: addition.path,
              bytes: decodeBase64(addition.contents),
            })),
            ...(input.fileChanges.deletions ?? []).map((deletion) => ({ path: deletion.path, delete: true as const })),
          ],
          input.message.headline,
          input.expectedHeadOid,
          user.name ?? user.login,
          input.branch.branchName,
        );
        return json({ data: { createCommitOnBranch: { commit: { oid } } } });
      } catch (error) {
        if (error instanceof FakeConflictError) {
          return json({
            data: { createCommitOnBranch: null },
            errors: [{ type: "STALE_DATA", message: "Expected branch to point to another commit" }],
          });
        }
        throw error;
      }
    }

    const match = path.match(/^\/repos\/([^/]+\/[^/]+)(\/.*)?$/);
    if (!match || decodeURIComponent(match[1] ?? "") !== options.repo) return json({ message: "Not Found" }, 404);
    if (!canSee(user, options.repo)) return json({ message: "Not Found" }, 404);
    const rest = match[2] ?? "";

    const contents = rest.match(/^\/contents\/(.+)$/);
    if (contents && request.method === "GET") {
      if (user.bot && !user.permissions?.contents) {
        return json({ message: "Resource not accessible by integration" }, 403);
      }
      const file = repo
        .files(url.searchParams.get("ref") ?? repo.defaultBranch)
        .get(decodeURIComponent(contents[1] ?? ""));
      if (file === undefined) return json({ message: "Not Found" }, 404);
      return request.headers.get("accept")?.includes("raw")
        ? new Response(fakeFileBytes(file))
        : json({ content: encodeBase64Bytes(fakeFileBytes(file)), encoding: "base64" });
    }

    const data = await handleGitData(request, rest, repo, user, false);
    if (data) return data;

    if (rest === "/git/refs" && request.method === "POST") {
      if (user.push === false) return json({ message: "Resource not accessible by integration" }, 403);
      const body = (await request.json()) as { ref: string; sha: string };
      const branch = body.ref.replace(/^refs\/heads\//, "");
      if (repo.branches.has(branch)) return json({ message: "Reference already exists" }, 422);
      if (!repo.commitAt(body.sha)) return json({ message: "Object does not exist" }, 422);
      repo.branches.set(branch, body.sha);
      return json({ ref: body.ref, object: { sha: body.sha } }, 201);
    }
    const branchRef = rest.match(/^\/git\/refs\/heads\/(.+)$/);
    if (branchRef && request.method === "DELETE") {
      if (user.push === false) return json({ message: "Resource not accessible by integration" }, 403);
      const branch = decodeURIComponent(branchRef[1] ?? "");
      if (!repo.branches.has(branch)) return json({ message: "Reference does not exist" }, 422);
      repo.branches.delete(branch);
      return new Response(null, { status: 204 });
    }

    if (rest === "/pulls" && request.method === "POST") {
      if (user.bot && user.permissions?.pull_requests !== "write") {
        return json({ message: "Resource not accessible by integration" }, 403);
      }
      const body = (await request.json()) as { title: string; head: string; base: string; body?: string };
      if (!repo.branches.has(body.head) || !repo.branches.has(body.base)) {
        return json({ message: "Validation Failed" }, 422);
      }
      if (repo.reviews.some((review) => review.branch === body.head && review.state === "open")) {
        return json({ message: "A pull request already exists" }, 422);
      }
      const review = repo.openReview(body.head, body.title, body.body ?? "", body.base);
      return json({ number: review.number, html_url: `https://github.com/${options.repo}/pull/${review.number}` }, 201);
    }
    if (rest === "/pulls" && request.method === "GET") {
      const head = url.searchParams.get("head")?.split(":")[1];
      const found = repo.reviews.filter((review) => review.state === "open" && (!head || review.branch === head));
      return json(
        found.map((review) => ({
          number: review.number,
          html_url: `https://github.com/${options.repo}/pull/${review.number}`,
        })),
      );
    }

    if (rest === "/pages" && request.method === "GET") {
      const site = pages.current;
      if (!site) return json({ message: "Not Found" }, 404);
      return json({
        html_url: site.cname ? `https://${site.cname}/` : site.html_url,
        cname: site.cname,
        https_enforced: site.https_enforced,
        https_certificate: site.cname ? { state: site.certificate ?? "new", domains: [site.cname] } : null,
      });
    }
    if (rest === "/pages" && request.method === "PUT") {
      const site = pages.current;
      if (!site) return json({ message: "Not Found" }, 404);
      if (user.pages === false) return json({ message: "Resource not accessible by personal access token" }, 403);
      const body = (await request.json()) as { cname?: string | null; https_enforced?: boolean };
      if (body.cname && options.takenDomains?.includes(body.cname)) {
        return json({ message: `The CNAME \`${body.cname}\` is already taken.` }, 422);
      }
      if (body.https_enforced && !["approved", "issued"].includes(site.certificate ?? "")) {
        return json({ message: "The certificate does not exist yet" }, 422);
      }
      if (body.cname !== undefined) {
        site.cname = body.cname;
        site.certificate = body.cname ? "new" : undefined;
        if (!body.cname) site.https_enforced = false;
      }
      if (body.https_enforced !== undefined) site.https_enforced = body.https_enforced;
      return new Response(null, { status: 204 });
    }

    if (rest === "") {
      return json({
        id: 1,
        full_name: options.repo,
        private: options.private === true,
        visibility: options.private === true ? "private" : "public",
        default_branch: repo.defaultBranch,
        permissions: { push: user.push !== false, admin: user.admin === true },
      });
    }

    const people = await handleCollaborators(request, rest, user);
    if (people) return people;

    const ref = rest.match(/^\/git\/ref\/heads\/(.+)$/);
    if (ref) {
      const sha = repo.branches.get(decodeURIComponent(ref[1] ?? ""));
      return sha ? json({ object: { sha, type: "commit" } }) : json({ message: "Not Found" }, 404);
    }

    const tree = rest.match(/^\/git\/trees\/([0-9a-f]{40})$/);
    if (tree) {
      const commitSha = tree[1] ?? "";
      if (!repo.commitAt(commitSha)) return json({ message: "Not Found" }, 404);
      const entries = [...repo.files(commitSha)].map(([file, content]) => ({
        path: file,
        type: "blob",
        sha: repo.blobSha(content),
        size: fakeFileBytes(content).length,
      }));
      return json({ sha: commitSha, tree: entries, truncated: false });
    }

    const blob = rest.match(/^\/git\/blobs\/([0-9a-f]{40})$/);
    if (blob) {
      const content = repo.blobs.get(blob[1] ?? "");
      if (content === undefined) return json({ message: "Not Found" }, 404);
      return request.headers.get("accept")?.includes("raw")
        ? new Response(fakeFileBytes(content))
        : json({ content: encodeBase64Bytes(fakeFileBytes(content)), encoding: "base64" });
    }

    if (rest === "/commits") {
      const ref = url.searchParams.get("sha") ?? repo.defaultBranch;
      const file = url.searchParams.get("path");
      if (!repo.commitAt(repo.branches.get(ref) ?? ref)) return json({ message: "No commit found for SHA" }, 422);
      const perPage = Number(url.searchParams.get("per_page") ?? 30);
      const page = Number(url.searchParams.get("page") ?? 1);
      const commits = file ? repo.history(file, ref) : [];
      return json(
        commits.slice((page - 1) * perPage, page * perPage).map((commit) => ({
          sha: commit.sha,
          commit: { message: commit.message, author: { name: commit.author ?? "GitHub", date: commit.date } },
          author: null,
        })),
      );
    }

    const workflowFile = rest.match(/^\/actions\/workflows\/([\w.-]+)\/(?:dispatches|runs)$/)?.[1];
    const workflowPath = `.github/workflows/${workflowFile}`;
    const ofWorkflow = (run: FakeRun) => (run.path ?? ".github/workflows/deploy.yml") === workflowPath;
    if (workflowFile && rest.endsWith("/dispatches") && request.method === "POST") {
      if (!(user.actionsWrite ?? user.administration)) {
        return json({ message: "Resource not accessible by personal access token" }, 403);
      }
      const body = (await request.json()) as { ref: string; inputs?: Record<string, string> };
      runs.push({
        id: runs.length + 1,
        sha: repo.head(body.ref),
        event: "workflow_dispatch",
        inputs: body.inputs,
        status: "queued",
        conclusion: null,
        path: workflowPath,
        jobs: [],
      });
      return new Response(null, { status: 204 });
    }

    if (workflowFile && rest.endsWith("/runs")) {
      if (user.actions === false) return json({ message: "Resource not accessible by personal access token" }, 403);
      const found = runs.filter(ofWorkflow);
      return json({
        total_count: found.length,
        workflow_runs: [...found].reverse().map((run) => ({
          id: run.id,
          event: run.event ?? "push",
          head_sha: run.sha,
          status: run.status,
          conclusion: run.conclusion,
          created_at: run.createdAt ?? "2026-01-05T04:17:00Z",
          html_url: `https://github.com/${options.repo}/actions/runs/${run.id}`,
        })),
      });
    }

    if (rest === "/actions/runs" || rest.startsWith("/actions/runs/")) {
      if (user.actions === false) return json({ message: "Resource not accessible by personal access token" }, 403);
      const htmlUrl = (run: FakeRun) => `https://github.com/${options.repo}/actions/runs/${run.id}`;
      if (rest === "/actions/runs") {
        const sha = url.searchParams.get("head_sha");
        const found = runs.filter((run) => !sha || run.sha === sha);
        return json({
          total_count: found.length,
          workflow_runs: found.map((run) => ({
            id: run.id,
            head_sha: run.sha,
            status: run.status,
            conclusion: run.conclusion,
            name: run.path ? "Rebuild on Vercel" : "Deploy to GitHub Pages",
            path: run.path ?? ".github/workflows/deploy.yml",
            html_url: htmlUrl(run),
          })),
        });
      }
      const jobs = rest.match(/^\/actions\/runs\/(\d+)\/jobs$/);
      const run = runs.find((candidate) => candidate.id === Number(jobs?.[1]));
      return run ? json({ total_count: run.jobs.length, jobs: run.jobs }) : json({ message: "Not Found" }, 404);
    }

    const compare = rest.match(/^\/compare\/(.+)\.\.\.(.+)$/);
    if (compare) {
      const [from, to] = [compare[1], compare[2]].map((ref) => decodeURIComponent(ref ?? ""));
      const resolve = (ref: string) => repo.branches.get(ref) ?? (repo.commitAt(ref) ? ref : undefined);
      const [a, b] = [resolve(from ?? ""), resolve(to ?? "")];
      if (!a || !b) return json({ message: "Not Found" }, 404);
      // Three dots: the changes on `to` since it and `from` last shared a commit.
      const base = repo.mergeBase(a, b) ?? a;
      return json({
        merge_base_commit: { sha: base },
        files: repo.changedPaths(base, b).map((filename) => ({ filename })),
      });
    }

    const commitSha = rest.match(/^\/commits\/([0-9a-f]{40})$/)?.[1];
    if (commitSha) {
      const found = repo.commitAt(commitSha);
      if (!found) return json({ message: "No commit found for SHA" }, 422);
      return json({ sha: commitSha, parents: found.parent ? [{ sha: found.parent }] : [] });
    }

    const checkRunsSha = rest.match(/^\/commits\/([0-9a-f]{40})\/check-runs$/)?.[1];
    if (checkRunsSha) {
      if (options.checkRunsForbidden) return json({ message: "Resource not accessible by personal access token" }, 403);
      const state = options.cloudflare?.report === "statuses" ? undefined : cloudflareState(checkRunsSha);
      const runsFound = state
        ? [
            {
              id: 1,
              name: "Cloudflare Pages",
              app: { slug: "cloudflare-workers-and-pages" },
              status: state === "building" ? "in_progress" : "completed",
              conclusion: state === "building" ? null : state,
              details_url: `https://dash.cloudflare.com/builds/${checkRunsSha}`,
              output: { title: state === "failure" ? "Build failed" : "Deployed" },
            },
          ]
        : [];
      return json({ total_count: runsFound.length, check_runs: runsFound });
    }

    const statusesSha = rest.match(/^\/commits\/([0-9a-f]{40})\/statuses$/)?.[1];
    if (statusesSha) {
      const state = options.cloudflare?.report === "statuses" ? cloudflareState(statusesSha) : undefined;
      return json(
        state
          ? [
              {
                context: "Cloudflare Pages",
                state: state === "building" ? "pending" : state,
                target_url: `https://dash.cloudflare.com/builds/${statusesSha}`,
                description: state === "failure" ? "Build failed" : "Deployed",
              },
            ]
          : [],
      );
    }

    if (rest === "/deployments") {
      const sha = url.searchParams.get("sha");
      const list = deployments.filter((deployment) => !sha || deployment.sha === sha);
      return json(list.slice(0, Number(url.searchParams.get("per_page") ?? 30)).map(({ id, sha }) => ({ id, sha })));
    }

    const statuses = rest.match(/^\/deployments\/(\d+)\/statuses$/);
    if (statuses) {
      const deployment = deployments.find((candidate) => candidate.id === Number(statuses[1]));
      if (!deployment) return json({ message: "Not Found" }, 404);
      deployment.checks += 1;
      if (deployment.checks > (options.deployAfterChecks ?? 0) && deployment.statuses[0]?.state === "in_progress") {
        deployment.statuses.unshift({
          state: "success",
          log_url: `https://github.com/${options.repo}/actions/runs/${deployment.id}`,
        });
      }
      return json(deployment.statuses);
    }

    return json({ message: "Not Found" }, 404);
  }

  return {
    repo,
    /** How many GraphQL requests read files, as `readFiles()` makes. */
    get graphqlReads() {
      return graphqlReads;
    },
    /** Tokens apps' sign-ins made, in order. */
    issued,
    /** Who commits made through the REST API name as their author, by commit. */
    commitAuthors,
    authorize,
    install,
    /** Repositories created through the API, or added with `addRepo()`, by `owner/name`. */
    created,
    addRepo,
    /** The site's GitHub Pages settings, which tests can change, such as to issue the certificate. */
    pages,
    /** The repository's collaborators, by login, and invitations waiting to be accepted. */
    collaborators,
    invitations,
    accept,
    deployments,
    /** Cloudflare Pages' builds, by commit, with `cloudflare`; `failCloudflare()` makes one fail. */
    cloudflareBuilds,
    failCloudflare,
    /** GitHub Actions workflow runs, which tests add with `failBuild()` and `cancelBuild()`. */
    runs,
    failBuild,
    cancelBuild,
    /** Every request received, for checking what the backend sent. */
    requests,
    /** Simulates someone else publishing. */
    commit,
    handle,
    /** A `fetch` that answers from the fake instead of the network. */
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => handle(new Request(input, init))) as typeof fetch,
  };
}

export type FakeGitHub = ReturnType<typeof fakeGitHub>;
