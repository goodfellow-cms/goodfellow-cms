import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  CALENDARS_DIR,
  ConflictError,
  type ContentSource,
  type ContentStore,
  calendarFiles,
  FEEDS_DIR,
  type FileChange,
  feedFiles,
  loadSiteContent,
  shownContent,
} from "./index.js";
import { InvalidPathError } from "./node-local-files.js";

/** Where the development server exposes the local backend. The admin panel's local store calls these endpoints. */
export const DEV_API_PREFIX = "/__goodfellow/api";

/** Every request must send this header. Browsers won't send custom headers cross-site without a CORS preflight, which this API never approves. */
export const DEV_API_HEADER = "x-goodfellow-request";

/** Room for a save with uploads, which are sent as base64 (a third larger than the files). */
const MAX_BODY_BYTES = 80 * 1024 * 1024;

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RangeError("Request too large.");
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** A change as sent over JSON, where an upload's bytes are base64. */
function toFileChange(value: unknown): FileChange | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const change = value as Record<string, unknown>;
  if (typeof change.path !== "string") return undefined;
  if (change.delete === true) return { path: change.path, delete: true };
  if (typeof change.content === "string") return { path: change.path, content: change.content };
  if (typeof change.base64 === "string")
    return { path: change.path, bytes: new Uint8Array(Buffer.from(change.base64, "base64")) };
  return undefined;
}

export interface DevApiOptions {
  /**
   * Whether to accept a request that says it comes from `origin`. By default
   * only this server's own address is, but a server behind a proxy (such as
   * Next.js's development server) sees a different address in `host`.
   */
  trustOrigin?: (origin: string, host: string | undefined) => boolean;
  /** The built block registry to serve at `registry/<name>.json`, for the admin panel's Blocks screen. */
  registryDir?: string;
}

