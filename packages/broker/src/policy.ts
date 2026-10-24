import { type BrokerConfirmKind, brokerChangeCheck, type FileChange } from "@goodfellow-cms/core";

/** What the broker asks the editor before making a call the admin panel asked for. */
export type BrokerQuestion =
  | { kind: BrokerConfirmKind; paths: string[] }
  /** Installing another release of Goodfellow, which changes the site's packages. */
  | { kind: "update"; release: string }
  /** Giving someone access to the site, or more of it. */
  | { kind: "editors"; who: string; role?: string };

/** What the broker does with a call: makes it, asks first, or refuses it. */
export type BrokerDecision =
  | { action: "allow" }
  | { action: "ask"; questions: BrokerQuestion[] }
  | { action: "refuse"; paths: string[] };

/** Calls that publish a set of changes, by their path in the backend. */
const WRITES = new Set(["write", "draft.store.write"]);

function questionsFor(changes: readonly FileChange[], siteUrl: string | undefined): BrokerDecision {
  const check = brokerChangeCheck(changes, siteUrl);
  if (check.refused.length > 0) return { action: "refuse", paths: check.refused };
  const kinds = new Map<BrokerConfirmKind, string[]>();
  for (const { path, kind } of check.confirm) kinds.set(kind, [...(kinds.get(kind) ?? []), path]);
  const questions = [...kinds].map(([kind, paths]) => ({ kind, paths }));
  return questions.length > 0 ? { action: "ask", questions } : { action: "allow" };
}

function who(editor: unknown): string {
  if (typeof editor === "string") return editor;
  const login = (editor as { login?: unknown } | null)?.login;
  return typeof login === "string" ? login : "";
}

/**
 * Decides what the broker does with a call the admin panel asked for, by its
 * path in the backend (`serveBackend()`'s `check`). `changes` gives a draft's
 * changes, for `draft.publish`, which publishes them all at once.
 */
export async function decide(
  call: { path: string; args: unknown[]; target: unknown },
  siteUrl: string | undefined,
): Promise<BrokerDecision> {
  const { path, args, target } = call;
  if (WRITES.has(path)) return questionsFor((args[0] ?? []) as FileChange[], siteUrl);
  if (path === "draft.publish") {
    const changes = await (target as { changes(): Promise<FileChange[]> }).changes();
    return questionsFor(changes, siteUrl);
  }
  if (path === "updates.start") return { action: "ask", questions: [{ kind: "update", release: String(args[0]) }] };
  if (path === "editors.invite" || path === "editors.setRole") {
    return { action: "ask", questions: [{ kind: "editors", who: who(args[0]), role: String(args[1]) }] };
  }
  if (path === "editors.letEditorsPublish") return { action: "ask", questions: [{ kind: "editors", who: "" }] };
  return { action: "allow" };
}
