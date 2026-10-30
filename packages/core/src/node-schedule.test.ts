import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeBuildRecord, serializeContent } from "./index.js";
import { reportDue, scheduleDue } from "./node-schedule.js";

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function site(): Promise<string> {
  root = await mkdtemp(join(tmpdir(), "goodfellow-due-"));
  await mkdir(join(root, "content/pages"), { recursive: true });
  await writeFile(
    join(root, "content/site.json"),
    serializeContent({ version: 1, title: "Parish", timeZone: "Europe/London" }),
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

describe("the hourly check", () => {
  it("says a build is due when a change came due since the last check, and when the next one is", async () => {
    const dir = await site();
    const output = join(dir, "output");
    await writeFile(output, "");
    const due = await scheduleDue({ root: dir, since: "2026-11-29T08:17:00Z", now: new Date("2026-11-29T09:17:00Z") });
    expect(await reportDue(due, { GITHUB_OUTPUT: output })).toEqual([
      "Scheduled changes came due since 2026-11-29T08:17:00.000Z, so the site is built again:",
      '  show "Advent" (/advent) at 2026-11-29T09:00 (Europe/London)',
    ]);
    expect(await readFile(output, "utf8")).toBe("due=true\n");

    // Without a last check, the last hour; the next change is listed.
    const quiet = await scheduleDue({ root: dir, since: "not a time", now: new Date("2026-11-01T12:00:00Z") });
    expect(quiet.since.toISOString()).toBe("2026-11-01T11:00:00.000Z");
    expect(await reportDue(quiet, {})).toEqual([
      "No scheduled change came due since 2026-11-01T11:00:00.000Z, so the site isn't built again.",
      'Next scheduled change: show "Advent" (/advent) at 2026-11-29T09:00 (Europe/London)',
    ]);
  });

  it("says a build is due the first check after the live site's build record says it stops being current", async () => {
    const dir = await site();
    await writeFile(
      join(dir, "content/site.json"),
      serializeContent({ version: 1, title: "Parish", url: "https://parish.example.org/", timeZone: "Europe/London" }),
    );
    const asked: string[] = [];
    const fetch = (async (url: string) => {
      asked.push(url);
      return new Response(
        serializeBuildRecord({
          version: 1,
          goodfellow: "1.2.3",
          builtAt: "2026-11-01T04:17:00Z",
          currentUntil: "2026-11-02T00:00:00.000Z",
        }),
      );
    }) as typeof globalThis.fetch;
    const output = join(dir, "output");
    await writeFile(output, "");
    const due = await scheduleDue({
      root: dir,
      since: "2026-11-01T23:47:00Z",
      now: new Date("2026-11-02T00:47:00Z"),
      fetch,
    });
    expect(asked).toEqual(["https://parish.example.org/goodfellow-build.json"]);
    expect(due.dated).toBe("2026-11-02T00:00:00.000Z");
    expect((await reportDue(due, { GITHUB_OUTPUT: output }))[0]).toBe(
      "What the live site shows by today's date changed at 2026-11-02T00:00:00.000Z, so the site is built again.",
    );
    expect(await readFile(output, "utf8")).toBe("due=true\n");

    // Only once: an hour later it isn't tried again, in case that build didn't work.
    const later = await scheduleDue({
      root: dir,
      since: "2026-11-02T00:47:00Z",
      now: new Date("2026-11-02T01:47:00Z"),
      fetch,
    });
    expect(later.dated).toBeUndefined();

    // The first check, with none before it, looks back to when the live site was built.
    const first = await scheduleDue({ root: dir, now: new Date("2026-11-02T00:47:00Z"), fetch });
    expect(first.since.toISOString()).toBe("2026-11-01T04:17:00.000Z");

    // A copy, such as staging, reads its own build record.
    asked.length = 0;
    await scheduleDue({
      root: dir,
      since: "2026-11-01T23:47:00Z",
      now: new Date("2026-11-02T00:47:00Z"),
      fetch,
      env: { GOODFELLOW_SITE_URL: "https://staging.parish.example.org/" },
    });
    expect(asked).toEqual(["https://staging.parish.example.org/goodfellow-build.json"]);
  });
});
