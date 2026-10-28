import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DEV_API_PREFIX, handleDevApi, isLocalOrigin } from "./node-dev-api.js";
import { localFileStore } from "./node-local-files.js";
import { newTaskRequestId, openTaskAnswer, taskKeys } from "./plugin-tasks.js";
import { definePlugin } from "./plugins.js";

/**
 * Tests that start servers and Node processes, which can take seconds to start
 * on Windows while many tests run at once.
 */
const NODE_TIMEOUT = 60_000;

describe("handleDevApi", { timeout: NODE_TIMEOUT }, () => {
  let root: string;
  let server: Server;
  let base: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-api-"));
    const store = localFileStore(root);
    const registryDir = join(root, "registry");
    await mkdir(registryDir);
    await writeFile(join(registryDir, "shadcn-faq.json"), '{"name":"shadcn-faq"}');
    server = createServer(async (req, res) => {
      if (!(await handleDevApi(store, req, res, { registryDir }))) res.writeHead(418).end();
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${DEV_API_PREFIX}`;
  });

  afterAll(async () => {
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  });

  const headers = { "x-goodfellow-request": "1" };
  const json = { ...headers, "content-type": "application/json" };

  it("serves the block registry, and nothing else from its folder's surroundings", async () => {
    const response = await fetch(`${base}/registry/shadcn-faq.json`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "shadcn-faq" });
    expect((await fetch(`${base}/registry/missing.json`)).status).toBe(404);
    expect((await fetch(`${base}/registry/..%2Fpackage.json`)).status).toBe(404);
  });

  it("ignores other URLs", async () => {
    expect((await fetch(base.replace(DEV_API_PREFIX, "/about"))).status).toBe(418);
  });

  it("uploads files as base64 and reads their bytes back", async () => {
    const { revision } = await (await fetch(`${base}/revision`, { headers })).json();
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
    const write = await fetch(`${base}/write`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        changes: [{ path: "public/media/dot.png", base64: bytes.toString("base64") }],
        message: "Upload",
        expectedRevision: revision,
      }),
    });
    expect(write.status).toBe(200);
    expect(await readFile(join(root, "public/media/dot.png"))).toEqual(bytes);
    const read = await (await fetch(`${base}/file?path=public/media/dot.png&as=bytes`, { headers })).json();
    expect(Buffer.from(read.base64, "base64")).toEqual(bytes);
  });

  it("reads, writes and lists files", async () => {
    const { revision } = await (await fetch(`${base}/revision`, { headers })).json();
    const write = await fetch(`${base}/write`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        changes: [{ path: "content/site.json", content: "{}" }],
        message: "Save",
        expectedRevision: revision,
      }),
    });
    expect(write.status).toBe(200);
    expect(await (await fetch(`${base}/file?path=content/site.json`, { headers })).json()).toEqual({ content: "{}" });
    expect(await (await fetch(`${base}/files?dir=content`, { headers })).json()).toEqual({
      files: ["content/site.json"],
    });
    expect((await fetch(`${base}/file?path=content/missing.json`, { headers })).status).toBe(404);
  });

  it("answers with or without a trailing slash, which Next.js adds", async () => {
    expect((await fetch(`${base}/revision/`, { headers })).status).toBe(200);
    expect(await (await fetch(`${base}/files/?dir=content`, { headers })).json()).toEqual({
      files: ["content/site.json"],
    });
  });

  it("answers 409 when the site changed since the given revision", async () => {
    const response = await fetch(`${base}/write`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        changes: [{ path: "content/x.json", content: "{}" }],
        message: "Stale",
        expectedRevision: "old",
      }),
    });
    expect(response.status).toBe(409);
  });

  it("refuses requests other websites could send", async () => {
    expect((await fetch(`${base}/revision`)).status).toBe(403);
    expect((await fetch(`${base}/revision`, { headers: { ...headers, origin: "https://evil.example" } })).status).toBe(
      403,
    );
    const plainText = await fetch(`${base}/write`, {
      method: "POST",
      headers: { ...headers, "content-type": "text/plain" },
      body: "{}",
    });
    expect(plainText.status).toBe(415);
  });

  it("refuses files outside content/ and public/media/, and malformed saves", async () => {
    expect((await fetch(`${base}/file?path=package.json`, { headers })).status).toBe(400);
    const bad = await fetch(`${base}/write`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ changes: "nope" }),
    });
    expect(bad.status).toBe(400);
    const notJson = await fetch(`${base}/write`, { method: "POST", headers: json, body: "{ nope" });
    expect(notJson.status).toBe(400);
  });
});

describe("isLocalOrigin", () => {
  it("trusts pages on this computer, whatever their port", () => {
    expect(isLocalOrigin("http://localhost:3000", "localhost:4399")).toBe(true);
    expect(isLocalOrigin("http://127.0.0.1:3000", "127.0.0.1:4399")).toBe(true);
  });

  it("doesn't trust other websites, even ones whose name points at this computer", () => {
    expect(isLocalOrigin("https://evil.example", "localhost:4399")).toBe(false);
    expect(isLocalOrigin("http://localhost:3000", "evil.example:3000")).toBe(false);
    expect(isLocalOrigin("not a url", "localhost")).toBe(false);
  });
});

describe("handleDevApi's plugins' tasks", { timeout: NODE_TIMEOUT }, () => {
  let root: string;
  let server: Server;
  let base: string;
  const plugin = definePlugin({
    name: "goodfellow-plugin-storage",
    title: "Storage",
    permissions: { secrets: ["STORAGE_KEY"] },
    tasks: [{ id: "sign", module: "./plugins/storage/sign.mjs" }],
  });

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "goodfellow-api-tasks-"));
    await mkdir(join(root, "plugins/storage"), { recursive: true });
    await writeFile(join(root, "package.json"), "{}");
    await writeFile(
      join(root, "plugins/storage/sign.mjs"),
      "export default (input, context) => ({ input, key: context.secrets.STORAGE_KEY ?? null });\n",
    );
    const store = localFileStore(root);
    server = createServer(async (req, res) => {
      const tasks = { root, plugins: async () => [plugin], server: "goodfellow-dev" as const };
      if (!(await handleDevApi(store, req, res, { tasks }))) res.writeHead(418).end();
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}${DEV_API_PREFIX}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((done) => server.close(done));
    await rm(root, { recursive: true, force: true });
  });

  const json = { "x-goodfellow-request": "1", "content-type": "application/json" };

  it("run on this computer, with the server's environment as secrets, answering sealed to the request's key", async () => {
    expect(await (await fetch(`${base}/task/`, { headers: json })).json()).toEqual({
      supported: true,
      place: { kind: "goodfellow-dev" },
    });
    const keys = await taskKeys();
    const request = {
      id: newTaskRequestId(),
      plugin: "goodfellow-plugin-storage",
      task: "sign",
      input: '{"files":["/media/a.mp4"]}',
      key: keys.publicKey,
    };
    // The site's .env.local, read as the task runs, as developers keep secrets on their computers.
    await writeFile(join(root, ".env.local"), "STORAGE_KEY=local key\n");
    try {
      const response = await fetch(`${base}/task/`, { method: "POST", headers: json, body: JSON.stringify(request) });
      const { result } = (await response.json()) as { result: string };
      expect(await openTaskAnswer(result, keys.privateKey)).toEqual({
        ok: true,
        output: { input: { files: ["/media/a.mp4"] }, key: "local key" },
      });
    } finally {
      await rm(join(root, ".env.local"));
    }
    const bad = await fetch(`${base}/task/`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ ...request, key: "{}" }),
    });
    expect(bad.status).toBe(400);
  });
});
