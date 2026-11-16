// The repository's own Claude review workflow (.github/workflows/claude-review.yml): the steps that keep the review
// to reading, run with bash as the runner would.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const workflow = join(import.meta.dirname, "../../../.github/workflows/claude-review.yml");
const steps = (parse(readFileSync(workflow, "utf8")).jobs.review.steps ?? []) as { name?: string; run?: string }[];
const script = (name: string) => steps.find((step) => step.name === name)?.run ?? "";

const dirs: string[] = [];
afterEach(() => {
  for (const made of dirs.splice(0)) rmSync(made, { recursive: true, force: true });
});
function temp() {
  const dir = mkdtempSync(join(tmpdir(), "claude-review-"));
  dirs.push(dir);
  return dir;
}

function sh(command: string, args: string[], cwd: string, env: Record<string, string> = {}) {
  return spawnSync(command, args, { cwd, encoding: "utf8", env: { ...process.env, ...env } });
}

/** A repository with two commits, and the review's git made by the workflow's step. */
function setUp() {
  const runner = temp();
  const output = join(runner, "path");
  const made = sh("bash", ["-eo", "pipefail", "-c", script("Keep git to reading")], runner, {
    RUNNER_TEMP: runner,
    GITHUB_PATH: output,
  });
  expect(made.status, made.stderr).toBe(0);
  const bin = readFileSync(output, "utf8").trim();
  const repo = temp();
  const git = (...args: string[]) => sh("git", args, repo);
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.org");
  git("config", "user.name", "Test");
  writeFileSync(join(repo, "a.txt"), "one\n");
  git("add", ".");
  git("commit", "-qm", "one");
  writeFileSync(join(repo, "a.txt"), "two\n");
  git("commit", "-qam", "two");
  const review = (...args: string[]) => sh(join(bin, "git"), args, repo);
  return { repo, git, review, marker: join(runner, "ran") };
}

describe.skipIf(process.platform === "win32")("the Claude review's git", () => {
  it("reads as git does", () => {
    const { review } = setUp();
    const diff = review("diff", "HEAD~1", "HEAD");
    expect(diff.status, diff.stderr).toBe(0);
    expect(diff.stdout).toContain("+two");
    expect(review("log", "--oneline", "HEAD~1..HEAD").stdout).toContain("two");
    expect(review("show", "--stat", "HEAD").stdout).toContain("a.txt");
    expect(review("blame", "a.txt").stdout).toContain("two");
    // Anything else goes to git as it is, as the action's own git does.
    expect(review("rev-parse", "--is-inside-work-tree").stdout.trim()).toBe("true");
  });

  it("never starts a program the repository's config names", () => {
    const { repo, git, review, marker } = setUp();
    const program = join(repo, "..", "program.sh");
    writeFileSync(program, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o755 });
    git("config", "core.fsmonitor", program);
    git("config", "diff.external", program);
    writeFileSync(join(repo, "a.txt"), "three\n");
    review("diff");
    review("show", "HEAD");
    review("log", "-p", "-1");
    expect(existsSync(marker)).toBe(false);
    // Plain git runs it, which is what the review's git prevents.
    git("diff");
    expect(existsSync(marker)).toBe(true);
  });

  it("refuses options that write files or read outside the repository, however they're shortened", () => {
    const { repo, review } = setUp();
    for (const args of [
      ["show", "-s", "--format=%B", "--output=.git/config", "HEAD"],
      ["show", "--outp=.git/config", "HEAD"],
      ["diff", "--output", "x", "HEAD"],
      ["diff", "--ext-diff", "HEAD"],
      ["log", "--textconv", "-p"],
      ["diff", "--no-index", "a.txt", "b.txt"],
      ["diff", "--no-in", "a.txt", "b.txt"],
      ["blame", "--contents", "/etc/hostname", "a.txt"],
      ["diff", "/proc/self/environ", "a.txt"],
      ["diff", "../outside", "a.txt"],
      ["diff", "--", "sub/../../outside"],
      ["diff", "~/.bashrc", "a.txt"],
      ["diff", ".."],
    ]) {
      const result = review(...args);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stderr).toContain("a review can't use");
    }
    expect(readFileSync(join(repo, ".git", "config"), "utf8")).not.toContain("two");
    // Ranges are fine, ".." and all.
    expect(review("diff", "HEAD~1..HEAD").status).toBe(0);
  });
});

describe("the Claude review's findings", () => {
  function withheld(findings: unknown) {
    const runner = temp();
    const output = join(runner, "output");
    const result = sh("bash", ["-eo", "pipefail", "-c", script("Withhold anything like a token")], runner, {
      FINDINGS: JSON.stringify(findings),
      GITHUB_OUTPUT: output,
      GITHUB_RUN_ID: "1",
    });
    expect(result.status, result.stderr).toBe(0);
    const text = readFileSync(output, "utf8");
    return JSON.parse(text.slice(text.indexOf("\n") + 1, text.lastIndexOf("FINDINGS_1")));
  }

  it.skipIf(process.platform === "win32")("withholds anything shaped like a token before it's posted", () => {
    const tokens = [
      `sk-ant-oat01-${"A".repeat(40)}`,
      `ghs_${"b".repeat(36)}`,
      `github_pat_${"C".repeat(40)}`,
      `eyJ${"d".repeat(30)}.${"e".repeat(30)}.${"f".repeat(20)}`,
    ];
    const found = withheld({
      findings: tokens.map((token, line) => ({ path: "a.ts", line: line + 1, body: `The token is ${token}.` })),
    });
    for (const finding of found.findings) {
      expect(finding.body).toBe("The token is [withheld: looked like a token].");
    }
    // Everything else is as the review wrote it.
    const plain = { findings: [{ path: "a.ts", line: 3, body: "Missing `await` on `ghost_task()` in sk-ant docs." }] };
    expect(withheld(plain)).toEqual(plain);
  });
});
