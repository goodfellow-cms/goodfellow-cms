// The repository's own Claude review workflow (.github/workflows/claude-review.yml): the steps that keep the review
// to reading, run with bash as the runner would.
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

/** A repository with two commits, and the review's git made by the workflow's step, run in it. */
function setUp(before: (repo: string) => void = () => {}) {
  const runner = temp();
  const output = join(runner, "path");
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
  before(repo);
  const made = sh("bash", ["-eo", "pipefail", "-c", script("Keep git to reading")], repo, {
    RUNNER_TEMP: runner,
    GITHUB_PATH: output,
  });
  expect(made.status, made.stderr).toBe(0);
  const bin = readFileSync(output, "utf8").trim();
  const review = (...args: string[]) => sh(join(bin, "git"), args, repo);
  return { repo, git, review, reviewGit: join(bin, "git"), marker: join(runner, "ran") };
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
      ["diff", "HEAD~1", "HEAD", "--orderfile=/proc/self/environ"],
      ["diff", "--orderf=../outside"],
      ["diff", "-O/etc/passwd"],
      ["diff", "-pO/etc/passwd"],
      ["blame", "--ignore-revs-file=/etc/passwd", "a.txt"],
      ["blame", "-S/proc/self/environ", "a.txt"],
      ["blame", "-S", "/proc/self/environ", "a.txt"],
      ["diff", `${repo}/../outside`],
      // Git's own options first, which only the action's own git uses, would skip every check.
      ["--no-pager", "diff", "--output=x", "HEAD"],
      ["-c", "core.fsmonitor=x", "diff"],
    ]) {
      const result = review(...args);
      expect(result.status, args.join(" ")).toBe(2);
      expect(result.stderr).toContain("a review can't use");
    }
    expect(readFileSync(join(repo, ".git", "config"), "utf8")).not.toContain("two");
    // Ranges are fine, ".." and all, as are paths in the checkout however they're written, and git's own
    // options that only start like a refused one.
    expect(review("diff", "HEAD~1..HEAD").status).toBe(0);
    for (const args of [
      ["diff", "HEAD~1", "HEAD", "--", join(repo, "a.txt")],
      ["blame", join(repo, "a.txt")],
      ["diff", "--text", "HEAD~1", "HEAD"],
      ["log", "-L/two/,+1:a.txt", "-1"],
    ]) {
      const result = review(...args);
      expect(result.status, `${args.join(" ")}: ${result.stderr}`).toBe(0);
    }
    // Anything else still goes to git as it is, git's options first and all.
    expect(review("-c", "core.quotePath=false", "rev-parse", "HEAD").status).toBe(0);
  });

  it("refuses to run in a repository other than the checkout, whose config would be its own", () => {
    const { repo, reviewGit, marker } = setUp();
    const nested = join(repo, "nested");
    sh("git", ["init", "-q", nested], repo);
    const program = join(repo, "..", "nested-filter.sh");
    writeFileSync(program, `#!/bin/sh\ntouch '${marker}'\ncat\n`, { mode: 0o755 });
    writeFileSync(join(nested, ".gitattributes"), "* filter=evil\n");
    writeFileSync(join(nested, "b.txt"), "one\n");
    sh("git", ["add", "."], nested);
    sh("git", ["config", "filter.evil.clean", program], nested);
    writeFileSync(join(nested, "b.txt"), "two\n");
    const result = sh(reviewGit, ["diff"], nested);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("a repository other than the checkout");
    expect(existsSync(marker)).toBe(false);
  });

  it("never runs a filter driver the system's or the user's config names", () => {
    const { repo, reviewGit, marker } = setUp();
    const program = join(repo, "..", "filter.sh");
    writeFileSync(program, `#!/bin/sh\ntouch '${marker}'\ncat\n`, { mode: 0o755 });
    const global = join(repo, "..", "global.gitconfig");
    writeFileSync(global, `[filter "evil"]\n\tclean = ${program}\n`);
    writeFileSync(join(repo, ".gitattributes"), "*.txt filter=evil\n");
    writeFileSync(join(repo, "a.txt"), "three\n");
    const run = (command: string) => sh(command, ["diff"], repo, { GIT_CONFIG_GLOBAL: global });
    run(reviewGit);
    expect(existsSync(marker)).toBe(false);
    run("git");
    expect(existsSync(marker)).toBe(true);
  });

  it("takes links that lead outside the checkout out of it, and keeps the rest", () => {
    const { repo, git } = setUp((repo) => {
      symlinkSync("/etc/hostname", join(repo, "out"));
      symlinkSync("out", join(repo, "chain"));
      symlinkSync("a.txt", join(repo, "in"));
      symlinkSync("round", join(repo, "round"));
      symlinkSync("nothing-here", join(repo, "missing"));
      sh("git", ["add", "."], repo);
      sh("git", ["commit", "-qm", "links"], repo);
    });
    expect(existsSync(join(repo, "in"))).toBe(true);
    // So do ones that lead nowhere, round in a loop or to a missing file, without stopping the step.
    for (const link of ["out", "chain", "round", "missing"]) expect(() => lstatSync(join(repo, link))).toThrow();
    // Git still has them, so the change reads as it was.
    expect(git("status", "--porcelain").stdout).toBe("");
  });
});

describe("the Claude review's file tools", () => {
  const review = steps.find((step) => step.name === "Review") as { with?: Record<string, string> };

  it("never read outside the checkout, whatever their rules allow", () => {
    expect(JSON.parse(review.with?.settings ?? "{}")).toMatchObject({
      permissions: { blockReadsOutsideWorkingDirectories: true },
    });
  });

  it("never read Claude Code's own settings and state, which hold what the job signs in with", () => {
    const denied = /--disallowedTools "([^"]*)"/.exec(review.with?.claude_args ?? "")?.[1]?.split(",") ?? [];
    expect(denied).toEqual(
      expect.arrayContaining([
        "Read(~/.claude/**)",
        "Read(~/.claude.json)",
        "Read(~/.claude.json.*)",
        "Read(//proc/**)",
      ]),
    );
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
      // A header without a type, {"alg":"HS256"}, is as short as a JWT's gets.
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJlLWJ5dGVz",
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
