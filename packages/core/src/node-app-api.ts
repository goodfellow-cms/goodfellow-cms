import {
  APP_API_HEADER,
  type AppEditor,
  type AppSession,
  ConflictError,
  decodeBase64,
  encodeBase64Bytes,
  type FileChange,
  GitApiError,
  type GitBackend,
  INSTALLED_PLUGINS_DIR,
  isContentPath,
  isEditablePath,
  isSettingsPath,
  keepsStorageSettings,
  limitsContent,
  limitsFor,
  MEDIA_DIR,
  MEDIA_STORAGE_FILE,
  newDraftName,
  type OwnersOnlyFields,
  outsideLimits,
  ownersOnlyChanges,
  PluginTaskError,
  type PluginTaskRequest,
  pluginId,
  readPermissions,
  reviewersFor,
  type ServerGit,
  SignInError,
  taskRequestProblem,
} from "./index.js";
import type { PluginServer } from "./node-plugins.js";
import { unsafeMediaChanges } from "./svg-check.js";

export interface AppApiOptions {
  /** The site's repository, through a token of the site's own: `config.backend.server({ token })`. */
  git: ServerGit;
  /**
   * Who's signed in, from the site's own sign-in, such as its session cookie,
   * or `null` for nobody. `false` means signed in but not allowed to edit.
   * Asked on every request, so taking someone's role away takes effect at once.
   */
  authorize(request: Request): Promise<AppEditor | null | false> | AppEditor | null | false;
  /** Where the admin panel sends people to sign in, such as `/sign-in?next=/admin/`. */
  signIn: string;
  /** Where the admin panel's Sign out button goes, such as `/sign-out`. */
  signOut?: string;
  /** AI services whose requests go through the server, with its keys. */
  ai?: {
    services: string[];
    /** Sends an editor's request on to `service`, at `path` of its API. */
    forward(request: Request, service: string, path: string): Promise<Response>;
  };
  /** Told about failures the admin panel only hears about as "something went wrong". Defaults to `console.error`. */
  onError?: (error: unknown) => void;
  /**
   * Plugins' server modules, by plugin name, such as
   * `{ "goodfellow-plugin-s3": s3Server }`, which answer requests to
   * `plugins/<id>/…`, from anyone, as webhooks need. Each is told who's signed
   * in only for requests from the site's own pages.
   */
  plugins?: Record<string, PluginServer>;
  /**
   * What happens to owners' changes to the site's code (installed blocks,
   * `components/`, `lib/` and `hooks/`), which this server runs with its token
   * and keys: `"review"`, the default, submits them for a developer to review,
   * as plugins are; `"publish"` lets owners publish them.
   */
  codeChanges?: "review" | "publish";
  /**
   * Block settings only owners may change (`ownersOnlyFields(config.blocks)`),
   * such as Custom HTML used exactly as written, which editors' saves may then
   * not change.
   */
  ownersOnly?: OwnersOnlyFields;
}

/** Room for a save with uploads, which are sent as base64 (a third larger than the files). */
const MAX_BODY_BYTES = 80 * 1024 * 1024;

/** How many revisions' backends are kept for reads, each with what it has read. */
const KEPT_REVISIONS = 8;

class BadRequest extends Error {}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

/** Whether a request can only have come from a page of the site itself. */
function isTrusted(request: Request): boolean {
  if (request.headers.get(APP_API_HEADER) !== "1") return false;
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin === null || origin === new URL(request.url).origin;
}

function editablePath(value: unknown): string {
  if (typeof value !== "string" || !isEditablePath(value)) throw new BadRequest("That file can't be read here.");
  return value;
}

/** A folder the admin panel may list: one of the editable folders, or a folder inside one. */
function editableDir(value: unknown): string {
  if (typeof value !== "string" || !isEditablePath(`${value.replace(/\/+$/, "")}/x`)) {
    throw new BadRequest("That folder can't be listed here.");
  }
  return value.replace(/\/+$/, "");
}

