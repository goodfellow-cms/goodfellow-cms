import { newTaskRequestId, openTaskAnswer, sealTaskAnswer, taskKeys } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { gitlabTasks } from "./tasks.js";
import { fakeGitLab } from "./testing.js";

const PIPELINE =
  "pages:\n  script: [npx goodfellow build]\n\nplugin-task:\n  rules:\n    - if: $GOODFELLOW_TASK_PLUGIN\n";

async function request() {
  const keys = await taskKeys();
  const sent = {
    id: newTaskRequestId(),
    plugin: "goodfellow-plugin-s3",
    task: "sign",
    input: JSON.stringify({ files: ["/media/sermon.mp4"] }),
    key: keys.publicKey,
  };
  return { keys, sent };
}

function setup(options: Parameters<typeof fakeGitLab>[0], token = "test-token") {
  const fake = fakeGitLab(options);
  const api = { apiUrl: "https://gitlab.com/api/v4", token: async () => token, canRefresh: false, fetch: fake.fetch };
  return { fake, api };
}

describe("plugins' tasks on GitLab", () => {
  it("start a pipeline with the request's variables and read the sealed answer from its job's artifacts", async () => {
    let variables: Record<string, string> = {};
    const { api } = setup({
      project: "parish/site",
      tasks: async (given) => {
        variables = given;
        return JSON.stringify(await sealTaskAnswer({ ok: true, output: "signed" }, given.GOODFELLOW_TASK_KEY ?? ""));
      },
    });
    const tasks = gitlabTasks(api, "parish/site", "main", async () => PIPELINE, { wait: async () => {} });
    expect(await tasks.supported()).toBe(true);
    const { keys, sent } = await request();
    expect(await openTaskAnswer(await tasks.run(sent), keys.privateKey)).toEqual({ ok: true, output: "signed" });
    expect(variables).toEqual({
      GOODFELLOW_TASK_REQUEST: sent.id,
      GOODFELLOW_TASK_PLUGIN: "goodfellow-plugin-s3",
      GOODFELLOW_TASK_NAME: "sign",
      GOODFELLOW_TASK_INPUT: sent.input,
      GOODFELLOW_TASK_KEY: sent.key,
    });
  });

  it("say when the setup can't run them, the job fails, or the sign-in can't start pipelines", async () => {
    const { sent } = await request();
    const failing = setup({ project: "parish/site" });
    await expect(
      gitlabTasks(failing.api, "parish/site", "main", async () => "pages:\n").run(sent),
    ).rejects.toMatchObject({
      problem: "missing",
    });
    await expect(
      gitlabTasks(failing.api, "parish/site", "main", async () => PIPELINE, { wait: async () => {} }).run(sent),
    ).rejects.toMatchObject({ problem: "failed" });
    const reporter = setup(
      { project: "parish/site", tokens: { reporter: { username: "reporter", accessLevel: 20 } } },
      "reporter",
    );
    await expect(
      gitlabTasks(reporter.api, "parish/site", "main", async () => PIPELINE).run(sent),
    ).rejects.toMatchObject({
      problem: "not-allowed",
    });
  });
});
