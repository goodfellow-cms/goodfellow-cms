import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type BuildRecord, serializeBuildRecord } from "./build-record.js";
import { serializeContent, VERSION_PACKAGE } from "./index.js";
import { nightlyCheck, reportNightly } from "./node-nightly.js";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });

/** A site on Goodfellow 1.2.3, in a git repository of its own, and its commit. */
async function site(): Promise<{ dir: string; commit: string }> {
  root = await mkdtemp(join(tmpdir(), "goodfellow-nightly-"));
  const dir = root;
  await mkdir(join(dir, "content"), { recursive: true });
  await writeFile(
    join(dir, "content/site.json"),
    serializeContent({ version: 1, title: "Parish", url: "https://parish.example.org/" }),
  );
  await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies: { [VERSION_PACKAGE]: "1.2.3" } }));
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.org", "commit", "-q", "-m", "x");
  return { dir, commit: git(dir, "rev-parse", "HEAD").stdout.trim() };
}

/** The live site, answering with `record`, or nothing. */
function live(record: BuildRecord | undefined): typeof fetch {
  return (async () =>
    record ? new Response(serializeBuildRecord(record)) : new Response("Not found", { status: 404 })) as typeof fetch;
}

const releases =
  (...versions: string[]) =>
  async () => ({ versions: Object.fromEntries(versions.map((version) => [version, {}])) });

const now = new Date("2026-11-02T04:17:00Z");

/** Tests that run git, which can take seconds to start on Windows while many tests run at once. */
const GIT_TIMEOUT = 60_000;

describe("nightlyCheck", { timeout: GIT_TIMEOUT }, () => {
  it("builds only when something has changed since the live site was built", async () => {
    const { dir, commit } = await site();
    const built = { version: 1 as const, goodfellow: "1.2.3", commit, builtAt: "2026-11-01T04:17:00Z" };
    const check = (record: BuildRecord | undefined, versions = ["1.2.3"], mode?: string) =>
      nightlyCheck({ root: dir, now, env: {}, fetch: live(record), fetchJson: releases(...versions), mode });

    expect(await check(built)).toMatchObject({ build: false, update: false, reasons: ["current"], mode: "changed" });
    // Something it shows by today's date changed, or will tomorrow.
    expect(await check({ ...built, currentUntil: "2026-11-02T00:00:00Z" })).toMatchObject({
      build: true,
      update: false,
      reasons: ["dated"],
    });
    expect((await check({ ...built, currentUntil: "2026-11-03T00:00:00Z" })).build).toBe(false);
    // The live site isn't the newest build, such as after one that didn't work.
    expect((await check({ ...built, commit: "b".repeat(40) })).reasons).toEqual(["changed"]);
    // Its record can't be read.
    expect((await check(undefined)).reasons).toEqual(["no-record"]);
    // A fix to install, which the update job builds.
    expect(await check(built, ["1.2.3", "1.2.4"])).toMatchObject({
      build: true,
      update: true,
      reasons: ["update"],
      release: "1.2.4",
    });

    // The site's setting: every night, or never.
    expect(await check(built, ["1.2.3"], "always")).toMatchObject({ build: true, reasons: ["always"] });
    expect(await check(built, ["1.2.3", "1.2.4"], "off")).toMatchObject({ build: false, update: false });
  });

  it("reads a copy's build record from the copy's own address", async () => {
    const { dir, commit } = await site();
    const asked: string[] = [];
    const record = { version: 1 as const, goodfellow: "1.2.3", commit, builtAt: "2026-11-01T04:17:00Z" };
    const fetcher = (async (url: string | URL) => {
      asked.push(String(url));
      return new Response(serializeBuildRecord(record));
    }) as typeof fetch;
    const env = { GOODFELLOW_SITE_URL: "https://staging.parish.example.org" };
    expect((await nightlyCheck({ root: dir, now, env, fetch: fetcher, fetchJson: releases("1.2.3") })).build).toBe(
      false,
    );
    expect(asked).toEqual(["https://staging.parish.example.org/goodfellow-build.json"]);
  });

  it("leaves updates out where content/updates.json turns them off", async () => {
    const { dir, commit } = await site();
    await writeFile(join(dir, "content/updates.json"), serializeContent({ version: 1, automatic: false, skip: [] }));
    const result = await nightlyCheck({
      root: dir,
      now,
      env: {},
      fetch: live({ version: 1, goodfellow: "1.2.3", commit, builtAt: "2026-11-01T04:17:00Z" }),
      fetchJson: releases("1.2.3", "1.2.4"),
    });
    expect(result).toMatchObject({ build: false, update: false });
  });
});

describe("reportNightly", () => {
  it("says what it found, and gives the build and update outputs", async () => {
    const { dir } = await site();
    const output = join(dir, "nightly.env");
    const lines = await reportNightly(
      { build: true, update: true, reasons: ["dated", "update"], mode: "changed", release: "1.2.4" },
      output,
    );
    expect(lines).toEqual([
      "Building the site tonight: something it shows by today's date has changed since it was built, and an update is available.",
      "Goodfellow 1.2.4 is installed first, if the site still builds with it.",
    ]);
    expect(await readFile(output, "utf8")).toBe("build=true\nupdate=true\n");
  });
});
