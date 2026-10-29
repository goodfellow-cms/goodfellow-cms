/**
 * The token broker: a static page on an address of its own that keeps editors'
 * tokens and AI keys, shows the site's admin panel in a frame, and makes every
 * call to the git host for it. The admin panel reaches the broker's backend
 * through one `MessagePort`, with `remoteBackend()` on its side and
 * `serveBackend()` on the broker's, which answers only for what `GitBackend`
 * offers, never the backend's own requests, and lets the broker check each
 * call before making it (`brokerChangeCheck()`).
 */
import { adminOrigin } from "./admin-domain.js";
import { CONTENT_DIR } from "./content/paths.js";
import { CodeChangeError, ConflictError, type FileChange, isContentPath } from "./content/store.js";
import { DomainError } from "./domains.js";
import { DraftError } from "./drafts.js";
import { EditorsError } from "./editors.js";
import { GitApiError, type GitBackend, SignInError } from "./git.js";
import { ScheduledBuildsError } from "./scheduled-builds.js";
import { UpdatesError } from "./updates.js";

/** A handler for a port's messages, written so a `MessagePort`'s handler, which takes a `MessageEvent`, fits it. */
type BrokerHandler = { handle(event: { data: unknown }): void }["handle"];

/** The part of a `MessagePort` the broker and the admin panel talk on. */
export interface BrokerPort {
  postMessage(message: unknown): void;
  onmessage: BrokerHandler | null;
}

/** The config's `broker`: where the site's token broker is. */
export interface BrokerAddress {
  /** The broker's address, such as `https://broker.example.org`, which serves nothing else. */
  url: string;
}

/** The message the admin panel sends the broker when it has loaded in its frame. */
export const BROKER_READY_MESSAGE = "goodfellow:broker-ready";
/** The broker's answer, with the port they talk on from then on. */
export const BROKER_CONNECT_MESSAGE = "goodfellow:broker-connect";

/** What the broker tells the admin panel with the ports, beside its backend. */
export interface BrokerAccount {
  /** The git host's name, such as "GitHub". */
  hostName: string;
  /** Whether the host's sign-in comes back only to addresses listed with it, as `GitHost.redirectAddressesListed`. */
  redirectAddressesListed: boolean;
  /** The AI services the broker keeps keys for, which the admin panel asks through it. */
  aiServices: string[];
}

/**
 * Where the admin panel sends AI requests that go through the broker: it never
 * fetches this address, but hands each request to the broker, which sends it
 * on with its own keys (`BrokerService`).
 */
export const BROKER_AI_ADDRESS = "https://goodfellow-broker.invalid/ai";

/** Requests on the broker's second port, besides the backend's: AI requests, and the screen the admin panel shows. */
export type BrokerServiceRequest =
  | {
      type: "ai";
      id: number;
      /** The service and the path in its API, such as `anthropic/v1/messages`, then any query. */
      path: string;
      method: string;
      headers: [string, string][];
      body?: ArrayBuffer;
    }
  /** The admin panel's screen, which the broker opens again after going to the host to sign in. */
  | { type: "route"; hash: string };

export interface BrokerServiceAnswer {
  type: "ai";
  id: number;
  status: number;
  headers: [string, string][];
  body: ArrayBuffer;
}

/** The broker's origin, such as `https://broker.example.org`, if its address is one of its own. */
export function brokerOrigin(broker: BrokerAddress | undefined): string | undefined {
  return broker ? adminOrigin(broker) : undefined;
}

/** Why a broker's address can't be used, for builds and the admin panel to explain. */
export type BrokerAddressProblem =
  /** Not an `https://` address of its own, such as `https://broker.example.org`. */
  | "invalid"
  /** A `github.io` address, which every Pages site in the same account shares. */
  | "shared"
  /** The site's own address, or its admin address, which leaves nothing to keep apart. */
  | "same-as-site";

export function brokerAddressProblem(
  broker: BrokerAddress,
  { siteUrl, admin }: { siteUrl?: string; admin?: { url: string } },
): BrokerAddressProblem | undefined {
  const origin = brokerOrigin(broker);
  if (!origin) return "invalid";
  const host = origin.replace(/^https?:\/\//, "").replace(/:\d+$/, "");
  // `your-name.github.io` is the account's own site, at the same origin as every project site under it.
  if (host === "github.io" || host.endsWith(".github.io")) return "shared";
  const others = [adminOrigin(admin)];
  try {
    if (siteUrl) others.push(new URL(siteUrl).origin);
  } catch {
    // A Site address that isn't one is the site checks' to report.
  }
  return others.includes(origin) ? "same-as-site" : undefined;
}

const BROKER_LINE = /^[ \t]*broker:\s*\{[^\n}]*\},?[ \t]*\n/m;

