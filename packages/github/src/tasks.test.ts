import { newTaskRequestId, openTaskAnswer, sealTaskAnswer, taskKeys } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { githubTasks } from "./tasks.js";
import { fakeGitHub } from "./testing.js";

const workflow = { ".github/workflows/plugin-task.yml": "name: Plugin task\n" };

async function request() {
  const keys = await taskKeys();
  return {
    keys,
    request: {
      id: newTaskRequestId(),
      plugin: "goodfellow-plugin-s3",
      task: "sign",
      input: JSON.stringify({ files: ["/media/sermon.mp4"] }),
      key: keys.publicKey,
    },
  };
}

describe("plugins' tasks on GitHub", () => {
  it("start the task workflow, read its sealed answer from its branch, and delete the branch", async () => {
    const fake = fakeGitHub({
      repo: "parish/site",
      files: workflow,
      tasks: async (payload) =>
        JSON.stringify(await sealTaskAnswer({ ok: true, output: { got: JSON.parse(payload.input) } }, payload.key)),
    });
    const tasks = githubTasks(
      { apiUrl: "https://api.github.com", token: "test-token", fetch: fake.fetch },
      "parish/site",
      "main",
      {
        wait: async () => {},
      },
    );
    expect(await tasks.supported()).toBe(true);
    const { keys, request: sent } = await request();
    const text = await tasks.run(sent);
    expect(await openTaskAnswer(text, keys.privateKey)).toEqual({
      ok: true,
      output: { got: { files: ["/media/sermon.mp4"] } },
    });
    expect(fake.dispatches).toEqual([
      {
        event_type: "goodfellow-plugin-task",
        client_payload: {
          request: sent.id,
          plugin: "goodfellow-plugin-s3",
          task: "sign",
          input: sent.input,
          key: sent.key,
        },
      },
    ]);
    // The answer's branch is gone once it's read.
    expect([...fake.repo.branches.keys()]).toEqual(["main"]);
  });

  it("say when the site's setup can't run them, or the workflow never answers", async () => {
    const none = fakeGitHub({ repo: "parish/site" });
    const api = (fake: ReturnType<typeof fakeGitHub>) => ({
      apiUrl: "https://api.github.com",
      token: "test-token",
      fetch: fake.fetch,
    });
    const { request: sent } = await request();
    await expect(githubTasks(api(none), "parish/site", "main").run(sent)).rejects.toMatchObject({ problem: "missing" });

    const silent = fakeGitHub({ repo: "parish/site", files: workflow });
    const tasks = githubTasks(api(silent), "parish/site", "main", { wait: async () => {}, timeoutMs: 0 });
    await expect(tasks.run(sent)).rejects.toMatchObject({ problem: "timeout" });
  });

  it("need a sign-in that can publish, as sending the event does", async () => {
    const fake = fakeGitHub({
      repo: "parish/site",
      files: workflow,
      tokens: { reader: { login: "reader", push: false } },
    });
    const tasks = githubTasks(
      { apiUrl: "https://api.github.com", token: "reader", fetch: fake.fetch },
      "parish/site",
      "main",
    );
    const { request: sent } = await request();
    await expect(tasks.run(sent)).rejects.toMatchObject({ problem: "not-allowed" });
  });
});
