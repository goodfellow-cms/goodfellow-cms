import {
  type BrokerConfirmKind,
  brokerChangeCheck,
  type EditorList,
  type FileChange,
  type GitBackend,
  INSTALLED_PLUGINS_FILE,
  type InstalledPlugin,
  isCommitId,
  isPlainPath,
  limitsContent,
  limitsFor,
  normalizeDomain,
  outsideLimits,
  parseInstalledPlugins,
  readPermissions,
  type SiteEditor,
  THEME_FILE,
  themeRecordSchema,
} from "@goodfellow-cms/core";

/** A plugin a publish installs or updates, as its new record says, for the broker's dialog. */
export interface PluginQuestion extends InstalledPlugin {
  name: string;
}

/** What the broker asks the editor before making a call the admin panel asked for. */
export type BrokerQuestion =
  | { kind: BrokerConfirmKind; paths: string[] }
  /** Installing, updating, or removing plugins, whose code is included when the site builds. */
  | { kind: "plugins"; installed: PluginQuestion[]; removed: string[] }
  /** Installing another release of Goodfellow, which changes the site's packages. */
  | { kind: "update"; release: string }
  /** Giving someone access to the site, or more of it. */
  | { kind: "editors"; who: string; role?: string }
  /** Taking someone's access away. */
  | { kind: "editors-remove"; who: string }
  /** Connecting, securing, or removing a domain on the site's host. */
  | { kind: "domain"; change: "connect" | "secure" | "disconnect"; domain: string }
  /** Running an installed plugin's task in the site's CI, with the secrets it declared. */
  | { kind: "task"; plugin: string; task: string }
  /** Turning on what the site's host needs for updates. */
  | { kind: "updates-setup" }
  /** Throwing away a draft, whoever made it. */
  | { kind: "discard-draft"; name: string }
  /** Making a public repository for visitors' comments. */
  | { kind: "comments-create"; name: string }
  /** Deleting a visitor's comment, which can't be undone. */
  | { kind: "comments-delete" }
  /** Updating the theme before its release is three days old, which its provenance is to allow. */
  | { kind: "theme-early"; name: string; release: string; from: string; repository: string; workflow: string };

/** What the broker does with a call: makes it, asks first, or refuses it. */
export type BrokerDecision =
  | { action: "allow" }
  /** `args`, where given, are what the call is made with in place of the admin panel's. */
  | { action: "ask"; questions: BrokerQuestion[]; args?: unknown[] }
  | { action: "refuse"; paths: string[]; reason: "workflow" | "limits" | "unknown" | "editor" | "read" };

/** Calls that publish a set of changes, by their path in the backend. */
const WRITES = new Set(["write", "draft.store.write"]);

/**
 * What a call the broker makes unasked takes, by position. Backends put many
 * of these in the host's addresses, so each is checked as changes' paths are
 * (`brokerChangeCheck()`): a path with a `..` part, or a revision, domain or
 * repository that isn't one, could reach another of the host's addresses with
 * the editor's token. `value` is what goes only in a request's body or query,
 * or that the backend checks itself, such as a draft's name.
 */
type ArgKind = "path" | "paths" | "revision" | "draft-from" | "domain" | "repository" | "value";

/** The reads, which a draft's store answers too. */
const READS: Record<string, readonly ArgKind[]> = {
  revision: [],
  read: ["path"],
  readBytes: ["path"],
  list: ["path"],
  readFiles: ["paths"],
  fileSizes: ["path"],
  changedPaths: ["revision", "revision"],
};

/**
 * Calls the broker makes without asking, with what each takes: reads, and
 * changes that publish nothing, take nothing away, and give no one more. Every
 * other call is asked about or refused, so a method added to what the broker
 * offers later is refused until it's listed here or given a question.
 */
