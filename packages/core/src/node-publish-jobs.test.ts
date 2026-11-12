import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { bitbucketPipelines } from "./bitbucket-setup.js";
import { cloudflareSetupFiles } from "./cloudflare-setup.js";
import { gitlabPagesPipelineJobs, PUBLISH_PATCH } from "./gitlab-publish.js";

const ROOT = join(import.meta.dirname, "../../..");

/** Tests that run git and Node processes, which can take seconds each on Windows while many tests run at once. */
const PROCESS_TIMEOUT = 180_000;

type Job = { script: string[]; artifacts?: { paths?: string[]; reports?: unknown }; environment?: { name: string } };

const jobs = parse(
  gitlabPagesPipelineJobs({ cli: "goodfellow", build: "npx goodfellow build", output: "dist", cachePaths: ".npm/" }),
) as Record<string, Job>;

describe("the GitLab publish job", () => {
  it("runs none of the site's code, and is the only job with the publishing key's environment", () => {
    const publish = jobs.publish;
    expect(publish?.environment?.name).toBe("goodfellow-publish");
    expect(publish?.script.join("\n")).not.toMatch(/\bnpm\b|\bnpx\b/);
    expect(jobs.prepare?.environment).toBeUndefined();
    expect(jobs.pages?.environment).toBeUndefined();
  });

  it("gets only files from the prepare job, never variables", () => {
    expect(jobs.prepare?.artifacts?.reports).toBeUndefined();
    expect(jobs.prepare?.artifacts?.paths).toContain(PUBLISH_PATCH);
  });

  it("is in every GitLab pipeline that publishes updates", async () => {
    for (const site of ["templates/starter", "templates/next", "examples/parish"]) {
      const pipeline = parse(await readFile(join(ROOT, site, ".gitlab-ci.yml"), "utf8")) as Record<string, Job>;
      expect(pipeline.publish?.script).toEqual(jobs.publish?.script);
      expect(JSON.stringify(pipeline)).not.toContain("update --publish");
      expect(JSON.stringify(pipeline)).not.toContain("CI_JOB_TOKEN}@");
    }
    const hook = parse(cloudflareSetupFiles({ git: "gitlab", next: false }).get(".gitlab-ci.yml") ?? "") as Record<
      string,
      Job
    >;
    expect(hook.publish?.environment?.name).toBe("goodfellow-publish");
    expect(JSON.stringify(hook)).not.toContain("update --publish");
  });
});

describe("the GitLab publish job's script", { timeout: PROCESS_TIMEOUT }, () => {
  let dir: string;
  let base: string;
  const git = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-publish-"));
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Test");
    git("config", "user.email", "test@example.org");
    await writeFile(join(dir, "package.json"), '{ "name": "site" }\n');
    await writeFile(join(dir, "goodfellow.config.tsx"), "export default {};\n");
    git("add", ".");
    git("commit", "-q", "-m", "Start");
    base = git("rev-parse", "HEAD");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  /** Commits `files` as the prepare job would, writes its patch, and runs the publish job's script at the start. */
  async function publish(files: Record<string, string>, env: Record<string, string> = {}) {
    for (const [path, text] of Object.entries(files)) await writeFile(join(dir, path), text);
    if (Object.keys(files).length > 0) {
      git("add", ".");
      git("commit", "-q", "-m", "Update");
    }
    const patch = git("format-patch", "--binary", "--stdout", `${base}..HEAD`);
    git("checkout", "-q", base);
    await writeFile(join(dir, PUBLISH_PATCH), patch ? `${patch}\n` : "");
    const script = jobs.publish?.script.join("\n") ?? "";
    return spawnSync("bash", ["-e", "-c", script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CI_COMMIT_SHA: base, CI_COMMIT_BRANCH: "main", GOODFELLOW_DEPLOY_KEY: "", ...env },
    });
  }

  it("publishes nothing when the prepare job committed nothing", async () => {
    const result = await publish({});
    expect(result.status).toBe(0);
    expect(git("rev-parse", "HEAD")).toBe(base);
  });

  it("refuses commits that change what an update never does", async () => {
    const result = await publish({
      "package.json": '{ "name": "site", "version": "2" }\n',
      "goodfellow.config.tsx": "x",
    });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("not published: goodfellow.config.tsx");
    expect(result.stdout).not.toContain("no key");
  });

  it("checks an update, then needs the key to publish it", async () => {
    const result = await publish({ "package.json": '{ "name": "site", "version": "2" }\n' });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("no key to publish with");
  });

  it("runs git and Node.js without the variables the pipeline was started with", async () => {
    const result = await publish(
      { "package.json": '{ "name": "site", "version": "2" }\n', "goodfellow.config.tsx": "x" },
      { NODE_OPTIONS: "--require ./missing.cjs", GIT_DIR: "/nowhere" },
    );
    expect(result.stdout).toContain("not published: goodfellow.config.tsx");
  });
});

describe("Bitbucket's publish step", { timeout: PROCESS_TIMEOUT }, () => {
  let dir: string;
  let origin: string;
  let base: string;
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };

  beforeEach(async () => {
    origin = await mkdtemp(join(tmpdir(), "goodfellow-bitbucket-origin-"));
    dir = await mkdtemp(join(tmpdir(), "goodfellow-bitbucket-"));
    git(origin, "init", "-q", "--bare", "-b", "main");
    git(dir, "init", "-q", "-b", "main");
    git(dir, "config", "user.name", "Test");
    git(dir, "config", "user.email", "test@example.org");
    await writeFile(join(dir, "package.json"), '{ "name": "site" }\n');
    await writeFile(join(dir, "goodfellow.config.tsx"), "export default {};\n");
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "Start");
    git(dir, "remote", "add", "origin", origin);
    git(dir, "push", "-q", "origin", "main");
    base = git(dir, "rev-parse", "HEAD");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
    await rm(origin, { recursive: true, force: true });
  });

  /** Commits `files` as the step before would, and runs the update pipeline's publish step at the start. */
  async function publish(files: Record<string, string>, decision = "false") {
    for (const [path, text] of Object.entries(files)) await writeFile(join(dir, path), text);
    git(dir, "add", ".");
    git(dir, "commit", "-q", "-m", "Update");
    const patch = git(dir, "format-patch", "--binary", "--stdout", `${base}..HEAD`);
    git(dir, "checkout", "-q", base);
    await writeFile(join(dir, PUBLISH_PATCH), `${patch}\n`);
    await writeFile(join(dir, "goodfellow-build.txt"), decision);
    const pipeline = parse(bitbucketPipelines("goodfellow")) as {
      pipelines: { custom: { update: Array<{ step?: { script: string[] } }> } };
    };
    const script = pipeline.pipelines.custom.update[2]?.step?.script.join("\n") ?? "";
    return spawnSync("bash", ["-e", "-c", script], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, BITBUCKET_COMMIT: base, BITBUCKET_BRANCH: "main", VERCEL_DEPLOY_HOOK: "" },
    });
  }

  it("publishes an update that changes only what an update does", async () => {
    const result = await publish({ "package.json": '{ "name": "site", "version": "2" }\n' });
    expect(result.status, result.stderr).toBe(0);
    expect(git(origin, "show", "main:package.json")).toContain('"version": "2"');
  });

  it("publishes nothing else the step before committed", async () => {
    const result = await publish({ "package.json": "{}\n", "goodfellow.config.tsx": "x" });
    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("not published: goodfellow.config.tsx");
    expect(git(origin, "rev-parse", "main")).toBe(base);
  });
});
