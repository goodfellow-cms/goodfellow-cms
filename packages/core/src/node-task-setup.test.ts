import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import {
  BITBUCKET_PIPELINE_NAMES,
  bitbucketCodeRebuildPipelines,
  bitbucketContentPipelines,
  bitbucketPipelines,
} from "./bitbucket-setup.js";
import { cloudflareSetupFiles } from "./cloudflare-setup.js";
import { contentBuildsFor, separateSetupFiles } from "./content-repository-setup.js";
import { CORE_RELEASE, LOCKFILE_REGISTRY_CHECK } from "./lockfile-setup.js";
import { netlifySetupFiles } from "./netlify-setup.js";
import { HOSTS, type Host } from "./site-setup.js";
import {
  GITLAB_TASK_RULE,
  githubTaskWorkflow,
  gitlabTaskJob,
  TASK_CORE_RELEASE,
  taskRunnerInstall,
  yamlItems,
} from "./task-setup.js";

const ROOT = join(import.meta.dirname, "../../..");
const read = (path: string) => readFile(join(ROOT, path), "utf8");

/** Where GitLab's jobs and Bitbucket's steps take commands. */
const SCRIPT_KEYS = new Set(["script", "before_script", "after_script", "after-script"]);
const PIPELINE = /(^|\/)(\.gitlab-ci|bitbucket-pipelines)\.yml$/;

