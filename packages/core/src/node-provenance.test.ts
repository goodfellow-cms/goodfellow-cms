import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeContent } from "./content/serialize.js";
import {
  checkEarlyInstall,
  checkEarlyTheme,
  type EarlyInstall,
  EarlyInstallError,
  signerIdentity,
  verifiedSource,
  writeEarlyLockfile,
} from "./node-provenance.js";
import { type FakeThemeRelease, fakePlugins, fakeVerifier } from "./themes-testing.js";

const NAME = "goodfellow-plugin-guestbook";
const REPO = "https://github.com/example/goodfellow-plugin-guestbook";
const WORKFLOW = ".github/workflows/release.yml";
const source = { repository: REPO, workflow: WORKFLOW };

function npm(releases: Partial<FakeThemeRelease>[]) {
  const fake = fakePlugins({
    plugins: [{ name: NAME, releases: releases.map((release) => ({ version: "1.0.0", files: {}, ...release })) }],
  });
  return { fetch: fake.fetch, verify: fakeVerifier };
}

const earlyUpdate = (early = { from: "1.0.0", ...source }): EarlyInstall => ({
  kind: "plugin",
  name: NAME,
  release: "1.1.0",
  early,
});

describe("verifiedSource", () => {
  it("gives where a release was built once its signature checks out", async () => {
    const options = npm([{ version: "1.0.0", provenance: true, repository: REPO }]);
    expect(await verifiedSource(NAME, "1.0.0", options)).toMatchObject({ ok: true, source });
  });

  it("refuses a release without provenance, and one whose signature doesn't check out", async () => {
    const options = npm([
      { version: "1.0.0" },
      { version: "1.0.1", provenance: true, repository: REPO, badSignature: true },
    ]);
    expect(await verifiedSource(NAME, "1.0.0", options)).toMatchObject({ ok: false, problem: "no-provenance" });
    expect(await verifiedSource(NAME, "1.0.1", options)).toMatchObject({ ok: false, problem: "unverified" });
    expect(await verifiedSource(NAME, "9.9.9", options)).toMatchObject({ ok: false, problem: "unavailable" });
  });

  it("names the workflow's certificate as GitHub and GitLab sign them", () => {
    const statement = { repository: REPO, repositoryUrl: REPO, workflow: WORKFLOW, ref: "refs/tags/v1", subjects: [] };
    expect(signerIdentity(statement)).toEqual({
      issuer: "https://token.actions.githubusercontent.com",
      uri: `${REPO}/${WORKFLOW}@refs/tags/v1`,
    });
    expect(
      signerIdentity({ ...statement, repositoryUrl: "https://gitlab.com/example/site", workflow: ".gitlab-ci.yml" }),
    ).toEqual({ issuer: "https://gitlab.com", uri: "https://gitlab.com/example/site//.gitlab-ci.yml@refs/tags/v1" });
    expect(signerIdentity({ ...statement, repositoryUrl: "https://example.org/site" })).toBeUndefined();
  });
});

describe("checkEarlyInstall", () => {
  const young = { age: 1 };

  it("lets an update of the installed release through when both were built by the record's repository and workflow", async () => {
    const options = npm([
      { version: "1.0.0", provenance: true, repository: REPO },
      { version: "1.1.0", provenance: true, repository: REPO, ...young },
    ]);
    expect(await checkEarlyInstall(earlyUpdate(), "1.0.0", options)).toMatchObject({ ok: true, young: true });
  });

  it("refuses a first install, another workflow, another repository, a missing attestation and a bad signature", async () => {
    const problem = async (releases: Partial<FakeThemeRelease>[], installed: string | undefined = "1.0.0") => {
      const checked = await checkEarlyInstall(earlyUpdate(), installed, npm(releases));
      return checked.ok ? "ok" : checked.problem;
    };
    const before = { version: "1.0.0", provenance: true, repository: REPO };
    expect(await problem([before, { version: "1.1.0", provenance: true, repository: REPO, ...young }], "")).toBe(
      "not-installed",
    );
    expect(
      await problem([
        before,
        { version: "1.1.0", provenance: true, repository: REPO, workflow: ".github/workflows/x.yml", ...young },
      ]),
    ).toBe("other-source");
    expect(
      await problem([
        before,
        { version: "1.1.0", provenance: true, builtBy: "https://github.com/evil/guestbook", ...young },
      ]),
    ).toBe("other-source");
    expect(await problem([before, { version: "1.1.0", ...young }])).toBe("no-provenance");
    expect(
      await problem([before, { version: "1.1.0", provenance: true, repository: REPO, badSignature: true, ...young }]),
    ).toBe("unverified");
    // The release installed needs verified provenance too.
    expect(
      await problem([{ version: "1.0.0" }, { version: "1.1.0", provenance: true, repository: REPO, ...young }]),
    ).toBe("no-provenance");
  });

  it("needs nothing once the release is old enough", async () => {
    const checked = await checkEarlyInstall(earlyUpdate(), "1.0.0", npm([{ version: "1.0.0" }, { version: "1.1.0" }]));
    expect(checked).toMatchObject({ ok: true, young: false });
  });
});

