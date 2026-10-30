import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { EarlyInstallError, writeEarlyLockfile } from "@goodfellow-cms/core/node";
import {
  type FakePlugin,
  type FakeThemeRelease,
  fakeFileBytes,
  fakePlugins,
  fakeVerifier,
  samplePluginFiles,
} from "@goodfellow-cms/core/testing";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { expect, type Page, test } from "@playwright/test";
import { ADMIN_ADDRESSES } from "../scripts/site.mjs";
import { files, routeToFake } from "./backends.js";

// Installing plugins from Site Settings' Plugins screen, which needs the admin panel out of the site's pages'
// reach: the admin address test site (`builtSites.admin`), against fakes of GitHub, npm and jsDelivr.
const { admin } = ADMIN_ADDRESSES;
const starter = join(import.meta.dirname, "../../templates/starter");
/** The test site's own config, which doesn't list installed plugins yet. */
const adminConfig = () => readFileSync(join(import.meta.dirname, "../.site-admin/goodfellow.config.tsx"), "utf8");

const GUESTBOOK: FakePlugin = {
  name: "goodfellow-plugin-guestbook",
  description: "Lets visitors sign a guestbook.",
  publisher: "guestbook-studio",
  releases: [
    {
      version: "1.0.0",
      provenance: true,
      repository: "https://github.com/guestbook-studio/goodfellow-plugin-guestbook",
      files: samplePluginFiles(),
      dependencies: { "tiny-store": "^2.0.0" },
    },
  ],
};

const TINY_STORE: FakePlugin = {
  name: "tiny-store",
  releases: [{ version: "2.0.0", files: { "index.js": "module.exports = (code) => eval(code);\n" } }],
};

/** npm's registry and jsDelivr, answering for the plugins given and the packages they need. */
async function routeToPlugins(page: Page, plugins: FakePlugin[] = [GUESTBOOK]) {
  const fake = fakePlugins({ plugins, packages: [TINY_STORE] });
  for (const origin of ["https://registry.npmjs.org", "https://cdn.jsdelivr.net", "https://data.jsdelivr.com"]) {
    await page.route(`${origin}/**`, (route) => {
      const answer = fake.handle(route.request().url());
      return route.fulfill({ status: answer.status, headers: answer.headers, body: answer.body });
    });
  }
}

/** The site on the fake GitHub, with the files installing a plugin changes, as the starter has them. */
async function setup(
  page: Page,
  {
    deploy = readFileSync(join(starter, ".github/workflows/deploy.yml"), "utf8"),
    plugins = [GUESTBOOK],
    extra = {},
  }: { deploy?: string; plugins?: FakePlugin[]; extra?: Record<string, string> } = {},
) {
  const fake = fakeGitHub({
    repo: "parish/site",
    files: {
      ...files(),
      "package.json": readFileSync(join(starter, "package.json"), "utf8"),
      "goodfellow.config.tsx": adminConfig(),
      ".github/workflows/deploy.yml": deploy,
      ...extra,
    },
    tokens: { "good-token": { login: "maria", name: "Maria" } },
    deployAfterChecks: 0,
  });
  await routeToFake(page, "https://api.github.com", fake.handle);
  await routeToPlugins(page, plugins);
  await page.goto(`${admin}/admin/`);
  await page.getByLabel("Access token").fill("good-token");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "About us", exact: true })).toBeVisible();
  await page.goto(`${admin}/admin/#/settings/plugins`);
  return fake;
}