/** Serves a file of the built block registry: public, read-only files, so they need no checks. */
async function sendRegistryFile(res: ServerResponse, dir: string | undefined, name: string): Promise<void> {
  if (!dir || !/^[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(name)) return send(res, 404, { error: "not-found" });
  try {
    const text = await readFile(join(dir, name), "utf8");
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(text);
  } catch {
    send(res, 404, { error: "not-found" });
  }
}

function sameOrigin(origin: string, host: string | undefined): boolean {
  return origin === `http://${host}` || origin === `https://${host}`;
}

const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Whether both the page and the server's address are on this computer. A website that resolves its name to this computer still sends its own name. */
export function isLocalOrigin(origin: string, host: string | undefined): boolean {
  try {
    return (
      LOCAL_HOSTNAMES.has(new URL(origin).hostname) &&
      host !== undefined &&
      LOCAL_HOSTNAMES.has(new URL(`http://${host}`).hostname)
    );
  } catch {
    return false;
  }
}

/** Rejects requests that could come from another website: they must carry our header and, if they say where they're from, come from a trusted page. */
function isTrusted(req: IncomingMessage, trustOrigin: DevApiOptions["trustOrigin"] = sameOrigin): boolean {
  if (req.headers[DEV_API_HEADER] !== "1") return false;
  const origin = req.headers.origin;
  return origin === undefined || trustOrigin(origin, req.headers.host);
}

/**
 * Handles a request to the development API, or returns `false` if the URL
 * isn't one of its endpoints. Never mounted outside `goodfellow dev`.
 */
/** The files builds write besides pages, by the folder they're in, and what each kind is served as. */
const BUILD_FILES = [
  { dir: CALENDARS_DIR, extensions: [".ics"], files: calendarFiles },
  { dir: FEEDS_DIR, extensions: [".rss", ".atom"], files: feedFiles },
];

const BUILD_FILE_TYPES: Record<string, string> = {
  ".ics": "text/calendar; charset=utf-8",
  ".rss": "application/rss+xml; charset=utf-8",
  ".atom": "application/atom+xml; charset=utf-8",
};

/**
 * Answers a request for one of the files builds write besides pages, the
 * calendar files (`/calendars/…`) and feeds (`/feeds/…`), from the site's
 * content as it is now. Says whether the address was one.
 */
export async function sendBuildFile(source: ContentSource, pathname: string, res: ServerResponse): Promise<boolean> {
  const kind = BUILD_FILES.find(
    ({ dir, extensions }) =>
      pathname.startsWith(`/${dir}/`) && extensions.some((extension) => pathname.endsWith(extension)),
  );
  if (!kind) return false;
  const file = kind.files(shownContent(await loadSiteContent(source))).find((candidate) => candidate.path === pathname);
  if (!file) {
    res.statusCode = 404;
    res.end();
    return true;
  }
  res.statusCode = 200;
  res.setHeader("Content-Type", BUILD_FILE_TYPES[pathname.slice(pathname.lastIndexOf("."))] ?? "text/plain");
  res.end(file.content);
  return true;
}

export async function handleDevApi(
  store: ContentStore,
  req: IncomingMessage,
  res: ServerResponse,
  options: DevApiOptions = {},
): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  if (!url.pathname.startsWith(`${DEV_API_PREFIX}/`)) return false;
  // Without a trailing slash: Next.js redirects `/revision` to `/revision/` in sites with `trailingSlash`.
  const endpoint = url.pathname.slice(DEV_API_PREFIX.length + 1).replace(/\/+$/, "");

  if (req.method === "GET" && endpoint.startsWith("registry/")) {
    await sendRegistryFile(res, options.registryDir, endpoint.slice("registry/".length));
    return true;
  }
  // Calendar files and feeds are public, as they are on the built site: next dev rewrites /calendars/ and /feeds/ here.
  if (req.method === "GET" && (endpoint.startsWith(`${CALENDARS_DIR}/`) || endpoint.startsWith(`${FEEDS_DIR}/`))) {
    if (!(await sendBuildFile(store, `/${endpoint}`, res))) send(res, 404, { error: "not-found" });
    return true;
  }
  if (!isTrusted(req, options.trustOrigin)) {
    send(res, 403, { error: "forbidden" });
    return true;
  }

  try {
    if (req.method === "GET" && endpoint === "revision") {
      send(res, 200, { revision: await store.revision() });
    } else if (req.method === "GET" && endpoint === "files") {
      send(res, 200, { files: await store.list(url.searchParams.get("dir") ?? "") });
    } else if (req.method === "GET" && endpoint === "file") {
      const path = url.searchParams.get("path") ?? "";
      if (url.searchParams.get("as") === "bytes") {
        const bytes = await store.readBytes(path);
        if (bytes === undefined) send(res, 404, { error: "not-found" });
        else send(res, 200, { base64: Buffer.from(bytes).toString("base64") });
      } else {
        const content = await store.read(path);
        if (content === undefined) send(res, 404, { error: "not-found" });
        else send(res, 200, { content });
      }
    } else if (req.method === "POST" && endpoint === "write") {
      if (!req.headers["content-type"]?.startsWith("application/json")) {
        send(res, 415, { error: "unsupported-media-type" });
        return true;
      }
      const body = (await readJson(req)) as Record<string, unknown>;
      const { message, expectedRevision } = body;
      const changes: Array<FileChange | undefined> | undefined = Array.isArray(body.changes)
        ? body.changes.map(toFileChange)
        : undefined;
      if (
        !changes?.every((change): change is FileChange => change !== undefined) ||
        typeof message !== "string" ||
        typeof expectedRevision !== "string"
      ) {
        send(res, 400, { error: "bad-request" });
        return true;
      }
      const result = await store.write(changes, { message, expectedRevision });
      console.log(`  Saved: ${message}`);
      send(res, 200, result);
    } else {
      send(res, 404, { error: "not-found" });
    }
  } catch (error) {
    if (error instanceof ConflictError) send(res, 409, { error: "conflict" });
    else if (error instanceof InvalidPathError) send(res, 400, { error: "invalid-path", message: error.message });
    else if (error instanceof SyntaxError || error instanceof RangeError) send(res, 400, { error: "bad-request" });
    else {
      console.error(error);
      send(res, 500, { error: "server-error", message: (error as Error).message });
    }
  }
  return true;
}
