import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { bitbucketPipelines } from "./bitbucket-setup.js";
import { CORE_RELEASE } from "./lockfile-setup.js";
import { GITLAB_TASK_RULE, githubTaskWorkflow, gitlabTaskJob } from "./task-setup.js";

const ROOT = join(import.meta.dirname, "../../..");
const read = (path: string) => readFile(join(ROOT, path), "utf8");

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

  it("reads Bitbucket's task pipeline as two steps, the second running none of the site's code", () => {
    const pipeline = parse(bitbucketPipelines("goodfellow")).pipelines.custom["plugin-task"];
    const [describe, task] = pipeline.slice(1).map((entry: { step: { script: string[] } }) => entry.step);
    expect(describe.artifacts).toEqual(["goodfellow-task.json"]);
    expect(JSON.stringify(describe.script)).toContain("npx goodfellow task --describe");
    expect(JSON.stringify(task.script)).not.toContain("npx");
    expect(JSON.stringify(task.script)).toContain("goodfellow-task.js");
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
