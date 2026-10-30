import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { UPDATE_CHECK } from "./github-workflows.js";

/** Tests that start git and Node processes, which can take seconds each on Windows while many tests run at once. */
const PROCESS_TIMEOUT = 180_000;

const lock = (resolved: Record<string, string>) =>
  JSON.stringify({
    lockfileVersion: 3,
    packages: Object.fromEntries(
      Object.entries(resolved).map(([name, address]) => [`node_modules/${name}`, { resolved: address }]),
    ),
  });

describe("publish-update's check", { timeout: PROCESS_TIMEOUT }, () => {
  let dir: string;
  let base: string;
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.org", ...args], {
      cwd: dir,
      encoding: "utf8",
    }).trim();
  const write = async (path: string, text: string) => {
    await mkdir(dirname(join(dir, path)), { recursive: true });
    await writeFile(join(dir, path), text);
  };
  /** Commits what's written and runs the check on everything since the first commit. */
  const check = (): { passed: boolean; output: string } => {
    git("add", "--all");
    git("commit", "--quiet", "--allow-empty", "--message", "Update");
    try {
      const output = execFileSync(process.execPath, ["-e", UPDATE_CHECK], {
        cwd: dir,
        env: { ...process.env, BASE: base },
        encoding: "utf8",
      });
      return { passed: true, output };
    } catch (error) {
      return { passed: false, output: String((error as { stdout?: string }).stdout) };
    }
  };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-update-check-"));
    git("init", "--quiet");
    await write("package.json", "{}\n");
    await write("package-lock.json", lock({ react: "https://registry.npmjs.org/react/-/react-19.3.0.tgz" }));
    await write("src/site.tsx", "export {};\n");
    git("add", "--all");
    git("commit", "--quiet", "--message", "Site");
    base = git("rev-parse", "HEAD");
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  it("is one line a workflow can hold in single quotes", () => {
    expect(UPDATE_CHECK).not.toMatch(/['\n]/);
  });

  it("passes the files an update writes, with packages from npm's registry", async () => {
    await write("package.json", '{ "dependencies": { "react": "19.3.1" } }\n');
    await write(
      "package-lock.json",
      lock({
        react: "https://registry.npmjs.org/react/-/react-19.3.1.tgz",
        clsx: "https://registry.npmjs.org/clsx/-/clsx-2.1.1.tgz",
      }),
    );
    await write("content/updates.json", "{}\n");
    await write("blocks/installed/panel/block.tsx", "export {};\n");
    await write("components/ui/button.tsx", "export {};\n");
    expect(check()).toEqual({ passed: true, output: "" });
  });

  it("refuses any other file, a link, and a package from anywhere else", async () => {
    await write("src/site.tsx", "export const changed = true;\n");
    expect(check()).toMatchObject({ passed: false, output: expect.stringContaining("src/site.tsx") });

    git("reset", "--quiet", "--hard", base);
    await mkdir(join(dir, "lib"), { recursive: true });
    await symlink("../src/site.tsx", join(dir, "lib/site.tsx"));
    expect(check()).toMatchObject({ passed: false, output: expect.stringContaining("lib/site.tsx") });

    git("reset", "--quiet", "--hard", base);
    git("clean", "--quiet", "--force", "-d");
    // Spelled with an escape, as JSON allows, and still read as "resolved".
    await write(
      "package-lock.json",
      '{ "packages": { "node_modules/react": { "resolv\\u0065d": "https://evil.example/react.tgz" } } }',
    );
    const found = check();
    expect(found.passed).toBe(false);
    expect(found.output).toContain("package-lock.json: https://evil.example/react.tgz");
  });
});
