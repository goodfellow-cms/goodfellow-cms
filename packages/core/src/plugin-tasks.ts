/**
 * Plugins' tasks: work a plugin's admin module asks the site's CI to do, with
 * secrets only the CI holds, such as signing uploads to a storage bucket with
 * its keys. The admin panel starts the task through its backend (`tasks`),
 * which runs the starters' task workflow or pipeline (about a minute), and
 * gets back the task's answer, sealed to a key the admin panel made for that
 * request alone, since what CI writes can be read by anyone who can read the
 * repository's runs. Nothing here needs a server, so static sites have tasks
 * too; on full-stack sites the app's server can run them instead.
 */

/** A task the admin panel asks the site's CI to run. */
export interface PluginTaskRequest {
  /** The admin panel's id for the request, which names its run and where its answer is left. */
  id: string;
  /** The plugin's id (`pluginId()`). */
  plugin: string;
  /** The task's id, as the plugin declared it. */
  task: string;
  /** What the plugin's admin module passed, as JSON. */
  input: string;
  /** The public key the answer is sealed to, as a JSON Web Key. */
  key: string;
}

/** The longest input a task takes, in characters, since workflow inputs are limited. */
export const TASK_INPUT_LIMIT = 32_000;
/** The longest answer a task gives, in characters of JSON, before it's sealed. */
export const TASK_OUTPUT_LIMIT = 512_000;
/** Request ids: what the admin panel makes, which name branches and runs. */
const REQUEST_ID = /^[a-z0-9]{8,40}$/;
/** Where GitHub leaves a task's answer, on a branch of its own the admin panel deletes once read. */
export const TASK_BRANCH_PREFIX = "goodfellow-task-";
/** The file a task's answer is in, on that branch or as a GitLab job's artifact. */
export const TASK_RESULT_FILE = "goodfellow-task-result.json";
/** The starters' GitHub workflow that runs tasks, and their GitLab job. */
export const TASK_WORKFLOW = "plugin-task.yml";
export const TASK_JOB = "plugin-task";
/** The `repository_dispatch` event that starts it on GitHub. */
export const TASK_EVENT = "goodfellow-plugin-task";

/** Whether a request id is one the admin panel would make. */
export function isTaskRequestId(id: string): boolean {
  return REQUEST_ID.test(id);
}

/** A new request id. */
export function newTaskRequestId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return [...bytes]
    .map((byte) => byte.toString(36).padStart(2, "0"))
    .join("")
    .slice(0, 20);
}

/** What a request's fields must look like before anything runs it: CI passes them on to Goodfellow's command. */
export function taskRequestProblem(request: PluginTaskRequest): string | undefined {
  const { id, plugin, task, input, key } = request as Partial<Record<keyof PluginTaskRequest, unknown>>;
  if (![id, plugin, task, input, key].every((value) => typeof value === "string")) {
    return "That isn't a task's request.";
  }
  if (!isTaskRequestId(request.id)) return "The request's id isn't one the admin panel makes.";
  if (!/^[a-z0-9][a-z0-9._-]*(--[a-z0-9][a-z0-9._-]*)?$/.test(request.plugin)) return "That isn't a plugin's id.";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(request.task)) return "That isn't a task's id.";
  if (request.input.length > TASK_INPUT_LIMIT) return "The task's input is too long.";
  try {
    JSON.parse(request.input);
    const key = JSON.parse(request.key) as { kty?: unknown; crv?: unknown; d?: unknown };
    if (key.kty !== "EC" || key.crv !== "P-256" || key.d !== undefined) return "The answer's key isn't a public key.";
  } catch {
    return "The task's input or key isn't JSON.";
  }
  return undefined;
}

/** A task's answer as it's left for the admin panel: sealed, or, where the task couldn't start at all, only that. */
export type TaskResultFile =
  | { version: 1; key: Record<string, unknown>; iv: string; data: string }
  | { version: 1; failed: true };

/** What a sealed answer holds: the task's output, or what went wrong, in words its plugin wrote. */
export type TaskAnswer = { ok: true; output: unknown } | { ok: false; error: string };

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