describe("the starters' task setup", () => {
  it("runs plugins' tasks as the setups planned for new sites do", async () => {
    for (const [site, cli] of [
      ["templates/starter", "goodfellow"],
      ["examples/parish", "goodfellow"],
      ["templates/next", "goodfellow-next"],
    ] as const) {
      expect(await read(`${site}/.github/workflows/plugin-task.yml`)).toBe(githubTaskWorkflow(cli));
      const pipeline = await read(`${site}/.gitlab-ci.yml`);
      expect(pipeline).toContain(gitlabTaskJob(cli));
      expect(pipeline).toContain(GITLAB_TASK_RULE);
    }
  });

  it("loads the site's config with no secrets, and runs the task from Goodfellow's runner with none of the site's code", () => {
    const workflow = parse(githubTaskWorkflow("goodfellow"));
    expect(workflow.permissions).toEqual({});
    expect(workflow.on).toEqual({ repository_dispatch: { types: ["goodfellow-plugin-task"] } });
    for (const job of ["describe", "task"]) {
      expect(workflow.jobs[job].permissions).toEqual({ contents: "read" });
      expect(workflow.jobs[job].steps[0].with["persist-credentials"]).toBe(false);
    }
    const describe = JSON.stringify(workflow.jobs.describe);
    expect(describe).toContain("npx goodfellow task --describe");
    expect(describe).not.toContain("secrets");
    const task = JSON.stringify(workflow.jobs.task);
    expect(task).toContain("toJSON(secrets)");
    // Nothing of the site's runs where the secrets are: no npx, no install scripts, no cache it could have filled.
    expect(task).not.toContain("npx");
    expect(task).toContain("npm ci --ignore-scripts");
    expect(task).not.toContain("cache");
    expect(task).toContain("--registry=https://registry.npmjs.org/");
    expect(workflow.jobs.task.needs).toBe("describe");
    expect(workflow.jobs.answer.permissions).toEqual({ contents: "write" });
    const answerSteps = JSON.stringify(workflow.jobs.answer.steps);
    expect(answerSteps).not.toContain("npm");
    expect(answerSteps).not.toContain("checkout");
    // The request's fields reach the shell as variables, never written into its script.
    for (const job of Object.values(workflow.jobs) as { steps: { run?: string }[] }[]) {
      for (const step of job.steps) expect(String(step.run ?? "")).not.toContain("${{");
    }
  });

  it("writes every script line of every GitLab and Bitbucket pipeline as a string YAML reads back as written", async () => {
    const install = `release=$(node -e '${TASK_CORE_RELEASE}') || exit 1`;
    const pipelines = new Map<string, string>();
    for (const site of ["templates/starter", "templates/next", "examples/parish"]) {
      pipelines.set(`${site}/.gitlab-ci.yml`, await read(`${site}/.gitlab-ci.yml`));
    }
    for (const cli of ["goodfellow", "goodfellow-next"] as const) {
      pipelines.set(`gitlabTaskJob(${cli})`, gitlabTaskJob(cli));
      pipelines.set(`bitbucketPipelines(${cli})`, bitbucketPipelines(cli));
    }
    for (const build of ["code", "content"] as const) {
      pipelines.set(`bitbucketContentPipelines(${build})`, bitbucketContentPipelines(build));
    }
    pipelines.set("bitbucketCodeRebuildPipelines", bitbucketCodeRebuildPipelines("parish/content"));
    // Hosts that build the site themselves, whose GitLab setup is a pipeline of its own: one file each.
    const hookHosts = { cloudflare: cloudflareSetupFiles, netlify: netlifySetupFiles };
    const nexts = [false, true];
    for (const next of nexts) {
      for (const [hookHost, setupFiles] of Object.entries(hookHosts)) {
        for (const [path, text] of setupFiles({ git: "gitlab", next })) {
          if (PIPELINE.test(path)) pipelines.set(`${hookHost} ${path} (next: ${next})`, text);
        }
      }
      for (const git of ["github", "gitlab", "bitbucket"] as const) {
        for (const host of Object.keys(HOSTS) as Host[]) {
          if (host === "netlify" || (git === "bitbucket" && host !== "vercel")) continue;
          if ((git === "github" && host === "gitlab-pages") || (git === "gitlab" && host === "github-pages")) continue;
          for (const build of contentBuildsFor(host)) {
            const setup = separateSetupFiles({
              git,
              host,
              build,
              code: "parish/site",
              content: "parish/content",
              next,
            });
            for (const [side, files] of Object.entries(setup)) {
              for (const [path, text] of files) {
                if (PIPELINE.test(path)) pipelines.set(`${git} ${host} ${build} ${side} ${path} (next: ${next})`, text);
              }
            }
          }
        }
      }
    }
    const scripts: [string, unknown][] = [];
    const visit = (name: string, value: unknown) => {
      if (Array.isArray(value)) for (const item of value) visit(name, item);
      else if (value && typeof value === "object") {
        for (const [key, inner] of Object.entries(value)) {
          if (SCRIPT_KEYS.has(key)) scripts.push([name, inner]);
          else visit(name, inner);
        }
      }
    };
    for (const [name, text] of pipelines) visit(name, parse(text));
    const hookPipelines = [...pipelines.keys()].filter((name) =>
      Object.keys(hookHosts).some((hookHost) => name.startsWith(`${hookHost} `)),
    );
    expect(hookPipelines).toHaveLength(Object.keys(hookHosts).length * nexts.length);
    expect(scripts.length).toBeGreaterThan(40);
    for (const [name, script] of scripts) {
      // GitLab takes a string too; every pipeline here writes a list.
      expect(Array.isArray(script), `${name}: ${JSON.stringify(script)}`).toBe(true);
      for (const line of script as unknown[]) expect(typeof line, `${name}: ${JSON.stringify(line)}`).toBe("string");
    }
    // The line with `: ` in it, which GitLab refused as a key and its value.
    expect(parse(gitlabTaskJob("goodfellow"))["plugin-task"].script).toContain(install);
    const steps = parse(bitbucketPipelines("goodfellow")).pipelines.custom[BITBUCKET_PIPELINE_NAMES.task] as {
      step?: { name: string; script: string[] };
    }[];
    expect(steps.find((entry) => entry.step?.name === "Plugin task")?.step?.script).toContain(install);
  });

  it("writes YAML list items only at an indent of spaces", () => {
    expect(yamlItems(["a: b", `it's "here"`, "a\\b"], "  ")).toBe(`  - "a: b"\n  - 'it''s "here"'\n  - 'a\\b'`);
    for (const line of ["a: b # c", `it's "here": now`, "a\\nb", "'x'", `a\n"b"\n  c`, "a\nb", " lead", "end "])
      expect(parse(yamlItems([line], ""))).toEqual([line]);
    expect(() => yamlItems(["a"], "  - ")).toThrow();
    expect(() => taskRunnerInstall("/tmp/runner", "  - ")).toThrow();
  });

  it("keeps the GitLab task jobs to the pipelines the admin panel starts for tasks, the task's in its environment", () => {
    const jobs = parse(gitlabTaskJob("goodfellow"));
    expect(jobs["plugin-task-describe"].rules).toEqual([{ if: "$GOODFELLOW_TASK_PLUGIN" }]);
    expect(jobs["plugin-task-describe"].artifacts.paths).toEqual(["goodfellow-task.json"]);
    const job = jobs["plugin-task"];
    expect(job.rules).toEqual([{ if: "$GOODFELLOW_TASK_PLUGIN", when: "always" }]);
    expect(job.needs).toEqual(["plugin-task-describe"]);
    expect(job.environment).toEqual({ name: "goodfellow-tasks", action: "prepare" });
    expect(job.artifacts.paths).toEqual(["goodfellow-task-result.json"]);
    expect(JSON.stringify(job.script)).not.toContain("npx");
  });

  it("reads Bitbucket's task pipeline in steps that can't publish, and leaves the answer from one that runs none of the site's code", () => {
    const pipeline = parse(bitbucketPipelines("goodfellow")).pipelines.custom["plugin-task"];
    type Step = { script: string[]; artifacts?: string[]; auth?: { system: { scopes: string[] } } };
    const [describe, task, answer] = pipeline.slice(1).map((entry: { step: Step }) => entry.step) as Step[];
    expect(describe?.artifacts).toEqual(["goodfellow-task.json"]);
    expect(JSON.stringify(describe?.script)).toContain("npx goodfellow task --describe");
    expect(JSON.stringify(task?.script)).not.toContain("npx");
    expect(JSON.stringify(task?.script)).toContain("goodfellow-task.js");
    expect(task?.artifacts).toEqual(["goodfellow-task-result.json"]);
    // Only the step that runs none of the site's code may publish.
    expect(describe?.auth?.system.scopes).toEqual(["read:git:bitbucket"]);
    expect(task?.auth?.system.scopes).toEqual(["read:git:bitbucket"]);
    expect(answer?.auth?.system.scopes).toEqual(["read:git:bitbucket", "write:git:bitbucket"]);
    expect(JSON.stringify(answer?.script)).not.toMatch(/\bnpm\b|\bnpx\b|\bnode\b/);
    expect(JSON.stringify(answer?.script)).toContain("git push");
  });
});