const UNASKED: Record<string, readonly ArgKind[]> = {
  ...READS,
  deployStatus: ["revision"],
  history: ["path", "value"],
  readAt: ["path", "revision"],
  repositoryVisibility: [],
  signOut: [],
  "filesAt.read": ["revision", "path"],
  "filesAt.readBytes": ["revision", "path"],
  "filesAt.list": ["revision", "path"],
  "pages.site": [],
  "pages.records": ["domain", "value"],
  "pages.status": ["domain"],
  "editors.list": [],
  // The broker's own sign-in and dialog, never the admin panel's.
  "ownerAccess.forget": [],
  "ownerAccess.startRedirect": ["value"],
  "ownerAccess.requestToken": [],
  "updates.lastRun": [],
  "updates.rebuild": [],
  "updates.code.read": ["path"],
  "updates.code.history": ["path", "value"],
  "updates.code.readAt": ["path", "revision"],
  "updates.nightly.supported": [],
  "updates.nightly.get": [],
  "updates.nightly.set": ["value"],
  // A draft's name is checked by `branchDrafts()` itself.
  "drafts.create": ["value", "draft-from"],
  "drafts.open": ["value"],
  "drafts.list": [],
  "drafts.reviews": [],
  "draft.changes": [],
  "draft.paths": [],
  "draft.submitForReview": ["value"],
  ...Object.fromEntries(Object.entries(READS).map(([name, kinds]) => [`draft.store.${name}`, kinds])),
  "scheduledBuilds.timing": [],
  // Schedules follow what's published, whoever asks.
  "scheduledBuilds.sync": ["value"],
  "tasks.supported": [],
  "tasks.secretsPlace": [],
  // Comments: finding their repository, reading them, and moderating in ways that can be undone, by GraphQL's ids.
  "comments.find": ["repository"],
  "comments.threads": ["value", "value"],
  "comments.hide": ["value", "value"],
  "comments.show": ["value"],
  "comments.lock": ["value"],
  "comments.unlock": ["value"],
  "comments.access.forget": [],
  "comments.access.requestToken": [],
};

/** A repository's `owner/name`, with no part a host's address would read as leaving the folder. */
function isRepository(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const parts = value.split("/");
  return parts.length === 2 && parts.every((part) => /^[\w.-]+$/.test(part) && part !== "." && part !== "..");
}

/** Whether an unasked call's arguments are what its backend may put in an address. */
function argsFit(kinds: readonly ArgKind[], args: unknown[]): boolean {
  return kinds.every((kind, index) => {
    const value = args[index];
    switch (kind) {
      case "path":
        return isPlainPath(value);
      case "paths":
        return Array.isArray(value) && value.every(isPlainPath);
      case "revision":
        return isCommitId(value);
      case "draft-from": {
        const from = (value as { from?: unknown } | undefined)?.from;
        return from === undefined || isCommitId(from);
      }
      case "domain":
        return typeof value === "string" && normalizeDomain(value) === value;
      case "repository":
        return isRepository(value);
      default:
        // `value`: only a body or query holds it.
        return true;
    }
  });
}

const DOMAIN_CHANGES: Record<string, "connect" | "secure" | "disconnect"> = {
  "pages.connect": "connect",
  "pages.secure": "secure",
  "pages.disconnect": "disconnect",
};

/** A change's text, written as text or as bytes, which every backend publishes alike. */
function changeText(change: FileChange | undefined): string | undefined {
  if (!change) return undefined;
  if ("content" in change) return change.content;
  return "bytes" in change ? new TextDecoder("utf-8", { fatal: false }).decode(change.bytes) : undefined;
}

/**
 * What a publish does to the plugins installed from the admin panel, from
 * the record it writes and the one it replaces, read with `read`. Records
 * that can't be read are left to the question about the site's code.
 */
