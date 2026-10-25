import { describe, expect, it } from "vitest";
import {
  isTaskRequestId,
  newTaskRequestId,
  openTaskAnswer,
  PluginTaskError,
  sealTaskAnswer,
  taskKeys,
  taskRequestProblem,
} from "./plugin-tasks.js";

describe("tasks' answers", () => {
  it("are sealed to the request's key, and only that key opens them", async () => {
    const keys = await taskKeys();
    expect(JSON.parse(keys.publicKey)).not.toHaveProperty("d");
    const sealed = await sealTaskAnswer({ ok: true, output: { urls: ["https://bucket.example/a"] } }, keys.publicKey);
    expect(JSON.stringify(sealed)).not.toContain("bucket.example");
    expect(await openTaskAnswer(JSON.stringify(sealed), keys.privateKey)).toEqual({
      ok: true,
      output: { urls: ["https://bucket.example/a"] },
    });
    const other = await taskKeys();
    await expect(openTaskAnswer(JSON.stringify(sealed), other.privateKey)).rejects.toThrow(PluginTaskError);
  });

  it("say when the task couldn't run at all", async () => {
    const keys = await taskKeys();
    await expect(openTaskAnswer('{"version":1,"failed":true}', keys.privateKey)).rejects.toThrow(
      "The site's build service couldn't run the task.",
    );
    await expect(openTaskAnswer("not json", keys.privateKey)).rejects.toThrow(PluginTaskError);
  });
});

describe("tasks' requests", () => {
  it("are checked before anything runs them", async () => {
    const { publicKey } = await taskKeys();
    const id = newTaskRequestId();
    expect(isTaskRequestId(id)).toBe(true);
    const request = { id, plugin: "goodfellow-plugin-s3", task: "sign", input: "{}", key: publicKey };
    expect(taskRequestProblem(request)).toBeUndefined();
    expect(taskRequestProblem({ ...request, id: "../main" })).toBeDefined();
    expect(taskRequestProblem({ ...request, plugin: "x; rm -rf /" })).toBeDefined();
    expect(taskRequestProblem({ ...request, task: "Sign" })).toBeDefined();
    expect(taskRequestProblem({ ...request, input: "{" })).toBeDefined();
    expect(taskRequestProblem({ ...request, input: JSON.stringify("x".repeat(40_000)) })).toBeDefined();
    expect(
      taskRequestProblem({ ...request, key: JSON.stringify({ kty: "EC", crv: "P-256", d: "secret" }) }),
    ).toBeDefined();
    expect(taskRequestProblem({ ...request, plugin: "acme--goodfellow-plugin-s3" })).toBeUndefined();
  });
});
