import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { githubUpdateJobs } from "./github-workflows.js";
import { gitlabPagesPipelineJobs } from "./gitlab-publish.js";
import {
  GITLAB_LOCKFILE_VARIABLES,
  githubLockfileJobs,
  LOCKFILE_CHECK,
  LOCKFILE_REGISTRY_CHECK,
} from "./lockfile-setup.js";

const ROOT = join(import.meta.dirname, "../../..");

/** Tests that start Node processes, each of which can take seconds to start on Windows while many tests run at once, so a test can take a minute. */
const NODE_TIMEOUT = 180_000;

describe("the lockfile check", { timeout: NODE_TIMEOUT }, () => {
  async function check(site: unknown, lock?: unknown): Promise<boolean> {
    const dir = await mkdtemp(join(tmpdir(), "goodfellow-lockfile-"));
    try {
      await writeFile(join(dir, "package.json"), JSON.stringify(site));
      if (lock !== undefined) await writeFile(join(dir, "package-lock.json"), JSON.stringify(lock));
      execFileSync(process.execPath, ["-e", LOCKFILE_CHECK], { cwd: dir, stdio: "ignore" });
      return true;
    } catch {
      return false;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("passes when package-lock.json has every package and range package.json names, as npm ci needs", async () => {
    const site = {
      name: "site",
      dependencies: { react: "19.3.0", clsx: "2.1.1" },
      devDependencies: { goodfellow: "0.40.0" },
    };
    const lock = {
      packages: {
        "": {
          name: "site",
          dependencies: { clsx: "2.1.1", react: "19.3.0" },
          devDependencies: { goodfellow: "0.40.0" },
        },
      },
    };
    expect(await check(site, lock)).toBe(true);
    expect(
      await check({ ...site, dependencies: { ...site.dependencies, "goodfellow-plugin-guestbook": "1.0.0" } }, lock),
    ).toBe(false);
    expect(await check({ ...site, devDependencies: { goodfellow: "0.40.1" } }, lock)).toBe(false);
    expect(await check(site)).toBe(false);
  });
});

describe("the lockfile's registry check", { timeout: NODE_TIMEOUT }, () => {
  it("refuses a lockfile that takes a package from anywhere but npm's registry the committed one didn't", async () => {
    const dir = await mkdtemp(join(tmpdir(), "goodfellow-lockfile-registry-"));
    const lock = (...resolved: string[]) =>
      JSON.stringify({
        packages: Object.fromEntries(
          resolved.map((address, index) => [`node_modules/p${index}`, { resolved: address }]),
        ),
      });
    const passes = async (text: string) => {
      await writeFile(join(dir, "package-lock.json"), text);
      try {
        execFileSync(process.execPath, ["-e", LOCKFILE_REGISTRY_CHECK], { cwd: dir, stdio: "ignore" });
        return true;
      } catch {
        return false;
      }
    };
    try {
      const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
      git("init", "-q");
      // A package the site already took from elsewhere stays allowed.
      await writeFile(join(dir, "package-lock.json"), lock("https://git.example/own.tgz"));
      git("add", "package-lock.json");
      git("-c", "user.name=T", "-c", "user.email=t@example.org", "commit", "-q", "-m", "lock");
      expect(await passes(lock("https://git.example/own.tgz", "https://registry.npmjs.org/a/-/a-1.0.0.tgz"))).toBe(
        true,
      );
      expect(await passes(lock("https://registry.npmjs.org/a/-/a-1.0.0.tgz", "https://evil.example/b.tgz"))).toBe(
        false,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("the starters' workflows", () => {
  const read = (path: string) => readFile(join(ROOT, path), "utf8");

  it("write the lockfile as the setups planned for new sites do", async () => {
    for (const [site, cli] of [
      ["templates/starter", "goodfellow"],
      ["examples/parish", "goodfellow"],
      ["templates/next", "goodfellow-next"],
    ] as const) {
      const deploy = await read(`${site}/.github/workflows/deploy.yml`);
      expect(deploy).toContain(githubLockfileJobs());
      expect(deploy).toContain(
        githubUpdateJobs({ update: `npx ${cli} update`, nightly: `npx ${cli} nightly`, lockfile: true }),
      );
      const pipeline = await read(`${site}/.gitlab-ci.yml`);
      expect(pipeline).toContain(GITLAB_LOCKFILE_VARIABLES);
      const next = cli === "goodfellow-next";
      expect(pipeline).toContain(
        gitlabPagesPipelineJobs({
          cli,
          build: next ? "npm run build" : "npx goodfellow build",
          output: next ? "out" : "dist",
          cachePaths: next ? ".npm/, .next/cache/" : ".npm/",
        }),
      );
    }
  });
});