/**
 * `goodfellow.config.tsx` with its `broker` line set to `broker`, or removed,
 * as `withAdminConfig()` does for the admin address; `undefined` if the file
 * has no `defineConfig({` to put it in.
 */
export function withBrokerConfig(source: string, broker: BrokerAddress | undefined): string | undefined {
  const line = broker ? `  broker: { url: ${JSON.stringify(broker.url)} },\n` : "";
  if (BROKER_LINE.test(source)) return source.replace(BROKER_LINE, line);
  if (!broker) return source;
  const opening = /defineConfig\(\{[ \t]*\n/.exec(source);
  if (!opening) return undefined;
  const at = opening.index + opening[0].length;
  return `${source.slice(0, at)}${line}${source.slice(at)}`;
}

/** The `broker` that `goodfellow.config.tsx` sets on its line of its own, as `withBrokerConfig()` writes it. */
export function configBroker(source: string): BrokerAddress | undefined {
  const line = BROKER_LINE.exec(source)?.[0];
  const url = line && /url:\s*"([^"\\]+)"/.exec(line)?.[1];
  return url ? { url } : undefined;
}

/** What a change asks the editor about before the broker publishes it. */
export type BrokerConfirmKind =
  /** The site's code, its config or its packages, which run when it's built. */
  | "code"
  /** The site's own code that runs on its pages (`content/code/`). */
  | "custom-code"
  /** The Site address, which is where the broker shows the admin panel from. */
  | "site-address";

export interface BrokerChangeCheck {
  /** Files the broker never changes, such as workflows, which run with the repository's secrets. */
  refused: string[];
  /** Files it changes only once the editor has said so, in the broker's own part of the page. */
  confirm: { path: string; kind: BrokerConfirmKind }[];
}

/** Whether a path is one of the git host's workflows, which run with the repository's secrets. */
export function isWorkflowPath(path: string): boolean {
  return (
    path.startsWith(".github/") ||
    path === ".gitlab-ci.yml" ||
    path.startsWith(".gitlab/") ||
    path === "bitbucket-pipelines.yml"
  );
}

/**
 * Sorts a publish's changes into those the broker makes as they are, those it
 * asks the editor about first and those it refuses, since whoever runs code in
 * the admin panel's frame can ask it to publish anything. `siteUrl` is the
 * Site address as it is now, which a change to `content/site.json` mustn't move
 * without the editor knowing.
 */
export function brokerChangeCheck(changes: readonly FileChange[], siteUrl: string | undefined): BrokerChangeCheck {
  const check: BrokerChangeCheck = { refused: [], confirm: [] };
  for (const change of changes) {
    const { path } = change;
    if (isWorkflowPath(path) || path.startsWith("/") || path.split("/").includes("..")) check.refused.push(path);
    else if (path.startsWith(`${CONTENT_DIR}/code/`)) check.confirm.push({ path, kind: "custom-code" });
    else if (!isContentPath(path)) check.confirm.push({ path, kind: "code" });
    else if (path === `${CONTENT_DIR}/site.json`) {
      // Written as text or as bytes, which every backend publishes alike; deleting it takes the address away.
      const text =
        "content" in change
          ? change.content
          : "bytes" in change
            ? new TextDecoder("utf-8", { fatal: false }).decode(change.bytes)
            : undefined;
      let url: unknown;
      try {
        url = text === undefined ? undefined : (JSON.parse(text) as { url?: unknown }).url;
      } catch {
        url = undefined;
      }
      if ((url ?? undefined) !== (siteUrl ?? undefined)) check.confirm.push({ path, kind: "site-address" });
    }
  }
  return check;
}

/** Thrown in the admin panel when the broker won't publish something, or the editor said no. */
export class BrokerRefusedError extends Error {
  override name = "BrokerRefusedError";
  constructor(
    readonly problem: "workflow" | "declined" | "not-here" | "limits",
    message: string,
  ) {
    super(message);
  }
}

