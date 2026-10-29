import {
  type BrokerConfirmKind,
  brokerChangeCheck,
  type FileChange,
  type GitBackend,
  INSTALLED_PLUGINS_FILE,
  type InstalledPlugin,
  limitsContent,
  limitsFor,
  outsideLimits,
  parseInstalledPlugins,
  readPermissions,
} from "@goodfellow-cms/core";

/** A plugin a publish installs or updates, as its new record says, for the broker's dialog. */
export interface PluginQuestion extends InstalledPlugin {
  name: string;
}

/** What the broker asks the editor before making a call the admin panel asked for. */
export type BrokerQuestion =
  | { kind: BrokerConfirmKind; paths: string[] }
  /** Installing, updating or removing plugins, whose code is included when the site builds. */
  | { kind: "plugins"; installed: PluginQuestion[]; removed: string[] }
  /** Installing another release of Goodfellow, which changes the site's packages. */
  | { kind: "update"; release: string }
  /** Giving someone access to the site, or more of it. */
  | { kind: "editors"; who: string; role?: string }
  /** Taking someone's access away. */
  | { kind: "editors-remove"; who: string }
  /** Connecting, securing or removing a domain on the site's host. */
  | { kind: "domain"; change: "connect" | "secure" | "disconnect"; domain: string }
  /** Running an installed plugin's task in the site's CI, with the secrets it declared. */
  | { kind: "task"; plugin: string; task: string }
  /** Turning on what the site's host needs for updates. */
  | { kind: "updates-setup" }
  /** Throwing away a draft, whoever made it. */
  | { kind: "discard-draft"; name: string };

/** What the broker does with a call: makes it, asks first, or refuses it. */
export type BrokerDecision =
  | { action: "allow" }
  | { action: "ask"; questions: BrokerQuestion[] }
  | { action: "refuse"; paths: string[]; reason: "workflow" | "limits" | "unknown" };

/** Calls that publish a set of changes, by their path in the backend. */
const WRITES = new Set(["write", "draft.store.write"]);

const READS = ["revision", "read", "readBytes", "list", "readFiles", "fileSizes", "changedPaths"];

/**
 * Calls the broker makes without asking: reads, and changes that publish
 * nothing, take nothing away and give no one more. Every other call is asked
 * about or refused, so a method added to what the broker offers later is
 * refused until it's listed here or given a question.
 */
const UNASKED = new Set([
  ...READS,
  "deployStatus",
  "history",
  "readAt",
  "repositoryVisibility",
  "signOut",
  "filesAt.read",
  "filesAt.readBytes",
  "filesAt.list",
  "pages.site",
  "pages.records",
  "pages.status",
  "editors.list",
  // The broker's own sign-in and dialog, never the admin panel's.
  "ownerAccess.forget",
  "ownerAccess.startRedirect",
  "ownerAccess.requestToken",
  "updates.lastRun",
  "updates.rebuild",
  "updates.code.read",
  "updates.code.history",
  "updates.code.readAt",
  "updates.nightly.supported",
  "updates.nightly.get",
  "updates.nightly.set",
  "drafts.create",
  "drafts.open",
  "drafts.list",
  "drafts.reviews",
  "draft.changes",
  "draft.paths",
  "draft.submitForReview",
  ...READS.map((read) => `draft.store.${read}`),
  "scheduledBuilds.timing",
  // Schedules follow what's published, whoever asks.
  "scheduledBuilds.sync",
  "tasks.supported",
  "tasks.secretsPlace",
]);

const DOMAIN_CHANGES: Record<string, "connect" | "secure" | "disconnect"> = {
  "pages.connect": "connect",
  "pages.secure": "secure",
  "pages.disconnect": "disconnect",
};

/**
 * What a publish does to the plugins installed from the admin panel, from
 * the record it writes and the one it replaces, read with `read`. Records
 * that can't be read are left to the question about the site's code.
 */
async function pluginQuestion(
  changes: readonly FileChange[],
  read: ((path: string) => Promise<string | undefined>) | undefined,
): Promise<BrokerQuestion | undefined> {
  const change = changes.find((candidate) => candidate.path === INSTALLED_PLUGINS_FILE);
  if (!change || !("content" in change)) return undefined;
  try {
    const next = parseInstalledPlugins(change.content).plugins;
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
  const questions: BrokerQuestion[] = [
    ...(plugins ? [plugins] : []),
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
    const changes = await (target as { changes(): Promise<FileChange[]> }).changes();
    return (await outsideTheirLimits(backend, changes)) ?? questionsFor(changes, siteUrl);
  }
  if (path === "updates.start") return { action: "ask", questions: [{ kind: "update", release: String(args[0]) }] };
  if (path === "editors.invite" || path === "editors.setRole") {
    return { action: "ask", questions: [{ kind: "editors", who: who(args[0]), role: String(args[1]) }] };
  }
  if (path === "editors.letEditorsPublish") return { action: "ask", questions: [{ kind: "editors", who: "" }] };
  if (path === "editors.remove") return { action: "ask", questions: [{ kind: "editors-remove", who: who(args[0]) }] };
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
  if (UNASKED.has(path)) return { action: "allow" };
  return { action: "refuse", paths: [path], reason: "unknown" };
}
