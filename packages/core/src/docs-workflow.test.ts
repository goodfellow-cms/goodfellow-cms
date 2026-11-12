import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const ROOT = join(import.meta.dirname, "../../..");

type Workflow = { jobs: Record<string, { secrets?: unknown; uses?: string }> };

async function workflow(name: string): Promise<Workflow> {
  return parse(await readFile(join(ROOT, ".github/workflows", name), "utf8")) as Workflow;
}

/**
 * The release workflow calls docs.yml with `secrets: inherit`, since GitHub passes a called workflow's jobs their
 * environment's secrets only that way, which hands docs.yml every secret the repository has. A job gets only the
 * secrets it names, so what keeps them from the build job, which runs the released code and the packages it
 * installs, is that it names none.
 */
describe("the docs workflow", () => {
  it("names no secret in the job that runs the docs' code", async () => {
    const build = (await workflow("docs.yml")).jobs.build;
    expect(build).toBeDefined();
    expect(JSON.stringify(build)).not.toMatch(/secrets\s*\./);
    expect(build?.secrets).toBeUndefined();
  });

  it("is the only workflow the release passes every secret to", async () => {
    const inherited = Object.values((await workflow("release.yml")).jobs)
      .filter((job) => job.secrets === "inherit")
      .map((job) => job.uses);
    expect(inherited).toEqual(["./.github/workflows/docs.yml"]);
  });
});
