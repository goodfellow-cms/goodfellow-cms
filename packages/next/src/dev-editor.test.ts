import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { pluginFrameFile, sendFrameFile } from "./dev-editor.js";

/** What a frame's file answers: its status, and its text where it's sent. */
async function sent(folder: string, name: string): Promise<{ status: number; body?: string }> {
  let status = 200;
  let body: string | undefined;
  const res = {
    setHeader() {},
    writeHead(code: number) {
      status = code;
      return res;
    },
    end(data?: Buffer) {
      body = data?.toString();
      return res;
    },
  };
  await sendFrameFile(
    { method: "GET" } as IncomingMessage,
    res as unknown as ServerResponse,
    folder,
    join(folder, ...name.split("/")),
  );
  return { status, ...(body !== undefined && { body }) };
}

describe("sendFrameFile", () => {
  it("sends only what a frame's folder may hold, whatever the latest build left", async () => {
    const folder = await mkdtemp(join(tmpdir(), "goodfellow-frame-"));
    try {
      await writeFile(join(folder, "index.html"), "<!doctype html><title>Frame</title>");
      await writeFile(join(folder, "plugin.js"), "run();");
      // What a build that stopped at its check leaves: a page a module brought, and a script that starts as one.
      await writeFile(join(folder, "help-Ab12Cd34.html"), "<script>steal()</script>");
      await writeFile(join(folder, "page-Ab12Cd34.js"), "<html><script>steal()</script>");
      expect(await sent(folder, "index.html")).toEqual({ status: 200, body: "<!doctype html><title>Frame</title>" });
      expect(await sent(folder, "plugin.js")).toEqual({ status: 200, body: "run();" });
      expect((await sent(folder, "help-Ab12Cd34.html")).status).toBe(404);
      expect((await sent(folder, "page-Ab12Cd34.js")).status).toBe(404);
      expect((await sent(folder, "missing.js")).status).toBe(404);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});

describe("pluginFrameFile", () => {
  const dir = join("/site", "node_modules/.goodfellow/next-plugins");

  it("finds a plugin's frame, its index without a file", () => {
    expect(pluginFrameFile("greeter/", dir)).toEqual({ id: "greeter", file: join(dir, "greeter", "index.html") });
    expect(pluginFrameFile("greeter/app%20one.js", dir)).toEqual({
      id: "greeter",
      file: join(dir, "greeter", "app one.js"),
    });
  });

  it("names nothing for a stray %, or a file outside the plugin's folder, rather than throwing", () => {
    expect(pluginFrameFile("greeter/%", dir)).toBeUndefined();
    expect(pluginFrameFile("%E0%A4%A", dir)).toBeUndefined();
    expect(pluginFrameFile("greeter/..%2f..%2fsecret", dir)).toBeUndefined();
    expect(pluginFrameFile("greeter/../other/index.html", dir)).toBeUndefined();
    expect(pluginFrameFile("", dir)).toBeUndefined();
  });
});