describe("writeEarlyLockfile", () => {
  let dir: string;
  afterEach(() => rm(dir, { recursive: true, force: true }));

  async function site(record: Record<string, unknown>, locked: string) {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-early-"));
    const write = async (path: string, text: string) => {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), text);
    };
    await write("package.json", `${JSON.stringify({ name: "site", dependencies: { [NAME]: "1.1.0" } }, null, 2)}\n`);
    await write(
      "package-lock.json",
      JSON.stringify({
        packages: {
          "": { name: "site", dependencies: { [NAME]: locked } },
          [`node_modules/${NAME}`]: { version: locked },
        },
      }),
    );
    await write(
      "plugins/installed/installed.json",
      serializeContent({
        version: 1,
        plugins: {
          [NAME]: {
            release: "1.1.0",
            installed: "2026-10-30",
            manifest: { version: 1, title: "Guestbook" },
            ...record,
          },
        },
      }),
    );
  }

  it("writes the lockfile with the early release and nothing newer than it, putting package.json back", async () => {
    await site({ provenance: source, early: { from: "1.0.0", ...source } }, "1.0.0");
    const options = npm([
      { version: "1.0.0", provenance: true, repository: REPO },
      { version: "1.1.0", provenance: true, repository: REPO, age: 1 },
    ]);
    const calls: string[][] = [];
    let named = "";
    const result = await writeEarlyLockfile(dir, {
      ...options,
      now: new Date("2026-10-30T12:00:00Z"),
      npm: async (args) => {
        if (calls.length === 0)
          named = JSON.parse(await readFile(join(dir, "package.json"), "utf8")).dependencies[NAME];
        calls.push(args);
        return 0;
      },
    });
    expect(result.written).toBe(true);
    expect(result.early.map((install) => install.release)).toEqual(["1.1.0"]);
    // Everything else as ever, with the plugin at the release it updates, which npm will take.
    expect(named).toBe("1.0.0");
    expect(calls[0]).toContain("--before=2026-10-27T12:00:00.000Z");
    expect(calls[1]?.slice(0, 2)).toEqual(["install", `${NAME}@1.1.0`]);
    expect(calls[1]?.find((arg) => arg.startsWith("--before="))).toMatch(/^--before=20\d\d-/);
    expect(JSON.parse(await readFile(join(dir, "package.json"), "utf8")).dependencies[NAME]).toBe("1.1.0");
  });

  it("fails, writing nothing, when the record lies about where the release came from", async () => {
    // As a browser that says the release was built by the same workflow when it wasn't.
    await site({ provenance: source, early: { from: "1.0.0", ...source } }, "1.0.0");
    const options = npm([
      { version: "1.0.0", provenance: true, repository: REPO },
      { version: "1.1.0", provenance: true, builtBy: "https://github.com/evil/guestbook", age: 1 },
    ]);
    const calls: string[][] = [];
    const written = writeEarlyLockfile(dir, {
      ...options,
      npm: async (args) => {
        calls.push(args);
        return 0;
      },
    });
    await expect(written).rejects.toBeInstanceOf(EarlyInstallError);
    await expect(written).rejects.toThrow(/evil\/guestbook/);
    expect(calls).toEqual([]);
  });

  it("does nothing where the lockfile has everything already", async () => {
    await site({ early: { from: "1.0.0", ...source } }, "1.1.0");
    const result = await writeEarlyLockfile(dir, { ...npm([]), npm: async () => 1 });
    expect(result).toEqual({ written: false, early: [] });
  });
});

describe("checkEarlyTheme", () => {
  let dir: string;
  afterEach(() => rm(dir, { recursive: true, force: true }));
  const THEME = "goodfellow-theme-harbor";
  const themeNpm = (releases: Partial<FakeThemeRelease>[]) => {
    const fake = fakePlugins({
      plugins: [{ name: THEME, releases: releases.map((release) => ({ version: "1.0.0", files: {}, ...release })) }],
    });
    return { fetch: fake.fetch, verify: fakeVerifier };
  };
  const record = (release: string, extra: Record<string, unknown> = {}) =>
    serializeContent({ version: 1, name: THEME, release, title: "Harbor", ...extra });
  const git = (...args: string[]) =>
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.org", ...args], { cwd: dir });

  async function commit(text: string) {
    await mkdir(join(dir, "content/styles"), { recursive: true });
    await writeFile(join(dir, "content/styles/theme.json"), text);
    git("add", "--all");
    git("commit", "--quiet", "--message", "Theme");
  }

  it("checks the release before it in git's history, and refuses one the site didn't have", {
    timeout: 60_000,
  }, async () => {
    dir = await mkdtemp(join(tmpdir(), "goodfellow-early-theme-"));
    git("init", "--quiet");
    const options = themeNpm([
      { version: "1.0.0", provenance: true, repository: `https://github.com/example/${THEME}` },
      { version: "1.1.0", provenance: true, repository: `https://github.com/example/${THEME}`, age: 1 },
    ]);
    const early = { from: "1.0.0", repository: `https://github.com/example/${THEME}`, workflow: WORKFLOW };
    await commit(record("1.0.0"));
    await commit(record("1.1.0", { early }));
    expect(await checkEarlyTheme(dir, options)).toMatchObject({ name: THEME, release: "1.1.0" });

    // A first install that says it updates a release the site never had.
    git("checkout", "--quiet", "--orphan", "first");
    git("rm", "--quiet", "-r", "--cached", ".");
    await commit(record("1.1.0", { early }));
    await expect(checkEarlyTheme(dir, options)).rejects.toThrow(/no release of it/);
  });
});
