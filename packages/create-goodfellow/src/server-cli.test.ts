import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Runner } from "./cloudflare-setup.js";
import { ScaffoldError } from "./scaffold.js";
import { createServerSite, type ServerSiteChoices, type ServerSiteIo, siteAddress } from "./server-cli.js";

// The company example, as create-goodfellow's bundled templates/company is.
const templatesDir = resolve(import.meta.dirname, "../../../examples");
const versions = new Proxy({} as Record<string, string>, { get: () => "1.2.3" });

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "server-site-"));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

function io(answers: string[] = [], ran: string[] = []): ServerSiteIo & { said: string[] } {
  const said: string[] = [];
  const runner = (): Runner => (command, args) => {
    ran.push([command, ...args].join(" "));
    return { status: 0, stdout: "" };
  };
  return {
    said,
    ask: async () => answers.shift() ?? "",
    say: (text) => said.push(text),
    templatesDir,
    versions,
    runner,
    install: () => true,
    ci: false,
  };
}

const quiet = (folder: string): ServerSiteChoices => ({
  server: "cloudflare",
  folder,
  install: false,
  git: false,
  interactive: false,
});

describe("createServerSite", { timeout: 120_000 }, () => {
  it("makes the site from the options alone, without asking", async () => {
    const folder = join(dir, "acme");
    const given = io();
    await createServerSite(
      { ...quiet(folder), github: "acme/site", content: "acme/site-content", url: "https://www.acme.example/" },
      given,
    );
    expect(await readFile(join(folder, "wrangler.jsonc"), "utf8")).toContain("https://www.acme.example");
    expect(existsSync(join(folder, "content-repository/content/site.json"))).toBe(true);
    expect(given.said.join("\n")).toContain("Push the content to acme/site-content first, then the code to acme/site.");
  });

  it("asks for the repositories and the address, then offers to put the site online", async () => {
    const folder = join(dir, "acme");
    const ran: string[] = [];
    // The folder, the code's repository, the content's (the suggested one), no address yet, then yes to wrangler and
    // no to its first step.
    const given = io([folder, "https://github.com/acme/site", "", "", "", "n"], ran);
    await createServerSite({ ...quiet(""), folder: undefined, install: true, interactive: true }, given);
    expect(await readFile(join(folder, ".github/workflows/deploy.yml"), "utf8")).toContain(
      "repository: acme/site-content",
    );
    expect(ran).toEqual(["npx wrangler whoami"]);
    const said = given.said.join("\n");
    expect(said).toContain("Set the site's address in wrangler.jsonc");
    expect(said).toContain("Still to do");
  });

  it("never offers wrangler in CI", async () => {
    const ran: string[] = [];
    const given = { ...io([join(dir, "acme"), "acme/site", "", ""], ran), ci: true };
    await createServerSite({ ...quiet(""), folder: undefined, install: true, interactive: true }, given);
    expect(ran).toEqual([]);
  });

  it("refuses what a full-stack site can't be", async () => {
    const folder = join(dir, "acme");
    await expect(createServerSite({ ...quiet(folder), server: "vercel" }, io())).rejects.toThrow("--server takes");
    await expect(createServerSite({ ...quiet(folder), otherHost: "acme/site" }, io())).rejects.toThrow("GitHub");
    await expect(
      createServerSite({ ...quiet(folder), github: "acme/site", content: "acme/site" }, io()),
    ).rejects.toThrow("of its own");
    await expect(createServerSite({ ...quiet(folder), url: "http://acme.example" }, io())).rejects.toThrow(
      ScaffoldError,
    );
    expect(existsSync(folder)).toBe(false);
  });

  it("reads the site's address", () => {
    expect(siteAddress(" https://www.acme.example/ ")).toBe("https://www.acme.example");
    expect(() => siteAddress("www.acme.example")).toThrow(ScaffoldError);
    expect(() => siteAddress("https://acme.example/site/")).toThrow(ScaffoldError);
  });
});