async function pluginQuestion(
  changes: readonly FileChange[],
  read: ((path: string) => Promise<string | undefined>) | undefined,
): Promise<BrokerQuestion | undefined> {
  const content = changeText(changes.find((candidate) => candidate.path === INSTALLED_PLUGINS_FILE));
  if (content === undefined) return undefined;
  try {
    const next = parseInstalledPlugins(content).plugins;
    const before = parseInstalledPlugins(await read?.(INSTALLED_PLUGINS_FILE)).plugins;
    const installed = Object.entries(next)
      .filter(([name, plugin]) => JSON.stringify(before[name]) !== JSON.stringify(plugin))
      .map(([name, plugin]) => ({ name, ...plugin }));
    const removed = Object.keys(before).filter((name) => !next[name]);
    return installed.length + removed.length > 0 ? { kind: "plugins", installed, removed } : undefined;
  } catch {
    return undefined;
  }
}

/** The theme a set of changes installs early, if it does, which the broker asks about since it skips the wait. */
function themeEarlyQuestion(changes: readonly FileChange[]): BrokerQuestion | undefined {
  const content = changeText(changes.find((candidate) => candidate.path === THEME_FILE));
  if (content === undefined) return undefined;
  try {
    const record = themeRecordSchema.safeParse(JSON.parse(content));
    const early = record.success ? record.data.early : undefined;
    return record.success && early
      ? { kind: "theme-early", name: record.data.name, release: record.data.release, ...early }
      : undefined;
  } catch {
    return undefined;
  }
}

async function questionsFor(
  changes: readonly FileChange[],
  siteUrl: string | undefined,
  read?: (path: string) => Promise<string | undefined>,
): Promise<BrokerDecision> {
  const check = brokerChangeCheck(changes, siteUrl);
  if (check.refused.length > 0) return { action: "refuse", paths: check.refused, reason: "workflow" };
  const kinds = new Map<BrokerConfirmKind, string[]>();
  for (const { path, kind } of check.confirm) kinds.set(kind, [...(kinds.get(kind) ?? []), path]);
  const plugins = await pluginQuestion(changes, read);
  const theme = themeEarlyQuestion(changes);
  const questions: BrokerQuestion[] = [
    ...(plugins ? [plugins] : []),
    ...(theme ? [theme] : []),
    ...[...kinds].map(([kind, paths]) => ({ kind, paths })),
  ];
  return questions.length > 0 ? { action: "ask", questions } : { action: "allow" };
}

/**
 * Changes outside what an owner lets the signed-in person change
 * (`content/permissions.json`), refused here as the admin panel would: a page
 * of the site that reached the admin panel still can't publish them. Changes
 * kept in a draft aren't live, so only publishing is checked.
 */
async function outsideTheirLimits(
  backend: GitBackend | undefined,
  changes: readonly FileChange[],
): Promise<BrokerDecision | undefined> {
  if (!backend) return undefined;
  const limits = limitsFor(await readPermissions(backend), backend.user.login);
  if (!limits) return undefined;
  const outside = outsideLimits(await limitsContent(backend, changes), limits, changes);
  return outside.length > 0
    ? { action: "refuse", paths: outside.map((problem) => problem.path), reason: "limits" }
    : undefined;
}

/** The target's `read`, where it has one: the backend, or a draft's store, as it is before the write. */
function readerOf(target: unknown): ((path: string) => Promise<string | undefined>) | undefined {
  const read = (target as { read?: unknown } | null)?.read;
  return typeof read === "function" ? (path) => read.call(target, path) : undefined;
}

function who(editor: unknown): string {
  if (typeof editor === "string") return editor;
  const { login, email } = (editor ?? {}) as { login?: unknown; email?: unknown };
  return typeof login === "string" ? login : typeof email === "string" ? email : "";
}