/**
 * What of a backend the broker answers for, by the shape of `GitBackend`:
 * values it sends, methods it calls, objects within it, and objects that
 * methods return, which it keeps until the admin panel lets them go.
 */
interface Shape {
  /** What calls on an object a method returned are named in `check()`, such as `draft` for `draft.publish`. */
  name?: string;
  data?: readonly string[];
  methods?: readonly string[];
  objects?: Record<string, Shape>;
  /** Methods whose results have methods of their own. */
  returns?: Record<string, Shape>;
  /** Methods that return such an object at once, not a promise. */
  sync?: Record<string, Shape>;
}

const STORE_METHODS = ["revision", "read", "readBytes", "list", "readFiles", "fileSizes", "write", "changedPaths"];
/** What `filesAt()` gives: the reads every `RevisionFiles` has. */
const FILES_METHODS = ["read", "readBytes", "list"];
const FILES: Shape = { methods: FILES_METHODS };
const DRAFT: Shape = {
  name: "draft",
  data: ["name"],
  methods: ["changes", "paths", "publish", "submitForReview", "discard"],
  objects: { store: { methods: STORE_METHODS } },
};
const BACKEND: Shape = {
  data: ["user", "contentOnly"],
  methods: [...STORE_METHODS, "deployStatus", "history", "readAt", "repositoryVisibility", "signOut"],
  sync: { filesAt: FILES },
  objects: {
    pages: { data: ["severalDomains"], methods: ["site", "connect", "records", "status", "secure", "disconnect"] },
    editors: {
      data: ["invitesByEmail", "membersOnly"],
      methods: ["list", "invite", "setRole", "remove", "letEditorsPublish"],
    },
    ownerAccess: { data: ["tokenLink", "active", "problem"], methods: ["forget", "startRedirect", "requestToken"] },
    updates: {
      methods: ["setup", "enable", "lastRun", "start", "rebuild"],
      objects: {
        code: { data: ["repo", "webUrl"], methods: ["read", "history", "readAt"] },
        nightly: { methods: ["supported", "get", "set"] },
      },
    },
    drafts: { methods: ["create", "open", "list", "reviews"], returns: { create: DRAFT, open: DRAFT } },
    scheduledBuilds: { methods: ["timing", "sync"] },
    tasks: { methods: ["supported", "secretsPlace", "run"] },
  },
};

/**
 * Every call the broker offers, by the path `check()` names it with, such as
 * `draft.publish` or `filesAt.read`, so its policy can be tested against all of them.
 */
export function brokerCalls(): string[] {
  const calls: string[] = [];
  const walk = (shape: Shape, prefix: string) => {
    for (const method of shape.methods ?? []) calls.push(`${prefix}${method}`);
    for (const [method, inner] of Object.entries(shape.sync ?? {})) {
      for (const then of inner.methods ?? []) calls.push(`${prefix}${method}.${then}`);
    }
    for (const [key, inner] of Object.entries(shape.objects ?? {})) walk(inner, `${prefix}${key}.`);
    for (const [method, inner] of Object.entries(shape.returns ?? {}))
      walk(inner, `${inner.name ?? `${prefix}${method}`}.`);
  };
  walk(BACKEND, "");
  return [...new Set(calls)];
}

/** What the admin panel learns of an object: its values, the methods it has, and the objects within it. */
interface Description {
  handle: number;
  data: Record<string, unknown>;
  methods: string[];
  objects: Record<string, Description>;
}

type Call = { type: "call"; id: number; handle: number; path: string[]; args: unknown[]; then?: [string, unknown[]] };
type Answer =
  | { type: "answer"; id: number; ok: true; value: unknown; state: Description }
  | { type: "answer"; id: number; ok: false; error: SentError; state: Description };

interface SentError {
  name: string;
  message: string;
  fields: Record<string, unknown>;
}

/** An error as it can cross a port: its name, message and plain fields such as `problem`. */
function sendError(error: unknown): SentError {
  if (!(error instanceof Error)) return { name: "Error", message: String(error), fields: {} };
  const fields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(error)) {
    if (["string", "number", "boolean"].includes(typeof value)) fields[key] = value;
  }
  return { name: error.name, message: error.message, fields };
}

