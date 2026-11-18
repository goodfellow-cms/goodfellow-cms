import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { request } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { preview } from "./preview.js";

const servers: { close: () => void }[] = [];
const folders: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) server.close();
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function start(network = false) {
  const root = await mkdtemp(join(tmpdir(), "goodfellow-preview-"));
  folders.push(root);
  await mkdir(join(root, "dist"));
  await writeFile(join(root, "dist", "index.html"), "<p>Not published yet</p>");
  const server = await preview({ root, port: 0, network });
  servers.push(server);
  return (server.address() as AddressInfo).port;
}

/** The status a request to this computer's preview gets, sent with `host` as the name it asked for. */
function status(port: number, host: string): Promise<number> {
  return new Promise((done, fail) => {
    const req = request({ host: "127.0.0.1", port, path: "/", headers: { host } }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.on("error", fail);
    req.end();
  });
}

describe("goodfellow preview", () => {
  it("answers this computer's names, and no other site's that points at it", async () => {
    const port = await start();
    expect(await status(port, `localhost:${port}`)).toBe(200);
    expect(await status(port, `127.0.0.1:${port}`)).toBe(200);
    expect(await status(port, `rebind.attacker.example:${port}`)).toBe(403);
  });

  it("answers any name when shared with the network", async () => {
    const port = await start(true);
    expect(await status(port, `my-laptop.example:${port}`)).toBe(200);
  });
});