/** A request's private key, a Web Crypto `CryptoKey` that can't be exported. */
export interface TaskPrivateKey {
  readonly type: string;
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function unbase64(text: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/** A key pair for one request: the public half goes with it, the private half never leaves the admin panel's memory. */
export async function taskKeys(): Promise<{ publicKey: string; privateKey: TaskPrivateKey }> {
  const pair = await crypto.subtle.generateKey(ECDH, false, ["deriveKey"]);
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", pair.publicKey);
  return { publicKey: JSON.stringify({ kty, crv, x, y }), privateKey: pair.privateKey };
}

/** Seals an answer to the request's public key, with a key pair of its own (ECDH, then AES-GCM). */
export async function sealTaskAnswer(answer: TaskAnswer, publicKey: string): Promise<TaskResultFile> {
  const recipient = await crypto.subtle.importKey("jwk", JSON.parse(publicKey), ECDH, false, []);
  const own = await crypto.subtle.generateKey(ECDH, false, ["deriveKey"]);
  const shared = await crypto.subtle.deriveKey(
    { name: "ECDH", public: recipient },
    own.privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt"],
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    shared,
    new TextEncoder().encode(JSON.stringify(answer)),
  );
  const { kty, crv, x, y } = await crypto.subtle.exportKey("jwk", own.publicKey);
  return { version: 1, key: { kty, crv, x, y }, iv: base64(iv), data: base64(new Uint8Array(data)) };
}

/** A task couldn't run: its plugin's code failed, or the site's CI couldn't run it. */
export class PluginTaskError extends Error {
  override name = "PluginTaskError";
  constructor(
    readonly problem: "missing" | "not-allowed" | "timeout" | "failed",
    message: string,
  ) {
    super(message);
  }
}

/** Opens an answer with the request's private key. Throws a `PluginTaskError` for an answer that isn't one. */
export async function openTaskAnswer(text: string, privateKey: TaskPrivateKey): Promise<TaskAnswer> {
  let file: Partial<{ version: number; failed: boolean; key: Record<string, unknown>; iv: string; data: string }>;
  try {
    file = JSON.parse(text);
  } catch {
    throw new PluginTaskError("failed", "The task's answer couldn't be read.");
  }
  if (file.failed) throw new PluginTaskError("failed", "The site's build service couldn't run the task.");
  if (file.version !== 1 || !file.key || typeof file.iv !== "string" || typeof file.data !== "string") {
    throw new PluginTaskError("failed", "The task's answer couldn't be read.");
  }
  try {
    const sender = await crypto.subtle.importKey("jwk", file.key, ECDH, false, []);
    const shared = await crypto.subtle.deriveKey(
      { name: "ECDH", public: sender },
      // The key `taskKeys()` made, whatever the environment calls its type.
      privateKey as Parameters<typeof crypto.subtle.deriveKey>[1],
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    );
    const data = await crypto.subtle.decrypt({ name: "AES-GCM", iv: unbase64(file.iv) }, shared, unbase64(file.data));
    const answer = JSON.parse(new TextDecoder().decode(new Uint8Array(data))) as TaskAnswer;
    if (answer.ok === true || (answer.ok === false && typeof answer.error === "string")) return answer;
  } catch {
    // Not sealed to this request's key.
  }
  throw new PluginTaskError("failed", "The task's answer couldn't be read.");
}

/**
 * Where the secrets plugins' tasks get are kept, as the backend knows it, for
 * the admin panel to say how to add them: the page of a GitHub repository's
 * Actions secrets or a GitLab project's CI/CD variables, the development
 * server's `.env.local`, or a full-stack site's server, whose own tasks run in
 * the CI it names.
 */
export type TaskSecretsPlace =
  | { kind: "github"; url: string }
  | { kind: "gitlab"; url: string }
  | { kind: "goodfellow-dev" | "next-dev" }
  | { kind: "server"; ci?: TaskSecretsPlace };

/** How a backend runs plugins' tasks in the site's CI. */
export interface PluginTasks {
  /** Whether the site's setup files run them: the starters' task workflow or job. */
  supported(): Promise<boolean>;
  /** Where the secrets tasks get are kept. */
  secretsPlace(): Promise<TaskSecretsPlace | undefined>;
  /** Starts a task and waits for it, giving its answer's text, still sealed. Throws a `PluginTaskError`. */
  run(request: PluginTaskRequest): Promise<string>;
}

/** How long a backend waits for a task, which normally takes about a minute. */
export const TASK_TIMEOUT_MS = 5 * 60_000;
/** How often it looks for the answer. */
export const TASK_POLL_MS = 4_000;