/** The error again on the admin panel's side, as the class the admin panel checks for. */
function receiveError({ name, message, fields }: SentError): Error {
  const problem = fields.problem as never;
  switch (name) {
    case "ConflictError":
      return new ConflictError(message);
    case "SignInError":
      return new SignInError(problem, message, fields.link as string | undefined);
    case "GitApiError":
      return new GitApiError(Number(fields.status), message);
    case "DomainError":
      return new DomainError(problem, message);
    case "EditorsError":
      return new EditorsError(problem, message);
    case "DraftError":
      return new DraftError(problem, message);
    case "UpdatesError":
      return new UpdatesError(problem, message);
    case "ScheduledBuildsError":
      return new ScheduledBuildsError(problem, message);
    case "BrokerRefusedError":
      return new BrokerRefusedError(problem, message);
    case "CodeChangeError":
      return Object.assign(new CodeChangeError(""), { message });
    default:
      return new Error(message);
  }
}

/** A value as it can cross a port: structured clone keeps data, but not errors' classes or functions. */
function sendable(value: unknown): unknown {
  if (value instanceof Error) return { __error: sendError(value) };
  return value;
}

function received(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "__error" in value) {
    return receiveError((value as { __error: SentError }).__error);
  }
  return value;
}

export interface ServeOptions {
  /**
   * Asked before every call the admin panel makes, with its path in the
   * backend (such as `write`, `drafts.create` then `store.write`, or
   * `editors.invite`) and its arguments. Throw, such as a `BrokerRefusedError`,
   * to refuse it.
   */
  check?(call: { path: string; args: unknown[]; target: unknown }): Promise<void> | void;
  /** Answers methods the broker adds itself, such as `ownerAccess.requestToken`, by path. */
  extra?: Record<string, (...args: unknown[]) => unknown>;
}

/**
 * Answers the admin panel's calls on `port` with `backend`, the broker's own,
 * for what `GitBackend` offers and nothing else. Returns a function that stops.
 */
export function serveBackend(port: BrokerPort, backend: GitBackend, options: ServeOptions = {}): () => void {
  const held = new Map<number, { target: object; shape: Shape; prefix: string }>([
    [0, { target: backend, shape: BACKEND, prefix: "" }],
  ]);
  let next = 1;

  function describe(target: object, shape: Shape, prefix: string, handle: number): Description {
    const record = target as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    for (const key of shape.data ?? []) if (record[key] !== undefined) data[key] = sendable(record[key]);
    const methods = (shape.methods ?? []).filter(
      (name) => typeof record[name] === "function" || options.extra?.[`${prefix}${name}`] !== undefined,
    );
    for (const name of Object.keys(shape.sync ?? {})) if (typeof record[name] === "function") methods.push(name);
    const objects: Record<string, Description> = {};
    for (const [key, inner] of Object.entries(shape.objects ?? {})) {
      const value = record[key];
      if (typeof value === "object" && value !== null)
        objects[key] = describe(value, inner, `${prefix}${key}.`, handle);
    }
    return { handle, data, methods, objects };
  }

  const state = () => describe(backend, BACKEND, "", 0);

  /** The object a path leads to from a held one, and the shape it has, or `undefined` if it isn't offered. */
  function resolve(handle: number, path: string[]) {
    const holding = held.get(handle);
    if (!holding) return undefined;
    let target: unknown = holding.target;
    let shape: Shape | undefined = holding.shape;
    let prefix = holding.prefix;
    for (const key of path.slice(0, -1)) {
      shape = shape?.objects?.[key];
      target = (target as Record<string, unknown> | undefined)?.[key];
      prefix += `${key}.`;
      if (!shape || typeof target !== "object" || target === null) return undefined;
    }
    const method = path.at(-1) ?? "";
    const offered = shape?.methods?.includes(method) || Object.hasOwn(shape?.sync ?? {}, method);
    if (!offered || !shape) return undefined;
    return { target: target as Record<string, unknown>, shape, method, name: `${prefix}${method}` };
  }

  async function answer(call: Call): Promise<unknown> {
    const found = resolve(call.handle, call.path);
    if (!found) throw new BrokerRefusedError("not-here", "The broker doesn't offer that.");
    const { target, shape, method, name } = found;
    const args = Array.isArray(call.args) ? call.args : [];
    const extra = options.extra?.[name];
    if (shape.sync?.[method]) {
      // A factory, such as `filesAt(revision)`, whose object's method is called at once.
      const inner = shape.sync[method];
      const [then, thenArgs] = call.then ?? ["", []];
      if (!inner.methods?.includes(then)) throw new BrokerRefusedError("not-here", "The broker doesn't offer that.");
      await options.check?.({ path: `${name}.${then}`, args: [...args, ...thenArgs], target });
      const made = (target[method] as (...a: unknown[]) => Record<string, unknown>).apply(target, args);
      return (made[then] as (...a: unknown[]) => unknown).apply(made, thenArgs);
    }
    await options.check?.({ path: name, args, target });
    const value = extra
      ? await extra(...args)
      : await (target[method] as (...a: unknown[]) => unknown).apply(target, args);
    const returns = shape.returns?.[method];
    if (returns && typeof value === "object" && value !== null) {
      const handle = next++;
      const prefix = `${returns.name ?? name}.`;
      held.set(handle, { target: value, shape: returns, prefix });
      return { __object: describe(value, returns, prefix, handle) };
    }
    return value;
  }

  port.onmessage = async (event) => {
    const message = event.data as Call | undefined;
    if (message?.type !== "call" || !Array.isArray(message.path)) return;
    try {
      const value = await answer(message);
      port.postMessage({ type: "answer", id: message.id, ok: true, value, state: state() } satisfies Answer);
    } catch (error) {
      port.postMessage({
        type: "answer",
        id: message.id,
        ok: false,
        error: sendError(error),
        state: state(),
      } satisfies Answer);
    }
  };
  port.postMessage({ type: "state", state: state() });
  return () => {
    port.onmessage = null;
    held.clear();
  };
}

