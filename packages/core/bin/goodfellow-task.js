#!/usr/bin/env node
// Run by sites' task jobs, from a release of @goodfellow-cms/core installed from npm apart from the site's own
// packages, never from them: runs the plugin task a job with no secrets described, with only the secrets its
// plugin declared, and writes the answer sealed to the admin panel's key. It never loads the site's config.
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { runDescribedTask, taskSecretsFrom } from "../dist/node.js";

const { values } = parseArgs({ options: { description: { type: "string" }, out: { type: "string" } } });
const env = process.env;
try {
  await runDescribedTask({
    root: process.cwd(),
    request: {
      id: env.GOODFELLOW_TASK_REQUEST ?? "",
      plugin: env.GOODFELLOW_TASK_PLUGIN ?? "",
      task: env.GOODFELLOW_TASK_NAME ?? "",
      input: env.GOODFELLOW_TASK_INPUT ?? "",
      key: env.GOODFELLOW_TASK_KEY ?? "",
    },
    description: values.description ? await readFile(values.description, "utf8").catch(() => undefined) : undefined,
    secrets: taskSecretsFrom(env),
    out: values.out ?? "goodfellow-task-result.json",
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
