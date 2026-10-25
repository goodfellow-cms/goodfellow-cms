import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
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

  it("runs the site's code with a token that can only read, and leaves the answer with a job that runs none of it", () => {
    const workflow = parse(githubTaskWorkflow("goodfellow"));
    expect(workflow.permissions).toEqual({});
    expect(workflow.on).toEqual({ repository_dispatch: { types: ["goodfellow-plugin-task"] } });
    expect(workflow.jobs.task.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.task.steps[0].with["persist-credentials"]).toBe(false);
    expect(workflow.jobs.answer.permissions).toEqual({ contents: "write" });
    const answerSteps = JSON.stringify(workflow.jobs.answer.steps);
    expect(answerSteps).not.toContain("npm");
    expect(answerSteps).not.toContain("checkout");
    // The request's fields reach the shell as variables, never written into its script.
    for (const step of [...workflow.jobs.task.steps, ...workflow.jobs.answer.steps]) {
      expect(String(step.run ?? "")).not.toContain("${{");
    }
  });

  it("keeps the GitLab task job to the pipelines the admin panel starts for tasks", () => {
    const job = parse(gitlabTaskJob("goodfellow"))["plugin-task"];
    expect(job.rules).toEqual([{ if: "$GOODFELLOW_TASK_PLUGIN" }]);
    expect(job.artifacts.paths).toEqual(["goodfellow-task-result.json"]);
  });
});
