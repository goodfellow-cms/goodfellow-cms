import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatBuildCause } from "./build-problems.js";
import { serializeContent } from "./content/serialize.js";
import { type RunCommand, type SiteFile, update } from "./node-update.js";
import { hashText } from "./registry.js";
import { parseUpdateSettings, updateSettingsFile } from "./updates.js";

const REGISTRY = "https://registry.example/{name}.json";
const BLOCK = "blocks/installed/shadcn-faq/block.tsx";

let root: string;
afterEach(() => rm(root, { recursive: true, force: true }));

async function site(blockText = "export default { v: 1 };\n") {
  root = await mkdtemp(join(tmpdir(), "goodfellow-update-"));
  const write = async (path: string, text: string) => {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), text);
  };
  await write(
    "package.json",
    JSON.stringify({
      name: "parish",
      dependencies: {
        "@goodfellow-cms/react": "0.4.1",
        "@goodfellow-cms/blocks": "^0.4.1",
        "@puckeditor/core": "0.23.0",
      },
      devDependencies: { goodfellow: "0.4.1" },
    }),
  );
  await write("package-lock.json", "{}\n");
  await write(BLOCK, blockText);
  await write(
    "blocks/installed/installed.json",
    serializeContent({
      version: 1,
      blocks: {
        "shadcn-faq": {
          source: "@goodfellow/shadcn-faq",
          title: "FAQ",
          category: "Sections",
          version: "1.0.0",
          entry: BLOCK,
          files: { [BLOCK]: await hashText("export default { v: 1 };\n") },
        },
      },
    }),
  );
  await write("blocks/installed/index.ts", "");
}

const fetchJson = async (url: string): Promise<unknown> => {
  if (url === "https://registry.npmjs.org/@goodfellow-cms/react") {
    return { versions: { "0.4.1": {}, "0.4.2": {}, "0.5.0": {} } };
  }
  if (url.startsWith("https://registry.npmjs.org/@goodfellow-cms/react/")) {
    return { dependencies: { "@puckeditor/core": "0.23.1" } };
  }
  if (url === "https://registry.example/shadcn-faq.json") {
    return {
      name: "shadcn-faq",
      type: "registry:block",
      title: "FAQ",
      files: [{ path: "blocks/shadcn-faq/block.tsx", type: "registry:block", content: "export default { v: 2 };\n" }],
      meta: { goodfellow: { category: "Sections", version: "1.1.0" } },
    };
  }
  throw new Error(`404 ${url}`);
};

/** Records the commands run, answering with what `results` says for each, or success. */
function commands(results: Record<string, { code: number; output?: string }> = {}) {
  const ran: string[] = [];
  const run: RunCommand = async (command, args) => {
    const line = [command, ...args].join(" ");
    ran.push(line);
    const key = Object.keys(results).find((start) => line.startsWith(start));
    return { code: key ? (results[key]?.code ?? 0) : 0, output: (key && results[key]?.output) || "abc123\n" };
  };
  return { ran, run };
}

const read = (path: string) => readFile(join(root, path), "utf8");

