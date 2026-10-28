import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addBroker, BrokerSetupError, setBrokerAddress } from "./node-broker.js";

let dir: string;
let site: string;
const source = { package: "@goodfellow-cms/gitlab", export: "gitlab", options: { project: "parish/site" } };

/** The released page, as jsDelivr serves it. */
const release: Record<string, string> = { "index.html": "<!doctype html>", "assets/index.js": "run()" };
const fakeFetch = async (url: string) => {
  const path = url.replace(/^.*\/site\//, "");
  const body = path === "files.json" ? JSON.stringify({ files: Object.keys(release) }) : release[path];
  return {
    ok: body !== undefined,
    status: body === undefined ? 404 : 200,
    json: async () => JSON.parse(body ?? "null") as unknown,
    arrayBuffer: async () => new TextEncoder().encode(body ?? "").buffer as ArrayBuffer,
  };
};

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "goodfellow-broker-"));
  site = join(dir, "parish");
  await mkdir(join(site, "content"), { recursive: true });
  await writeFile(
    join(site, "content/site.json"),
    JSON.stringify({ title: "St. Joseph's", url: "https://parish.example.org/" }),
  );
  await writeFile(join(site, "goodfellow.config.tsx"), "export default defineConfig({\n  blocks,\n});\n");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** Tests that run git, each start of which can take seconds on Windows while many tests run at once, so a test can take a minute. */
const GIT_TIMEOUT = 180_000;

describe("addBroker", { timeout: GIT_TIMEOUT }, () => {
  it("writes the broker's repository beside the site, with broker.json naming it", async () => {
    const added = await addBroker(site, { source, host: "gitlab-pages", fetch: fakeFetch });
    expect(added.folder).toBe(join(dir, "parish-signin"));
    expect(await readFile(join(added.folder, "site/index.html"), "utf8")).toBe("<!doctype html>");
    expect(JSON.parse(await readFile(join(added.folder, "site/broker.json"), "utf8"))).toEqual({ sites: [source] });
    expect(await readFile(join(added.folder, "README.md"), "utf8")).toContain("# St. Joseph's: sign-in page");
    expect(existsSync(join(added.folder, ".gitlab-ci.yml"))).toBe(true);
  });

  it("needs a domain of its own on GitHub Pages, and an empty folder", async () => {
    await expect(addBroker(site, { source, host: "github-pages", fetch: fakeFetch })).rejects.toBeInstanceOf(
      BrokerSetupError,
    );
    await expect(
      addBroker(site, { source, host: "github-pages", domain: "signin.parish.github.io", fetch: fakeFetch }),
    ).rejects.toThrow("shared");
    await mkdir(join(dir, "parish-signin"));
    await writeFile(join(dir, "parish-signin/notes.txt"), "mine");
    await expect(addBroker(site, { source, host: "vercel", fetch: fakeFetch })).rejects.toThrow("already has files");
  });
});

describe("setBrokerAddress", () => {
  it("writes the config's broker line, checking the address, and removes it", async () => {
    const config = () => readFile(join(site, "goodfellow.config.tsx"), "utf8");
    expect(await setBrokerAddress(site, "https://signin.example.org/")).toBe("https://signin.example.org");
    expect(await config()).toContain('  broker: { url: "https://signin.example.org" },');
    await expect(setBrokerAddress(site, "https://parish.example.org")).rejects.toThrow("site's own address");
    await expect(setBrokerAddress(site, "http://signin.example.org")).rejects.toThrow("https://");
    await setBrokerAddress(site, undefined);
    expect(await config()).not.toContain("broker:");
  });
});