function revisionParam(value: unknown): string {
  if (typeof value !== "string" || !/^[0-9a-f]{7,64}$/i.test(value)) throw new BadRequest("That isn't a revision.");
  return value;
}

/**
 * The files installing a plugin changes, which only go to a developer for
 * review on a full-stack site, since its builds and server hold its secrets.
 */
export function isPluginInstallPath(path: string): boolean {
  return path === "package.json" || path === "goodfellow.config.tsx" || isInstalledPluginsPath(path);
}

function isInstalledPluginsPath(path: string): boolean {
  return isEditablePath(path) && path.startsWith(`${INSTALLED_PLUGINS_DIR}/`);
}

/** The site's code among the editable folders, which runs on a full-stack site's server: installed blocks and what they share. */
function isCodePath(path: string): boolean {
  return isEditablePath(path) && !isContentPath(path) && !isInstalledPluginsPath(path);
}

function reviewPath(value: unknown): string {
  if (typeof value !== "string" || !isPluginInstallPath(value))
    throw new BadRequest("That file can't be changed here.");
  return value;
}

/** The files of `changes` outside what `login` may change, or none where they have no limits. */
async function outsideLimitsAt(backend: GitBackend, login: string, changes: FileChange[]): Promise<string[]> {
  const limits = limitsFor(await readPermissions(backend), login);
  if (!limits) return [];
  return outsideLimits(await limitsContent(backend, changes), limits, changes).map((problem) => problem.path);
}

/** A change as sent over JSON, where an upload's bytes are base64. */
function toFileChange(value: unknown, pathOf: (value: unknown) => string = editablePath): FileChange {
  if (typeof value !== "object" || value === null) throw new BadRequest("That isn't a change.");
  const change = value as Record<string, unknown>;
  const path = pathOf(change.path);
  if (change.delete === true) return { path, delete: true };
  if (typeof change.content === "string") return { path, content: change.content };
  if (typeof change.base64 === "string") {
    const bytes = decodeBase64(change.base64);
    // Content files are text, read as text by every check here, so they're never let through as bytes unread.
    if (!isTextContentPath(path)) return { path, bytes };
    try {
      return { path, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
    } catch {
      throw new BadRequest("That isn't a content file.");
    }
  }
  throw new BadRequest("That isn't a change.");
}

/** Files the site's content is read from as text: content's JSON and Markdown, and the site's code. */
function isTextContentPath(path: string): boolean {
  return !path.startsWith(`${MEDIA_DIR}/`) && /\.(json|md|tsx?|jsx?|css|html)$/i.test(path);
}

/**
 * What a change can't do, wherever it comes from, before it's written: media
 * that isn't safe on the site's address, and, for someone who isn't an owner,
 * a different plugin or address for the media storage (they may add and
 * remove its files, as uploading does). An answer to send, or nothing.
 */
async function refusedChanges(
  changes: readonly FileChange[],
  editor: AppEditor,
  read: (path: string) => Promise<string | undefined>,
): Promise<Response | undefined> {
  const unsafe = unsafeMediaChanges(changes);
  if (unsafe.length > 0) return json(400, { error: "unsafe-media", paths: unsafe });
  if (editor.role !== "owner") {
    const storage = changes.find((change) => change.path === MEDIA_STORAGE_FILE);
    if (storage && !(await keepsStorageSettings(await read(MEDIA_STORAGE_FILE), storage))) {
      return json(403, { error: "owners-only", paths: [MEDIA_STORAGE_FILE] });
    }
  }
  return undefined;
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new BadRequest("Send JSON.");
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) throw new BadRequest("That's too large.");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new BadRequest("That's too large.");
  try {
    const body = JSON.parse(text) as unknown;
    if (typeof body !== "object" || body === null) throw new BadRequest("Send an object.");
    return body as Record<string, unknown>;
  } catch {
    throw new BadRequest("That isn't JSON.");
  }
}

/**
 * The admin panel's API on a full-stack site's server: the browser reads and
 * publishes through it, the server reaches the repository with a token of the
 * site's own, and the site's own sign-in says who may do what. Mount it at an
 * address such as `/api/goodfellow/`, passing the part after that as `endpoint`.
 */
