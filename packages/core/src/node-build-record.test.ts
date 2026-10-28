import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { changesOn, parseBuildRecord, resetDateChanges } from "./build-record.js";
import { loadSiteContent, serializeContent } from "./index.js";
import { currentUntil, reportDatesTo, reportedDate, writeBuildRecord } from "./node-build-record.js";
import { fileSystemSource } from "./node-fs-source.js";

let root: string | undefined;
afterEach(async () => {
  resetDateChanges();
  if (root) await rm(root, { recursive: true, force: true });
});

async function site(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "goodfellow-record-"));
  await mkdir(join(root, "content/pages"), { recursive: true });
  await writeFile(
    join(root, "content/site.json"),
    serializeContent({ version: 1, title: "Parish", timeZone: "America/New_York" }),
  );
  await writeFile(
    join(root, "content/pages/index.json"),
    serializeContent({ version: 1, data: { root: { props: { title: "Home" } } } }),
  );
  await writeFile(
    join(root, "content/pages/advent.json"),
    serializeContent({ version: 1, showFrom: "2026-11-29T09:00", data: { root: { props: { title: "Advent" } } } }),
  );
  return root;
}

const git = (cwd: string, ...args: string[]) => spawnSync("git", args, { cwd, encoding: "utf8" });

/** Tests that run git, each start of which can take seconds on Windows while many tests run at once, so a test can take a minute. */
const GIT_TIMEOUT = 180_000;

describe("currentUntil", () => {
  it("is the earliest date reported, at midnight in the site's time zone, or the next scheduled change", async () => {
    const content = await loadSiteContent(fileSystemSource(await site()));
    const now = new Date("2026-11-01T12:00:00Z");
    expect(currentUntil(content, now, undefined)?.toISOString()).toBe("2026-11-29T14:00:00.000Z");
    expect(currentUntil(content, now, "2026-11-02")?.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    // Once the scheduled change is past, only the dates are left.
    expect(currentUntil(content, new Date("2026-12-01T00:00:00Z"), undefined)).toBeUndefined();
  });
});

describe("writeBuildRecord", { timeout: GIT_TIMEOUT }, () => {
  it("writes what the site was built from and when it stops being current", async () => {
    const dir = await site();
    git(dir, "init", "-q");
    git(dir, "-c", "user.name=Test", "-c", "user.email=test@example.org", "commit", "-q", "--allow-empty", "-m", "x");
    const commit = git(dir, "rev-parse", "HEAD").stdout.trim();
    const out = join(dir, "dist");
    await mkdir(out);
    changesOn("2026-11-05");
    const record = await writeBuildRecord(out, {
      root: dir,
      content: await loadSiteContent(fileSystemSource(dir)),
      now: new Date("2026-11-01T12:00:00Z"),
      env: {},
    });
    expect(record).toMatchObject({
      version: 1,
      commit,
      builtAt: "2026-11-01T12:00:00.000Z",
      currentUntil: "2026-11-05T05:00:00.000Z",
    });
    expect(parseBuildRecord(await readFile(join(out, "goodfellow-build.json"), "utf8"))).toEqual(record);
  });
});

describe("dates from several processes", () => {
  it("are each written to a file, and read back as the earliest", async () => {
    const dir = await site();
    const folder = join(dir, ".next/goodfellow-dates");
    expect(await reportedDate(folder)).toBeUndefined();
    const stop = reportDatesTo(folder);
    changesOn("2026-12-01");
    changesOn("2026-11-10");
    stop();
    await writeFile(join(folder, "1.txt"), "2026-11-20");
    await writeFile(join(folder, "2.txt"), "not a date");
    expect(await reportedDate(folder)).toBe("2026-11-10");
  });
});