/**
 * The broker's backend on the admin panel's side of `port`: a `GitBackend` whose
 * every call is made by the broker. Resolves once the broker has said what the
 * backend offers.
 */
export function remoteBackend(port: BrokerPort, options: { onSignOut?: () => void } = {}): Promise<GitBackend> {
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  let next = 1;
  let root: Description | undefined;
  let ready: ((backend: GitBackend) => void) | undefined;
  const live = new Map<number, Description>();

  function call(handle: number, path: string[], args: unknown[], then?: [string, unknown[]]): Promise<unknown> {
    const id = next++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      port.postMessage({ type: "call", id, handle, path, args, ...(then && { then }) } satisfies Call);
    });
  }

  /** The object a description describes, whose values follow what the broker last said. */
  function build(description: Description, path: string[], current: () => Description | undefined): object {
    const object: Record<string, unknown> = {};
    for (const key of Object.keys(description.data)) {
      Object.defineProperty(object, key, {
        enumerable: true,
        get: () => received(current()?.data[key]),
      });
    }
    for (const method of description.methods) {
      object[method] =
        method === "filesAt"
          ? (revision: string) =>
              Object.fromEntries(
                FILES_METHODS.map((then) => [
                  then,
                  (...args: unknown[]) => call(description.handle, [...path, method], [revision], [then, args]),
                ]),
              )
          : (...args: unknown[]) => call(description.handle, [...path, method], args).then(wrap);
    }
    for (const [key, inner] of Object.entries(description.objects)) {
      object[key] = build(inner, [...path, key], () => {
        let found = current();
        found = found?.objects[key];
        return found;
      });
    }
    return object;
  }

  /** A method's result, made into an object of its own where it has methods, such as a draft. */
  function wrap(value: unknown): unknown {
    if (typeof value === "object" && value !== null && "__object" in value) {
      const description = (value as { __object: Description }).__object;
      live.set(description.handle, description);
      return build(description, [], () => live.get(description.handle));
    }
    return value;
  }

  port.onmessage = (event) => {
    const message = event.data as Answer | { type: "state"; state: Description } | undefined;
    if (message?.type === "state") {
      root = message.state;
      if (ready) {
        const backend = build(root, [], () => root) as GitBackend & { signOut(): void };
        const signOut = backend.signOut;
        ready(
          Object.assign(backend, {
            signOut() {
              void signOut?.call(backend);
              options.onSignOut?.();
            },
          }),
        );
        ready = undefined;
      }
      return;
    }
    if (message?.type !== "answer") return;
    root = message.state;
    const waiting = pending.get(message.id);
    if (!waiting) return;
    pending.delete(message.id);
    if (message.ok) waiting.resolve(message.value);
    else waiting.reject(receiveError(message.error));
  };

  return new Promise((resolve) => {
    ready = resolve;
  });
}