test("installs a plugin after showing what it asks to do and what its code does, then removes it", async ({ page }) => {
  const fake = await setup(page);
  await expect(page.getByRole("heading", { name: "Plugins", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Show Guestbook" }).click();

  const details = page.getByRole("region", { name: "Guestbook" });
  await expect(details).toContainText("Built from https://github.com/guestbook-studio/goodfellow-plugin-guestbook");
  await expect(details).toContainText("Reach these addresses from the admin panel: https://guestbook.example.com");
  await expect(details).toContainText("Read and publish these files: content/guestbook.json");
  // Its own code requests the address it asked for, and a package it needs runs code made from text.
  await expect(details).toContainText("goodfellow-plugin-guestbook 1.0.0");
  await expect(details).toContainText("makes network requests (1)");
  await expect(details).toContainText("tiny-store 2.0.0");
  await expect(details).toContainText("runs code made from text, which can't be read beforehand (1)");

  await details.getByRole("button", { name: "Install", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "Install Guestbook?" });
  await expect(confirm).toContainText("goodfellow-plugin-guestbook version 1.0.0 asks to:");
  await expect(confirm).toContainText("Your site's settings file is changed too");
  await confirm.getByRole("button", { name: "Install and publish" }).click();
  await expect(page.getByText("Guestbook is installed.")).toBeVisible();

  const text = (path: string) => new TextDecoder().decode(fakeFileBytes(fake.repo.files().get(path) ?? ""));
  expect(JSON.parse(text("package.json")).dependencies["goodfellow-plugin-guestbook"]).toBe("1.0.0");
  expect(text("plugins/installed/index.ts")).toContain('import plugin0 from "goodfellow-plugin-guestbook";');
  expect(text("goodfellow.config.tsx")).toContain("plugins: installedPlugins,");
  expect(fake.repo.commitAt(fake.repo.head())?.message).toBe("Install the Guestbook plugin, version 1.0.0");

  const installed = page.locator(".gfa-theme-installed", { hasText: "Guestbook" });
  await expect(installed).toContainText("version 1.0.0");
  await installed.getByRole("button", { name: "Remove" }).click();
  await page.getByRole("dialog", { name: "Remove Guestbook?" }).getByRole("button", { name: "Remove" }).click();
  await expect(page.getByText("Guestbook is removed.")).toBeVisible();
  expect(JSON.parse(text("package.json")).dependencies).not.toHaveProperty("goodfellow-plugin-guestbook");
});

test("installs nothing where the site's build wouldn't write the lockfile", async ({ page }) => {
  await setup(page, { deploy: "name: Deploy\njobs:\n  build:\n    steps:\n      - run: npm ci\n" });
  await expect(page.getByText("A developer needs to update its build setup")).toBeVisible();
  await page.getByRole("button", { name: "Show Guestbook" }).click();
  await expect(page.getByRole("region", { name: "Guestbook" })).toContainText("What it asks to do");
  await expect(page.getByRole("button", { name: "Install", exact: true })).toHaveCount(0);
});

const REPO = "https://github.com/guestbook-studio/goodfellow-plugin-guestbook";
const SOURCE = { repository: REPO, workflow: ".github/workflows/release.yml" };

/** The Guestbook's 1.0.0 and a day-old 1.1.0 as given, and with `evil`, a day-old 1.2.0 built somewhere else. */
function guestbookUpdates(newer: Partial<FakeThemeRelease>, { evil = false } = {}): FakePlugin {
  const first = GUESTBOOK.releases[0] as FakeThemeRelease;
  return {
    ...GUESTBOOK,
    releases: [
      first,
      { ...first, version: "1.1.0", age: 1, ...newer },
      ...(evil ? [{ ...first, version: "1.2.0", age: 1, builtBy: "https://github.com/evil/guestbook" }] : []),
    ],
  };
}

/** The site's files with Guestbook 1.0.0 installed, from before provenance was recorded. */
function installedGuestbook(): Record<string, string> {
  const site = JSON.parse(readFileSync(join(starter, "package.json"), "utf8"));
  site.dependencies["goodfellow-plugin-guestbook"] = "1.0.0";
  const manifest = JSON.parse(samplePluginFiles()["goodfellow-plugin.json"] ?? "{}");
  return {
    "package.json": `${JSON.stringify(site, null, 2)}\n`,
    "plugins/installed/installed.json": `${JSON.stringify(
      {
        version: 1,
        plugins: { "goodfellow-plugin-guestbook": { release: "1.0.0", installed: "2026-10-01", manifest } },
      },
      null,
      2,
    )}\n`,
  };
}

test("installs an update before it's three days old when it was built where the version installed was, which CI checks", async ({
  page,
}) => {
  const plugin = guestbookUpdates({});
  const fake = await setup(page, { plugins: [plugin], extra: installedGuestbook() });
  await page.locator(".gfa-theme-installed", { hasText: "Guestbook" }).getByRole("button").first().click();
  const details = page.getByRole("region", { name: "Guestbook" });
  // The wait is the default: Install now is a choice, offered only for 1.1.0, built where 1.0.0 was.
  await expect(details).toContainText("Version 1.1.0 can be installed once it's 3 days old");
  await expect(details).toContainText("1.1.0 was built from the same place as 1.0.0");
  await details.getByRole("button", { name: "Install 1.1.0 now" }).click();
  await details.getByRole("button", { name: "Update to 1.1.0" }).click();
  const confirm = page.getByRole("dialog", { name: "Install Guestbook?" });
  await expect(confirm).toContainText("Installing 1.1.0 before it's 3 days old");
  await confirm.getByRole("button", { name: "Install and publish" }).click();
  await expect(page.getByText("Guestbook is updated to version 1.1.0.")).toBeVisible();

  const text = (path: string) => new TextDecoder().decode(fakeFileBytes(fake.repo.files().get(path) ?? ""));
  const record = JSON.parse(text("plugins/installed/installed.json"));
  expect(record.plugins["goodfellow-plugin-guestbook"]).toMatchObject({
    release: "1.1.0",
    provenance: SOURCE,
    early: { from: "1.0.0", ...SOURCE },
  });

  // The site's lockfile job, run on the files published, with the lockfile as it was: it checks the provenance
  // itself, and writes the lockfile only if it checks out.
  const npm = fakePlugins({ plugins: [guestbookUpdates({}, { evil: true })] });
  const ci = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), "goodfellow-ci-"));
    for (const [path, content] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), content);
    }
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({ packages: { "": {}, "node_modules/goodfellow-plugin-guestbook": { version: "1.0.0" } } }),
    );
    const calls: string[][] = [];
    const done = writeEarlyLockfile(dir, {
      fetch: npm.fetch,
      verify: fakeVerifier,
      npm: async (args) => {
        calls.push(args);
        return 0;
      },
    }).finally(() => rmSync(dir, { recursive: true, force: true }));
    return { done, calls };
  };
  const published = {
    "package.json": text("package.json"),
    "plugins/installed/installed.json": text("plugins/installed/installed.json"),
  };
  const honest = ci(published);
  await expect(honest.done).resolves.toMatchObject({ written: true });
  expect(honest.calls[1]?.[1]).toBe("goodfellow-plugin-guestbook@1.1.0");

  // A browser that lies: the same record, but for 1.2.0, which was built somewhere else.
  const lie = ci({
    "package.json": published["package.json"].replace(
      '"goodfellow-plugin-guestbook": "1.1.0"',
      '"goodfellow-plugin-guestbook": "1.2.0"',
    ),
    "plugins/installed/installed.json": published["plugins/installed/installed.json"].replace(
      '"release": "1.1.0"',
      '"release": "1.2.0"',
    ),
  });
  await expect(lie.done).rejects.toBeInstanceOf(EarlyInstallError);
  await expect(lie.done).rejects.toThrow(/evil\/guestbook/);
  expect(lie.calls).toEqual([]);
});

for (const [why, newer, installed] of [
  ["a first install, which always waits", {}, false],
  ["a release built by another workflow", { workflow: ".github/workflows/other.yml" }, true],
  ["a release without provenance", { provenance: false }, true],
] as const) {
  test(`offers no early install for ${why}`, async ({ page }) => {
    await setup(page, { plugins: [guestbookUpdates(newer)], extra: installed ? installedGuestbook() : {} });
    if (installed) {
      await page.locator(".gfa-theme-installed", { hasText: "Guestbook" }).getByRole("button").first().click();
    } else {
      await page.getByRole("button", { name: "Show Guestbook" }).click();
    }
    const details = page.getByRole("region", { name: "Guestbook" });
    await expect(details).toContainText("can be installed once it's 3 days old");
    // Once the admin panel has read both releases' provenance.
    await page.waitForLoadState("networkidle");
    await expect(details.getByRole("button", { name: "Install 1.1.0 now" })).toHaveCount(0);
  });
}
