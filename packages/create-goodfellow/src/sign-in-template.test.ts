// The copy of the sign-in worker Cloudflare's Deploy to Cloudflare button deploys (`packages/worker/deploy/`),
// which this package's build carries as `templates/sign-in/`, for copies to update themselves from.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(`../../worker/deploy/${file}`, import.meta.url), "utf8");

describe("the Deploy to Cloudflare copy", () => {
  const wrangler = JSON.parse(read("wrangler.json")) as Record<string, unknown>;
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("runs the bundled worker with the same compatibility date as this one", () => {
    expect(wrangler.main).toBe("worker.js");
    const own = readFileSync(new URL("../../worker/wrangler.jsonc", import.meta.url), "utf8");
    expect(own).toContain(`"compatibility_date": "${wrangler.compatibility_date}"`);
  });

  it("keeps the settings its setup page writes, which a var of the same name would clash with", () => {
    expect(wrangler.vars).toBeUndefined();
    expect(wrangler.keep_vars).toBe(true);
  });

  it("deploys with its name, an exact Wrangler and a lockfile from npm's registry", () => {
    expect(pkg.scripts.deploy).toBe("node deploy.mjs");
    expect(read("deploy.mjs")).toContain("WORKER_NAME:");
    expect(pkg.devDependencies.wrangler).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { version?: string; resolved?: string }>;
    };
    expect(lock.packages["node_modules/wrangler"]?.version).toBe(pkg.devDependencies.wrangler);
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (entry.resolved) expect(entry.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
  });

  it("updates itself from npm with a token that can only push, running none of the release's code", () => {
    const workflow = read("update.yml");
    expect(workflow).toContain("permissions: {}");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("node update.mjs");
    expect(workflow).not.toMatch(/npm (ci|install|run)/);
    for (const action of workflow.match(/uses: \S+/g) ?? []) expect(action).toMatch(/^uses: actions\/[\w-]+@v\d+$/);
    expect(read("update.mjs")).toContain("--ignore-scripts");
  });
});