describe("Bitbucket's lockfile step", () => {
  it("commits package-lock.json only once every new package comes from npm's registry, and leaves publishing it to a step of its own", () => {
    const [lockfile, publish] = parse(bitbucketPipelines("goodfellow")).pipelines.branches.main.map(
      (entry: { step: { script: string[]; auth: { system: { scopes: string[] } } } }) => entry.step,
    );
    const script = lockfile.script.join("\n") as string;
    const check = script.indexOf(LOCKFILE_REGISTRY_CHECK);
    expect(check).toBeGreaterThan(0);
    expect(check).toBeLessThan(script.indexOf("commit -m"));
    expect(script.slice(check + LOCKFILE_REGISTRY_CHECK.length)).toMatch(/^' \|\| exit 1/);
    expect(script).not.toContain("git push");
    expect(lockfile.auth.system.scopes).toEqual(["read:git:bitbucket"]);
    expect(publish.auth.system.scopes).toEqual(["read:git:bitbucket", "write:git:bitbucket"]);
    expect(publish.script.join("\n")).toContain("git push");
  });
});

describe("CORE_RELEASE", () => {
  const release = async (dependencies: Record<string, unknown>) => {
    const dir = await mkdtemp(join(tmpdir(), "goodfellow-core-release-"));
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify({ dependencies }));
      return execFileSync(process.execPath, ["-e", CORE_RELEASE], { cwd: dir, encoding: "utf8", stdio: "pipe" }).trim();
    } catch {
      return "refused";
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };

  it("names only releases from npm, so Goodfellow's commands never install what a site points them at", async () => {
    expect(await release({ "@goodfellow-cms/core": "^0.9.0" })).toBe("^0.9.0");
    expect(await release({ "@goodfellow-cms/core": "0.9.1-beta.2" })).toBe("0.9.1-beta.2");
    for (const spec of [
      "https://evil.example/core.tgz",
      "github:evil/core",
      "npm:evil@1.0.0",
      "file:../core",
      "latest",
      "^0.9.0 || https://evil.example/x.tgz",
    ]) {
      expect(await release({ "@goodfellow-cms/core": spec }), spec).toBe("refused");
    }
    expect(await release({})).toBe("refused");
  });
});

describe("TASK_CORE_RELEASE", () => {
  /** Runs the script in a site with `lock` as its lockfile, with npm's registry answering `time` for core. */
  const release = async (lock: unknown, time: Record<string, string> = { "0.9.3": "2026-10-01T12:00:00.000Z" }) => {
    const dir = await mkdtemp(join(tmpdir(), "goodfellow-task-core-"));
    try {
      if (lock !== undefined) await writeFile(join(dir, "package-lock.json"), JSON.stringify(lock));
      // npm's registry, as the job asks it: only for core's releases.
      await writeFile(
        join(dir, "registry.cjs"),
        'globalThis.fetch = async (url) => { if (url !== "https://registry.npmjs.org/@goodfellow-cms%2fcore") throw new Error("asked " + url); return { ok: true, json: async () => JSON.parse(process.env.PACKUMENT) }; };',
      );
      return execFileSync(process.execPath, ["-r", "./registry.cjs", "-e", TASK_CORE_RELEASE], {
        cwd: dir,
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, PACKUMENT: JSON.stringify({ time }) },
      }).trim();
    } catch {
      return "refused";
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  };
  const locked = (version: unknown) => ({
    lockfileVersion: 3,
    packages: { "": {}, "node_modules/@goodfellow-cms/core": { version } },
  });

  it("names the exact release the lockfile installs, and a day after npm published it", async () => {
    expect(await release(locked("0.9.3"))).toBe("0.9.3 2026-10-02T12:00:00.000Z");
  });

  it("refuses a site without a lockfile, a release npm didn't publish, or anything that isn't a release", async () => {
    expect(await release(undefined)).toBe("refused");
    expect(await release(locked("0.9.4"))).toBe("refused");
    for (const version of ["^0.9.3", "https://evil.example/core.tgz", "file:../core", undefined]) {
      expect(await release(locked(version)), String(version)).toBe("refused");
    }
  });
});