describe("goodfellow update", () => {
  it("updates to the newest fixes, builds, and publishes", async () => {
    await site();
    const { ran, run } = commands();
    const result = await update({ root, fetchJson, run, registry: REGISTRY, publish: true, log: () => {}, env: {} });
    expect(result).toEqual({ state: "updated", from: "0.4.1", to: "0.4.2", kept: [] });
    const pkg = JSON.parse(await read("package.json"));
    expect(pkg.dependencies).toEqual({
      "@goodfellow-cms/react": "0.4.2",
      "@goodfellow-cms/blocks": "^0.4.2",
      "@puckeditor/core": "0.23.1",
    });
    expect(pkg.devDependencies).toEqual({ goodfellow: "0.4.2" });
    expect(await read(BLOCK)).toBe("export default { v: 2 };\n");
    expect(ran.filter((line) => !line.startsWith("git rev-parse"))).toEqual([
      "npm install --no-audit --no-fund",
      "npm run build",
      expect.stringMatching(/^git add --all -- package\.json package-lock\.json /),
      "git -c user.name=Goodfellow updates -c user.email=updates@goodfellow.invalid commit --message Update Goodfellow to 0.4.2",
      "git push origin HEAD:refs/heads/main",
    ]);
  });

  it("leaves block files someone changed", async () => {
    await site("export default { mine: true };\n");
    const { run } = commands();
    const result = await update({ root, fetchJson, run, registry: REGISTRY, log: () => {}, env: {} });
    expect(result.kept).toEqual([BLOCK]);
    expect(await read(BLOCK)).toBe("export default { mine: true };\n");
  });

  it("puts everything back if the site doesn't build, and says why", async () => {
    await site();
    const before = await read("package.json");
    const cause = { kind: "code" as const, file: BLOCK, message: "Unexpected token" };
    const { ran, run } = commands({ "npm run build": { code: 1, output: `${formatBuildCause(cause)}\n` } });
    const result = await update({ root, fetchJson, run, registry: REGISTRY, publish: true, log: () => {}, env: {} });
    expect(result).toEqual({ state: "failed", from: "0.4.1", to: "0.4.2", step: "build", cause });
    expect(await read("package.json")).toBe(before);
    expect(await read(BLOCK)).toBe("export default { v: 1 };\n");
    expect(ran).toContain("npm ci --no-audit --no-fund");
    expect(ran.some((line) => line.startsWith("git push"))).toBe(false);
  });

  it("updates to a newer release only when asked, and says when there's nothing newer", async () => {
    await site();
    const { run } = commands();
    expect(
      await update({ root, fetchJson, run, registry: REGISTRY, to: "0.5.0", log: () => {}, env: {} }),
    ).toMatchObject({
      state: "updated",
      to: "0.5.0",
    });
    expect(await update({ root, fetchJson, run, registry: REGISTRY, log: () => {}, env: {} })).toEqual({
      state: "up-to-date",
      from: "0.5.0",
    });
  });

  it("doesn't install fixes automatically when the site's settings turn that off", async () => {
    await site();
    await mkdir(join(root, "content"), { recursive: true });
    await writeFile(join(root, "content/updates.json"), updateSettingsFile({ automatic: false, skip: [] }));
    const { ran, run } = commands();
    const options = { root, fetchJson, run, registry: REGISTRY, log: () => {}, env: {} };
    expect(await update({ ...options, to: "automatic" })).toEqual({ state: "up-to-date", from: "0.4.1", paused: true });
    expect(ran).toEqual([]);
    // Installing them by hand still works.
    expect(await update({ ...options, to: "fixes" })).toMatchObject({ state: "updated", to: "0.4.2" });
  });

  it("goes back to an older release, and skips the one it left until it's chosen again", async () => {
    await site();
    const withFix = async (url: string) =>
      url === "https://registry.npmjs.org/@goodfellow-cms/react"
        ? { versions: { "0.4.1": {}, "0.4.2": {}, "0.4.3": {}, "0.5.0": {} } }
        : fetchJson(url);
    const { ran, run } = commands();
    const options = { root, fetchJson: withFix, run, registry: REGISTRY, log: () => {}, env: {} };
    await update({ ...options, to: "0.4.2" });
    ran.length = 0;

    const back = await update({ ...options, to: "0.4.1", publish: true });
    expect(back).toEqual({ state: "updated", from: "0.4.2", to: "0.4.1", kept: [], rollback: true });
    expect(JSON.parse(await read("package.json")).dependencies["@goodfellow-cms/react"]).toBe("0.4.1");
    expect(parseUpdateSettings(await read("content/updates.json"))).toEqual({
      version: 1,
      automatic: true,
      skip: ["0.4.2"],
    });
    expect(ran).toContain(
      "git -c user.name=Goodfellow updates -c user.email=updates@goodfellow.invalid commit --message Go back to Goodfellow 0.4.1",
    );
    expect(ran.find((line) => line.startsWith("git add"))).toContain("content/updates.json");

    // Later fixes still install; choosing the skipped release installs it and no longer skips it.
    expect(await update({ ...options, to: "automatic" })).toMatchObject({
      state: "updated",
      from: "0.4.1",
      to: "0.4.3",
    });
    await update({ ...options, to: "0.4.2" });
    expect(parseUpdateSettings(await read("content/updates.json")).skip).toEqual(["0.4.3"]);
  });

  it("leaves content kept in a repository of its own to that repository when going back", async () => {
    await site();
    await mkdir(join(root, "content-repository/content"), { recursive: true });
    await writeFile(join(root, "content-repository/content/site.json"), "{}\n");
    const { ran, run } = commands();
    const lines: string[] = [];
    const options = { root, fetchJson, run, registry: REGISTRY, log: (line: string) => lines.push(line), env: {} };
    await update({ ...options, to: "0.4.2" });
    ran.length = 0;

    expect(await update({ ...options, to: "0.4.1", publish: true })).toMatchObject({
      state: "updated",
      rollback: true,
    });
    expect(await readFile(join(root, "content/updates.json"), "utf8").catch(() => undefined)).toBeUndefined();
    expect(ran.find((line) => line.startsWith("git add"))).not.toContain("content/updates.json");
    expect(lines.join("\n")).toContain('add 0.4.2 to "skip"');
  });

  it("goes back as it was if someone published meanwhile", async () => {
    await site();
    const { ran, run } = commands({ "git push": { code: 1 } });
    const result = await update({ root, fetchJson, run, registry: REGISTRY, publish: true, log: () => {}, env: {} });
    expect(result).toMatchObject({ state: "failed", step: "publish" });
    expect(ran).toContain("git reset --hard abc123");
    expect(JSON.parse(await read("package.json")).dependencies["@goodfellow-cms/react"]).toBe("0.4.1");
  });

  describe("the site's own files", () => {
    const OLD = "export default function Admin() { return old; }\n";
    const NEW = "export default function Admin() { return sandboxed; }\n";
    const EDITOR = "export default function Editor() {}\n";
    const files: SiteFile[] = [
      { path: "app/admin/page.tsx", since: "0.4.2", content: NEW, earlier: [OLD] },
      { path: "app/admin/editor/page.tsx", since: "0.4.2", content: EDITOR, earlier: [] },
    ];
    const options = () => ({ root, fetchJson, run: commands().run, registry: REGISTRY, log: () => {}, env: {} });

    it("brings them up to date with the release, where nobody changed them", async () => {
      await site();
      await mkdir(join(root, "app/admin"), { recursive: true });
      await writeFile(join(root, "app/admin/page.tsx"), OLD);
      const result = await update({ ...options(), siteFiles: files });
      expect(result).toMatchObject({ state: "updated", to: "0.4.2" });
      expect(result.files).toEqual(["app/admin/page.tsx", "app/admin/editor/page.tsx"]);
      expect(await read("app/admin/page.tsx")).toBe(NEW);
      expect(await read("app/admin/editor/page.tsx")).toBe(EDITOR);
    });

    it("brings them up to date even when Goodfellow already is, and publishes them", async () => {
      await site();
      await mkdir(join(root, "app/admin"), { recursive: true });
      await writeFile(join(root, "app/admin/page.tsx"), OLD.replace(/\n/g, "\r\n"));
      const { ran, run } = commands();
      const result = await update({ ...options(), run, to: "0.4.1", siteFiles: files, publish: true });
      expect(result).toEqual({ state: "up-to-date", from: "0.4.1" });
      expect(await read("app/admin/page.tsx")).toBe(OLD.replace(/\n/g, "\r\n"));

      const now = { ...files[0], since: "0.4.1" } as SiteFile;
      const updated = await update({ ...options(), run, to: "0.4.1", siteFiles: [now], publish: true });
      expect(updated).toEqual({ state: "up-to-date", from: "0.4.1", files: ["app/admin/page.tsx"] });
      expect(await read("app/admin/page.tsx")).toBe(NEW);
      expect(ran).toContain("npm run build");
      expect(ran).toContain("git add --all -- app/admin/page.tsx");
      expect(ran.some((line) => line.endsWith("commit --message Update the site's files for Goodfellow 0.4.1"))).toBe(
        true,
      );
    });

    it("leaves files someone changed, and says so", async () => {
      await site();
      await mkdir(join(root, "app/admin"), { recursive: true });
      await writeFile(join(root, "app/admin/page.tsx"), "export default function Mine() {}\n");
      const result = await update({ ...options(), siteFiles: files });
      expect(result.kept).toContain("app/admin/page.tsx");
      expect(await read("app/admin/page.tsx")).toBe("export default function Mine() {}\n");
    });

    it("puts the earlier files back when going back to a release before them", async () => {
      await site();
      await update({ ...options(), to: "0.4.2", siteFiles: files });
      expect(await read("app/admin/page.tsx").catch(() => undefined)).toBeUndefined();
      expect(await read("app/admin/editor/page.tsx")).toBe(EDITOR);
      await mkdir(join(root, "app/admin"), { recursive: true });
      await writeFile(join(root, "app/admin/page.tsx"), NEW);
      const result = await update({ ...options(), to: "0.4.1", siteFiles: files });
      expect(result).toMatchObject({ state: "updated", rollback: true });
      expect(await read("app/admin/page.tsx")).toBe(OLD);
      expect(await read("app/admin/editor/page.tsx").catch(() => undefined)).toBeUndefined();
    });
  });
});
