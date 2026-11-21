import { mkdtemp, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { sendFrameFile } from "./frame-files.js";

/** What a frame's file answers: whether it was answered at all, its status, and its text where it's sent. */
async function sent(folder: string, name: string): Promise<{ answered: boolean; status: number; body?: string }> {
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
  const answered = await sendFrameFile(
    { method: "GET" } as IncomingMessage,
    res as unknown as ServerResponse,
    folder,
    join(folder, ...name.split("/")),
  );
  return { answered, status, ...(body !== undefined && { body }) };
}

describe("sendFrameFile", () => {
  it("sends only what a frame's folder may hold, whatever the latest build left", async () => {
    const folder = await mkdtemp(join(tmpdir(), "goodfellow-frame-"));
    try {
      await writeFile(join(folder, "index.html"), "<!doctype html><title>Frame</title>");
      await writeFile(join(folder, "editor.js"), "run();");
      // What a build that stopped at its check leaves: a page a module brought, and a script that starts as one.
      await writeFile(join(folder, "help-Ab12Cd34.html"), "<script>steal()</script>");
      await writeFile(join(folder, "page-Ab12Cd34.js"), "<html><script>steal()</script>");
      expect(await sent(folder, "index.html")).toEqual({
        answered: true,
        status: 200,
        body: "<!doctype html><title>Frame</title>",
      });
      expect(await sent(folder, "editor.js")).toEqual({ answered: true, status: 200, body: "run();" });
      expect(await sent(folder, "help-Ab12Cd34.html")).toEqual({ answered: true, status: 404 });
      expect(await sent(folder, "page-Ab12Cd34.js")).toEqual({ answered: true, status: 404 });
      // A file that isn't there is the next middleware's.
      expect((await sent(folder, "missing.js")).answered).toBe(false);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
