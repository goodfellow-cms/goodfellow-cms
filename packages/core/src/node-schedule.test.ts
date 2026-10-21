import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeContent } from "./index.js";
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
});