export function appApi(options: AppApiOptions): (request: Request, endpoint: string) => Promise<Response> {
  const kept = new Map<string, Promise<GitBackend>>();
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const codeReview = options.codeChanges !== "publish" && !options.git.contentOnly;

  /** A backend reading `revision`, kept for the next request, since a browser loading the site asks for many files. */
  function reader(revision: string): Promise<GitBackend> {
    let backend = kept.get(revision);
    if (backend) {
      // Most recently used last.
      kept.delete(revision);
    } else {
      backend = options.git.at(revision);
      backend.catch(() => kept.delete(revision));
    }
    kept.set(revision, backend);
    while (kept.size > KEPT_REVISIONS) kept.delete(kept.keys().next().value as string);
    return backend;
  }

  function session(editor: AppEditor | null | false): Response {
    const signOut = options.signOut && { signOut: options.signOut };
    if (!editor) {
      return json(200, {
        signedIn: false,
        signIn: options.signIn,
        ...(editor === false && { notAllowed: true }),
        ...signOut,
      } satisfies AppSession);
    }
    return json(200, {
      signedIn: true,
      user: { login: editor.login, name: editor.name, ...(editor.avatarUrl && { avatarUrl: editor.avatarUrl }) },
      role: editor.role,
      ai: options.ai?.services ?? [],
      ...(options.git.contentOnly && { contentOnly: true }),
      ...(codeReview && { codeReview: true }),
      ...signOut,
    } satisfies AppSession);
  }

  async function answer(request: Request, endpoint: string, editor: AppEditor): Promise<Response> {
    const url = new URL(request.url);
    const query = (name: string) => url.searchParams.get(name) ?? undefined;
    const get = request.method === "GET";
    const post = request.method === "POST";

    if (endpoint.startsWith("ai/") && options.ai) {
      const [, service = "", ...rest] = endpoint.split("/");
      if (!options.ai.services.includes(service)) return json(404, { error: "not-found" });
      return options.ai.forward(request, service, rest.join("/"));
    }
    if (get && endpoint === "revision") return json(200, { revision: await options.git.revision() });
    if (get && endpoint === "file") {
      const backend = await reader(revisionParam(query("revision")));
      const path = editablePath(query("path"));
      if (query("as") === "bytes") {
        const bytes = await backend.readBytes(path);
        return bytes === undefined
          ? json(404, { error: "not-found" })
          : json(200, { base64: encodeBase64Bytes(bytes) });
      }
      const content = await backend.read(path);
      return content === undefined ? json(404, { error: "not-found" }) : json(200, { content });
    }
    if (get && endpoint === "files") {
      const backend = await reader(revisionParam(query("revision")));
      return json(200, { files: await backend.list(editableDir(query("dir"))) });
    }
    if (post && endpoint === "files") {
      const body = await readBody(request);
      if (!Array.isArray(body.paths)) throw new BadRequest("Say which files.");
      const paths = body.paths.map(editablePath);
      const backend = await reader(revisionParam(body.revision));
      const files = backend.readFiles
        ? await backend.readFiles(paths)
        : new Map(
            (await Promise.all(paths.map(async (path) => [path, await backend.read(path)] as const))).filter(
              (entry): entry is readonly [string, string] => entry[1] !== undefined,
            ),
          );
      return json(200, { files: Object.fromEntries(files) });
    }
    if (post && endpoint === "write") {
      const body = await readBody(request);
      const { message } = body;
      const expectedRevision = revisionParam(body.expectedRevision);
      if (!Array.isArray(body.changes) || typeof message !== "string") throw new BadRequest("That isn't a save.");
      const changes = body.changes.map((change) => toFileChange(change));
      // Checked here, whatever the admin panel shows: the browser can't be trusted to leave settings alone.
      if (editor.role !== "owner" && changes.some((change) => isSettingsPath(change.path))) {
        return json(403, { error: "owners-only" });
      }
      // A repository of content only never gets code, such as an installed block's.
      if (options.git.contentOnly && changes.some((change) => !isContentPath(change.path))) {
        throw new BadRequest("The site's code is kept in a repository of its own.");
      }
      // Plugins are only ever added through a review, below.
      if (changes.some((change) => isInstalledPluginsPath(change.path))) return json(403, { error: "review-only" });
      // So is the code this server runs, unless the site lets owners publish it.
      if (codeReview && changes.some((change) => isCodePath(change.path))) return json(403, { error: "review-only" });
      const backend = await options.git.at(expectedRevision, { name: editor.name, email: editor.email });
      const refused = await refusedChanges(changes, editor, (path) => backend.read(path));
      if (refused) return refused;
      // Block settings only owners may change, such as Custom HTML used exactly as written.
      if (editor.role !== "owner" && options.ownersOnly) {
        const changed = await ownersOnlyChanges(changes, options.ownersOnly, (path) => backend.read(path));
        if (changed.length > 0) return json(403, { error: "owners-only", paths: changed });
      }
      // An owner's limits for this person, held here too, since the browser can't be trusted to keep to them.
      const outside = await outsideLimitsAt(backend, editor.login, changes);
      if (outside.length > 0) return json(403, { error: "outside-limits", paths: outside });
      return json(200, await backend.write(changes, { message, expectedRevision }));
    }
    if (post && endpoint === "review") {
      // A draft with the changes, submitted for review: installing, updating or removing a plugin, or changing the
      // site's code, for a developer to accept, or changes outside someone's limits, for the site's reviewers.
      const body = await readBody(request);
      const { title, description } = body;
      const from = revisionParam(body.from);
      if (!Array.isArray(body.changes) || body.changes.length === 0 || typeof title !== "string" || !title.trim()) {
        throw new BadRequest("That isn't a change to review.");
      }
      const plugins = body.changes.some((change) => {
        const path = (change as { path?: unknown } | null)?.path;
        return typeof path === "string" && (!isEditablePath(path) || isInstalledPluginsPath(path));
      });
      if (plugins && editor.role !== "owner") return json(403, { error: "owners-only" });
      const changes = body.changes.map((change) => toFileChange(change, plugins ? reviewPath : editablePath));
      if (options.git.contentOnly && changes.some((change) => !isContentPath(change.path))) {
        throw new BadRequest("The site's code is kept in a repository of its own.");
      }
      // Settings are owners' whether they're published or submitted for review.
      if (editor.role !== "owner" && changes.some((change) => isSettingsPath(change.path))) {
        return json(403, { error: "owners-only" });
      }
      const backend = await options.git.at(from, { name: editor.name, email: editor.email });
      if (!backend.drafts) throw new BadRequest("This site's repository can't take changes for review.");
      const code = changes.some((change) => isCodePath(change.path));
      if (code && editor.role !== "owner") return json(403, { error: "owners-only" });
      const refused = await refusedChanges(changes, editor, (path) => backend.read(path));
      if (refused) return refused;
      if (editor.role !== "owner" && options.ownersOnly) {
        const changed = await ownersOnlyChanges(changes, options.ownersOnly, (path) => backend.read(path));
        if (changed.length > 0) return json(403, { error: "owners-only", paths: changed });
      }
      const reviewers = plugins || code ? [] : reviewersFor(await readPermissions(backend), []);
      const draft = await backend.drafts.create(newDraftName(), { from });
      await draft.store.write(changes, { message: title, expectedRevision: await draft.store.revision() });
      return json(
        200,
        await draft.submitForReview({
          title,
          ...(typeof description === "string" && description && { description }),
          ...(reviewers.length > 0 && { reviewers }),
        }),
      );
    }
    if (get && endpoint === "task") {
      const backend = await reader(await options.git.revision());
      // Secrets can be the server's own, for plugins' server modules, or its CI's, for their tasks.
      const ci = await backend.tasks?.secretsPlace().catch(() => undefined);
      return json(200, {
        supported: (await backend.tasks?.supported()) === true,
        place: { kind: "server", ...(ci && { ci }) },
      });
    }
    if (post && endpoint === "task") {
      // A plugin's task, run in the site's CI with its secrets, as on a static site: its answer is sealed to the
      // browser's key, so this server only passes it on.
      const body = (await readBody(request)) as unknown as PluginTaskRequest;
      const problem = taskRequestProblem(body);
      if (problem) throw new BadRequest(problem);
      const backend = await options.git.at(await options.git.revision(), { name: editor.name, email: editor.email });
      if (!backend.tasks) return json(404, { error: "not-found" });
      try {
        const { id, plugin, task, input, key } = body;
        return json(200, { result: await backend.tasks.run({ id, plugin, task, input, key }) });
      } catch (error) {
        if (error instanceof PluginTaskError) return json(502, { error: "task", problem: error.problem });
        throw error;
      }
    }
    if (get && endpoint === "changed") {
      const backend = await reader(revisionParam(query("to")));
      return json(200, { paths: await backend.changedPaths(revisionParam(query("from")), revisionParam(query("to"))) });
    }
    if (get && endpoint === "deploy") {
      const revision = revisionParam(query("revision"));
      return json(200, await (await reader(revision)).deployStatus(revision));
    }
    if (get && endpoint === "history") {
      const backend = await reader(revisionParam(query("revision")));
      const page = Number(query("page") ?? 1);
      const perPage = Number(query("perPage") ?? 20);
      if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || perPage > 100) {
        throw new BadRequest("That isn't a page of versions.");
      }
      // A file's versions, or a folder's, such as `content` for the whole site's.
      const path = query("path");
      const subject = typeof path === "string" && isEditablePath(path) ? path : editableDir(path);
      return json(200, { versions: await backend.history(subject, { page, perPage }) });
    }
    if (get && endpoint === "version") {
      const revision = revisionParam(query("revision"));
      // Owners may read the files a plugin's install changes, to plan one for review.
      const asked = query("path");
      const path = editor.role === "owner" && asked && isPluginInstallPath(asked) ? asked : editablePath(asked);
      const content = await (await reader(revision)).readAt(path, revision);
      return content === undefined ? json(404, { error: "not-found" }) : json(200, { content });
    }
    return json(404, { error: "not-found" });
  }

  /** A plugin's server module, for a request to `plugins/<id>/<path>`. */
  async function plugin(request: Request, name: string): Promise<Response> {
    const [, id = "", ...rest] = name.split("/");
    const entry = Object.entries(options.plugins ?? {}).find(([plugin]) => pluginId(plugin) === id);
    if (!entry) return json(404, { error: "not-found" });
    try {
      // Only a request from the site's own pages can be an editor's: anyone can send the rest.
      const editor = isTrusted(request) ? await options.authorize(request) : null;
      return await entry[1](request, {
        path: rest.join("/"),
        editor: editor ? { login: editor.login, name: editor.name, email: editor.email, role: editor.role } : null,
      });
    } catch (error) {
      onError(error);
      return json(500, { error: "server-error" });
    }
  }

  return async (request, endpoint) => {
    // Without a trailing slash: Next.js sites with `trailingSlash` call `revision/`.
    const name = endpoint.replace(/^\/+|\/+$/g, "");
    if (name.startsWith("plugins/")) return plugin(request, name);
    if (!isTrusted(request)) return json(403, { error: "forbidden" });
    try {
      const editor = await options.authorize(request);
      if (name === "session" && request.method === "GET") return session(editor);
      if (!editor) return json(401, { error: editor === false ? "not-allowed" : "signed-out" });
      return await answer(request, name, editor);
    } catch (error) {
      if (error instanceof BadRequest) return json(400, { error: "bad-request", message: error.message });
      if (error instanceof ConflictError) return json(409, { error: "conflict" });
      onError(error);
      // The repository's answers stay on the server: they're about its token, not the editor's sign-in.
      if (error instanceof SignInError) return json(502, { error: "git-sign-in", problem: error.problem });
      if (error instanceof GitApiError) return json(502, { error: "git", status: error.status });
      return json(500, { error: "server-error" });
    }
  };
}