/** The editor the site's list gives the id the admin panel named, from `editors.list()`, or `undefined`. */
async function listedEditor(target: unknown, editor: unknown): Promise<SiteEditor | undefined> {
  const id = (editor as { id?: unknown } | null)?.id;
  const list = (target as { list?: unknown } | null)?.list;
  if (typeof id !== "string" || typeof list !== "function") return undefined;
  // A list that can't be read, or isn't one, names nobody, which the broker refuses.
  const found = (await Promise.resolve(list.call(target)).catch(() => undefined)) as Partial<EditorList> | undefined;
  const editors = Array.isArray(found?.editors) ? found.editors : [];
  return editors.find((listed) => listed?.id === id);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Decides what the broker does with a call the admin panel asked for, by its
 * path in the backend (`serveBackend()`'s `check`). `changes` gives a draft's
 * changes, for `draft.publish`, which publishes them all at once; `backend`,
 * the signed-in person's, reads their limits.
 */
export async function decide(
  call: { path: string; args: unknown[]; target: unknown },
  siteUrl: string | undefined,
  backend?: GitBackend,
): Promise<BrokerDecision> {
  const { path, args, target } = call;
  if (WRITES.has(path)) {
    const changes = (args[0] ?? []) as FileChange[];
    if (path === "write") {
      const refused = await outsideTheirLimits(backend, changes);
      if (refused) return refused;
    }
    return questionsFor(changes, siteUrl, readerOf(target));
  }
  if (path === "draft.publish") {
    // The changes the admin panel asked to publish, where it gave them (`serveBackend()` has made them again), or the draft's.
    const given = (args[1] as { changes?: FileChange[] } | undefined)?.changes;
    const changes = given ?? (await (target as { changes(): Promise<FileChange[]> }).changes());
    return (await outsideTheirLimits(backend, changes)) ?? questionsFor(changes, siteUrl);
  }
  if (path === "updates.start") return { action: "ask", questions: [{ kind: "update", release: String(args[0]) }] };
  if (path === "editors.invite") {
    return { action: "ask", questions: [{ kind: "editors", who: who(args[0]), role: String(args[1]) }] };
  }
  if (path === "editors.setRole" || path === "editors.remove") {
    // The backend acts on the editor's id alone, so the question names the person the site's own list gives that id,
    // and the call is handed that listed editor, never what the admin panel said about them.
    const listed = await listedEditor(target, args[0]);
    if (!listed) return { action: "refuse", paths: [path], reason: "editor" };
    const made = [listed, ...args.slice(1)];
    return path === "editors.remove"
      ? { action: "ask", questions: [{ kind: "editors-remove", who: who(listed) }], args: made }
      : { action: "ask", questions: [{ kind: "editors", who: who(listed), role: String(args[1]) }], args: made };
  }
  if (path === "editors.letEditorsPublish") return { action: "ask", questions: [{ kind: "editors", who: "" }] };
  const change = DOMAIN_CHANGES[path];
  if (change) return { action: "ask", questions: [{ kind: "domain", change, domain: text(args[0]) }] };
  if (path === "tasks.run") {
    const request = (args[0] ?? {}) as { plugin?: unknown; task?: unknown };
    return { action: "ask", questions: [{ kind: "task", plugin: text(request.plugin), task: text(request.task) }] };
  }
  if (path === "updates.setup" || path === "updates.enable") {
    return { action: "ask", questions: [{ kind: "updates-setup" }] };
  }
  if (path === "draft.discard") {
    const name = (target as { name?: unknown } | null)?.name;
    return { action: "ask", questions: [{ kind: "discard-draft", name: text(name) }] };
  }
  if (path === "comments.create")
    return { action: "ask", questions: [{ kind: "comments-create", name: text(args[0]) }] };
  if (path === "comments.remove") return { action: "ask", questions: [{ kind: "comments-delete" }] };
  const kinds = Object.hasOwn(UNASKED, path) ? UNASKED[path] : undefined;
  if (kinds) return argsFit(kinds, args) ? { action: "allow" } : { action: "refuse", paths: [path], reason: "read" };
  return { action: "refuse", paths: [path], reason: "unknown" };
}
