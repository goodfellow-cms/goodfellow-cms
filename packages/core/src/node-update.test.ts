import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { formatBuildCause } from "./build-problems.js";
import { serializeContent } from "./content/serialize.js";
import { type ReleaseVerifier, type RunCommand, type SiteFile, update } from "./node-update.js";
import { hashText } from "./registry.js";
import {
  GOODFELLOW_RELEASE_SOURCE,
  PUCK_CLI,
  parseUpdateSettings,
  SITE_OVERRIDES,
  updateSettingsFile,
} from "./updates.js";

const REGISTRY = "https://registry.example/{name}.json";
const BLOCK = "blocks/installed/shadcn-faq/block.tsx";

let root: string;
afterEach(() => rm(root, { recursive: true, force: true }));

/** How the tests' lockfiles name a Goodfellow package's release, with the file its provenance is about. */
const locked = (name: string, version: string) => ({
  version,
  resolved: `https://registry.npmjs.org/${name}/-/${name.split("/").pop()}-${version}.tgz`,
  integrity: `sha512-${name}@${version}`,
});

/** The site's lockfile, naming its Goodfellow packages. */
const LOCK = `${JSON.stringify({ packages: { "": { name: "parish" }, "node_modules/@goodfellow-cms/react": locked("@goodfellow-cms/react", "0.4.1") } })}\n`;

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
  await write("package-lock.json", LOCK);
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
    return {
      versions: { "0.4.1": {}, "0.4.2": {}, "0.5.0": {} },
      time: { "0.4.2": "2026-10-01T12:00:00.000Z" },
    };
  }
  if (url.startsWith("https://registry.npmjs.org/@goodfellow-cms/react/")) {
    return { dependencies: { "@puckeditor/core": "0.23.1" } };
  }
  // Every other Goodfellow package's release, with no Goodfellow packages of its own.
  if (/^https:\/\/registry\.npmjs\.org\/(@goodfellow-cms\/[a-z-]+|goodfellow)\/\d/.test(url)) return {};
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

/** Every release built by Goodfellow's own release workflow, as its provenance would say. */
const verifyRelease: ReleaseVerifier = async (name, version) => ({
  ok: true,
  source: GOODFELLOW_RELEASE_SOURCE,
  published: "2026-10-01T12:00:00.000Z",
  integrity: `sha512-${name}@${version}`,
});

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
    const result = await update({
      root,
      fetchJson,
      run,
      registry: REGISTRY,
      blocks: true,
      publish: true,
      log: () => {},
      env: {},
    });
    expect(result).toEqual({ state: "updated", from: "0.4.1", to: "0.4.2", kept: [] });
    const pkg = JSON.parse(await read("package.json"));
    expect(pkg.dependencies).toEqual({
      "@goodfellow-cms/react": "0.4.2",
      "@goodfellow-cms/blocks": "^0.4.2",
      "@puckeditor/core": "0.23.1",
    });
    expect(pkg.devDependencies).toEqual({ goodfellow: "0.4.2" });
    expect(pkg.overrides).toEqual(SITE_OVERRIDES);
    expect(await read(BLOCK)).toBe("export default { v: 2 };\n");
    expect(ran.filter((line) => !line.startsWith("git rev-parse"))).toEqual([
      // Only what npm had a day after 0.4.2 came out.
      "npm install --no-audit --no-fund --before=2026-10-02T12:00:00.000Z",
      "npm run build",
      expect.stringMatching(/^git add --all -- package\.json package-lock\.json /),
      "git -c user.name=Goodfellow updates -c user.email=updates@goodfellow.invalid commit --message Update Goodfellow to 0.4.2",
      "git push origin HEAD:refs/heads/main",
    ]);
  });

  it("installs Puck's command line again where the lockfile has it at another release than its pin", async () => {
    for (const [version, kept] of [
      ["0.25.0-canary.8b6e0f33", false],
      [PUCK_CLI, true],
    ] as const) {
      await site();
      const lock = {
        name: "parish",
        lockfileVersion: 3,
        packages: {
          "": { name: "parish" },
          "node_modules/@puckeditor/core": { version: "0.24.1" },
          "node_modules/@puckeditor/cli": { version },
        },
      };
      await writeFile(join(root, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
      const { run } = commands();
      await update({ root, fetchJson, run, registry: REGISTRY, log: () => {}, env: {} });
      expect(Object.keys(JSON.parse(await read("package-lock.json")).packages)).toEqual([
        "",
        "node_modules/@puckeditor/core",
        ...(kept ? ["node_modules/@puckeditor/cli"] : []),
      ]);
    }
  });

  it("adds the overrides sites need, leaving out the lockfile's copies of what they replace for npm to install again", async () => {
    await site();
    const lock = {
      name: "parish",
      lockfileVersion: 3,
      packages: {
        "": { name: "parish" },
        "node_modules/happy-dom": { version: "21.0.4" },
        "node_modules/@puckeditor/core": { version: "0.23.0" },
        "node_modules/@puckeditor/core/node_modules/happy-dom": { version: "20.14.6" },
        "node_modules/@puckeditor/core/node_modules/@tiptap/html/node_modules/happy-dom": { version: "20.14.6" },
        "node_modules/other/node_modules/happy-dom": { version: "20.14.6" },
      },
    };
    await writeFile(join(root, "package-lock.json"), `${JSON.stringify(lock, null, 2)}\n`);
    const { run } = commands();
    await update({ root, fetchJson, run, registry: REGISTRY, log: () => {}, env: {} });
    expect(JSON.parse(await read("package.json")).overrides).toEqual(SITE_OVERRIDES);
    expect(Object.keys(JSON.parse(await read("package-lock.json")).packages)).toEqual([
      "",
      "node_modules/happy-dom",
      "node_modules/@puckeditor/core",
      "node_modules/other/node_modules/happy-dom",
    ]);
    // A site that has them already keeps its lockfile as it is.
    const text = await read("package-lock.json");
    await update({ root, fetchJson, run, registry: REGISTRY, to: "0.5.0", log: () => {}, env: {} });
    expect(await read("package-lock.json")).toBe(text);
  });

  it("only commits the update, for a job that runs none of the site's code to publish", async () => {
    await site();
    const { ran, run } = commands();
    const output = join(root, "github-output");
    const env = { GITHUB_OUTPUT: output };
    const result = await update({ root, fetchJson, run, registry: REGISTRY, commit: true, log: () => {}, env });
    expect(result).toMatchObject({ state: "updated", to: "0.4.2" });
    expect(ran.filter((line) => line.startsWith("git ") && !line.startsWith("git rev-parse"))).toEqual([
      expect.stringMatching(/^git add --all -- /),
      "git -c user.name=Goodfellow updates -c user.email=updates@goodfellow.invalid commit --message Update Goodfellow to 0.4.2",
    ]);
    expect(await readFile(output, "utf8")).toBe("commit=true\n");
  });

  it("leaves registry blocks alone unless asked, since publishing an update never takes their code", async () => {
    await site();
    const { run } = commands();
    const result = await update({ root, fetchJson, run, registry: REGISTRY, commit: true, log: () => {}, env: {} });
    expect(result).toMatchObject({ state: "updated", to: "0.4.2", kept: [] });
    expect(await read(BLOCK)).toBe("export default { v: 1 };\n");
  });

  it("updates registry blocks with --blocks on a site Goodfellow is up to date on, as the nightly update leaves it", async () => {
    await site();
    const nightly = commands();
    await update({ root, fetchJson, run: nightly.run, registry: REGISTRY, commit: true, log: () => {}, env: {} });
    expect(await read(BLOCK)).toBe("export default { v: 1 };\n");

    const { ran, run } = commands();
    const result = await update({ root, fetchJson, run, registry: REGISTRY, blocks: true, log: () => {}, env: {} });
    expect(result).toEqual({ state: "up-to-date", from: "0.4.2" });
    expect(await read(BLOCK)).toBe("export default { v: 2 };\n");
    expect(ran).toContain("npm run build");
    // Nothing more to do the next time.
    const again = commands();
    expect(
      await update({ root, fetchJson, run: again.run, registry: REGISTRY, blocks: true, log: () => {}, env: {} }),
    ).toEqual({
      state: "up-to-date",
      from: "0.4.2",
    });
    expect(again.ran).not.toContain("npm run build");
  });

  it("puts back what it wrote where the blocks' record can't be read", async () => {
    await site();
    const before = await read("package.json");
    await writeFile(join(root, "blocks/installed/installed.json"), "{ not json\n");
    const { run } = commands();
    const result = await update({ root, fetchJson, run, registry: REGISTRY, blocks: true, log: () => {}, env: {} });
    expect(result).toMatchObject({ state: "failed", step: "blocks" });
    expect(await read("package.json")).toBe(before);
    expect(await read(BLOCK)).toBe("export default { v: 1 };\n");
  });

  it("doesn't take a blocks record it can't read for an empty one", async () => {
    await site();
    // There, but not a file that can be read.
    await rm(join(root, "blocks/installed/installed.json"));
    await mkdir(join(root, "blocks/installed/installed.json"));
    const { run } = commands();
    const result = await update({ root, fetchJson, run, registry: REGISTRY, blocks: true, log: () => {}, env: {} });
    expect(result).toMatchObject({ state: "failed", step: "blocks" });
    expect(await read(BLOCK)).toBe("export default { v: 1 };\n");
  });

  it("leaves the site's packages alone where the blocks' record can't be read before anything changes", async () => {
    await site();
    await writeFile(join(root, "blocks/installed/installed.json"), "{ not json\n");
    const { ran, run } = commands();
    // Goodfellow is up to date, so nothing is written before the blocks.
    const result = await update({
      root,
      fetchJson,
      run,
      to: "0.4.1",
      registry: REGISTRY,
      blocks: true,
      log: () => {},
      env: {},
    });
    expect(result).toMatchObject({ state: "failed", step: "blocks" });
    expect(ran.filter((line) => line.startsWith("npm"))).toEqual([]);
  });

  it("never takes a block's file it can't read for a missing one", async () => {
    await site();
    // There, but not a file that can be read, as for one the update may not read.
    await rm(join(root, BLOCK));
    await mkdir(join(root, BLOCK));
    const before = await read("package.json");
    const { run } = commands();
    const result = await update({ root, fetchJson, run, registry: REGISTRY, blocks: true, log: () => {}, env: {} });
    expect(result).toMatchObject({ state: "failed", step: "blocks" });
    // Neither written over nor deleted when the update is undone.
    expect((await stat(join(root, BLOCK))).isDirectory()).toBe(true);
    expect(await read("package.json")).toBe(before);
  });

  it("leaves block files someone changed", async () => {
    await site("export default { mine: true };\n");
    const { run } = commands();
    const result = await update({ root, fetchJson, run, registry: REGISTRY, blocks: true, log: () => {}, env: {} });
    expect(result.kept).toEqual([BLOCK]);
    expect(await read(BLOCK)).toBe("export default { mine: true };\n");
  });

  it("puts everything back if the site doesn't build, and says why", async () => {
    await site();
    const before = await read("package.json");
    const cause = { kind: "code" as const, file: BLOCK, message: "Unexpected token" };
    const { ran, run } = commands({ "npm run build": { code: 1, output: `${formatBuildCause(cause)}\n` } });
    const result = await update({
      root,
      fetchJson,
      run,
      registry: REGISTRY,
      blocks: true,
      publish: true,
      log: () => {},
      env: {},
    });
    expect(result).toEqual({ state: "failed", from: "0.4.1", to: "0.4.2", step: "build", cause });
    expect(await read("package.json")).toBe(before);
    expect(await read(BLOCK)).toBe("export default { v: 1 };\n");
    expect(ran).toContain("npm ci --no-audit --no-fund");
    expect(ran.some((line) => line.startsWith("git push"))).toBe(false);
  });

  describe("from Goodfellow's registry on jsDelivr", () => {
    const released = `${JSON.stringify({
      name: "shadcn-faq",
      type: "registry:block",
      title: "FAQ",
      files: [{ path: "blocks/shadcn-faq/block.tsx", type: "registry:block", content: "export default { v: 2 };\n" }],
      meta: { goodfellow: { category: "Sections", version: "1.1.0" } },
    })}\n`;
    /** jsDelivr, answering `text` for the block of `release`. */
    const jsDelivr =
      (text: string, release = "0.4.2") =>
      async (url: string) => {
        if (url !== `https://cdn.jsdelivr.net/npm/@goodfellow-cms/registry@${release}/r/shadcn-faq.json`) {
          throw new Error(`404 ${url}`);
        }
        return text;
      };
    /**
     * The registry release npm installed, as a dependency of the admin panel, beside it or in the admin panel's own
     * folder, with its blocks' digests, none, or a file that isn't digests.
     */
    const installRegistry = async (
      version: string,
      digests: Record<string, string> | string | undefined,
      where: "beside" | "admin" = "beside",
    ) => {
      const admin = join(root, "node_modules/@goodfellow-cms/admin");
      await mkdir(admin, { recursive: true });
      await writeFile(join(admin, "package.json"), JSON.stringify({ name: "@goodfellow-cms/admin", version }));
      const folder = join(where === "admin" ? admin : root, "node_modules/@goodfellow-cms/registry");
      await rm(folder, { recursive: true, force: true });
      await mkdir(join(folder, "r"), { recursive: true });
      await writeFile(join(folder, "package.json"), JSON.stringify({ name: "@goodfellow-cms/registry", version }));
      if (digests !== undefined) {
        await writeFile(
          join(folder, "r/digests.json"),
          typeof digests === "string" ? digests : JSON.stringify(digests),
        );
      }
    };

    it("takes blocks only as the release npm installed says they were built", async () => {
      await site();
      await update({ root, fetchJson, run: commands().run, commit: true, log: () => {}, env: {} });
      await installRegistry("0.4.2", { "shadcn-faq": await hashText(released) });
      const options = { root, fetchJson, blocks: true, log: () => {}, env: {} };
      // Something else answered for the block: nothing is written, and the site isn't built with it.
      const changed = commands();
      const result = await update({
        ...options,
        run: changed.run,
        fetchText: jsDelivr(released.replace("v: 2", "v: 666")),
      });
      expect(result).toMatchObject({ state: "failed", from: "0.4.2", step: "blocks" });
      expect(await read(BLOCK)).toBe("export default { v: 1 };\n");
      expect(changed.ran).not.toContain("npm run build");
      // The block as it was released.
      const same = commands();
      expect(await update({ ...options, run: same.run, fetchText: jsDelivr(released) })).toEqual({
        state: "up-to-date",
        from: "0.4.2",
      });
      expect(await read(BLOCK)).toBe("export default { v: 2 };\n");
    });

    it("finds the registry as the admin panel does, and refuses blocks it can't check", async () => {
      await site();
      await update({ root, fetchJson, run: commands().run, commit: true, log: () => {}, env: {} });
      const options = { root, fetchJson, blocks: true, log: () => {}, env: {}, fetchText: jsDelivr(released) };
      const refused = async () => {
        const { ran, run } = commands();
        expect(await update({ ...options, run })).toMatchObject({ state: "failed", step: "blocks" });
        expect(ran).not.toContain("npm run build");
        expect(await read(BLOCK)).toBe("export default { v: 1 };\n");
      };
      // Without the admin panel, or its registry, nothing says what the release built.
      await refused();
      // A release that has digests but whose file is missing or isn't digests.
      await installRegistry("0.4.2", undefined, "admin");
      await refused();
      await installRegistry("0.4.2", "[]", "admin");
      await refused();
      // The admin panel's own copy is the release's, whatever another copy beside it says.
      await installRegistry("0.4.2", { "shadcn-faq": await hashText(released) }, "admin");
      await installRegistry("0.4.0", { "shadcn-faq": "something else" }, "beside");
      expect(await update({ ...options, run: commands().run })).toEqual({ state: "up-to-date", from: "0.4.2" });
      expect(await read(BLOCK)).toBe("export default { v: 2 };\n");
    });

    it("refuses anything at the release's address but an item's own", async () => {
      await site();
      await update({ root, fetchJson, run: commands().run, commit: true, log: () => {}, env: {} });
      const asking = JSON.parse(released) as Record<string, unknown>;
      asking.registryDependencies = ["https://cdn.jsdelivr.net/npm/@goodfellow-cms/registry@0.4.2/r/accordion.json?x"];
      const text = `${JSON.stringify(asking)}\n`;
      await installRegistry("0.4.2", { "shadcn-faq": await hashText(text) }, "admin");
      const result = await update({
        root,
        fetchJson: async (url) =>
          url.includes("accordion") ? { name: "accordion", type: "registry:ui" } : fetchJson(url),
        fetchText: jsDelivr(text),
        run: commands().run,
        blocks: true,
        log: () => {},
        env: {},
      });
      expect(result).toMatchObject({ state: "failed", step: "blocks" });
      expect(await read(BLOCK)).toBe("export default { v: 1 };\n");
    });

    it("checks each item once, however many blocks share it", async () => {
      await site();
      await update({ root, fetchJson, run: commands().run, commit: true, log: () => {}, env: {} });
      // Two blocks that both need the same component.
      const second = "blocks/installed/shadcn-faq-2/block.tsx";
      await writeFile(
        join(root, "blocks/installed/installed.json"),
        serializeContent({
          version: 1,
          blocks: Object.fromEntries(
            await Promise.all(
              ["shadcn-faq", "shadcn-faq-2"].map(async (name) => {
                const entry = `blocks/installed/${name}/block.tsx`;
                const record = { source: `@goodfellow/${name}`, title: "FAQ", category: "Sections", version: "1.0.0" };
                return [name, { ...record, entry, files: { [entry]: await hashText("export default { v: 1 };\n") } }];
              }),
            ),
          ),
        }),
      );
      await mkdir(join(root, "blocks/installed/shadcn-faq-2"), { recursive: true });
      await writeFile(join(root, second), "export default { v: 1 };\n");
      const block = (name: string) =>
        `${JSON.stringify({
          ...JSON.parse(released),
          name,
          files: [{ path: `blocks/${name}/block.tsx`, type: "registry:block", content: "export default { v: 2 };\n" }],
          registryDependencies: ["@goodfellow/accordion"],
        })}\n`;
      const accordion = (content: string) =>
        `${JSON.stringify({
          name: "accordion",
          type: "registry:ui",
          files: [{ path: "components/ui/accordion.tsx", type: "registry:ui", content }],
        })}\n`;
      const genuine = accordion("export const Accordion = 1;\n");
      await installRegistry(
        "0.4.2",
        {
          "shadcn-faq": await hashText(block("shadcn-faq")),
          "shadcn-faq-2": await hashText(block("shadcn-faq-2")),
          accordion: await hashText(genuine),
        },
        "admin",
      );
      // The first answer for the component isn't the release's; a second, if it were asked for, would be.
      let asked = 0;
      const fetchText = async (url: string) => {
        const name = /\/r\/([^/]+)\.json$/.exec(url)?.[1] ?? "";
        if (name !== "accordion") return block(name);
        asked++;
        return asked === 1 ? accordion("export const Accordion = 666;\n") : genuine;
      };
      const { ran, run } = commands();
      const result = await update({ root, fetchJson, fetchText, run, blocks: true, log: () => {}, env: {} });
      expect(result).toMatchObject({ state: "failed", step: "blocks" });
      expect(asked).toBe(1);
      expect(ran).not.toContain("npm run build");
      await expect(readFile(join(root, "components/ui/accordion.tsx"), "utf8")).rejects.toThrow();
    });

    it("goes back to a release from before digests with its blocks as they come, and says so", async () => {
      await site();
      await update({ root, fetchJson, run: commands().run, commit: true, log: () => {}, env: {} });
      await installRegistry("0.4.1", undefined);
      const lines: string[] = [];
      const back = {
        root,
        fetchJson,
        to: "0.4.1",
        blocks: true,
        log: (line: string) => lines.push(line),
        env: {},
        fetchText: jsDelivr(released, "0.4.1"),
      };
      // A release from since registries had digests, installed without them, isn't what npm published.
      expect(await update({ ...back, run: commands().run, digestsSince: "0.4.1" })).toMatchObject({
        state: "failed",
        step: "blocks",
      });
      expect(await read(BLOCK)).toBe("export default { v: 1 };\n");
      lines.length = 0;
      const result = await update({ ...back, run: commands().run });
      expect(result).toMatchObject({ state: "updated", to: "0.4.1", rollback: true });
      expect(await read(BLOCK)).toBe("export default { v: 2 };\n");
      expect(lines.join("\n")).toContain("0.4.1's blocks can't be checked");
    });

    it("checks the blocks of a release it installs against it before building, and puts everything back", async () => {
      await site();
      const before = await read("package.json");
      // What npm install would leave: the release's registry, which doesn't have what jsDelivr answered.
      await installRegistry("0.4.2", { "shadcn-faq": await hashText(released) });
      const { ran, run } = commands();
      const result = await update({
        root,
        fetchJson,
        fetchText: jsDelivr(released.replace("v: 2", "v: 666")),
        run,
        blocks: true,
        log: () => {},
        env: {},
      });
      expect(result).toMatchObject({ state: "failed", from: "0.4.1", to: "0.4.2", step: "blocks" });
      expect(ran.some((line) => line.startsWith("npm install "))).toBe(true);
      expect(ran).not.toContain("npm run build");
      expect(await read("package.json")).toBe(before);
      expect(await read(BLOCK)).toBe("export default { v: 1 };\n");
    });

    it("writes a release's blocks only once they're checked, so no install script can run them first", async () => {
      await site();
      await installRegistry("0.4.2", { "shadcn-faq": await hashText(released) });
      // A manual update runs install scripts, the site's own `prepare` among them, as the site's `.npmrc` allows.
      const { ran, run } = commands();
      const seen: string[] = [];
      const result = await update({
        root,
        fetchJson,
        fetchText: jsDelivr(released),
        run: async (command, args, cwd) => {
          if (args[0] === "install") seen.push(await read(BLOCK));
          return run(command, args, cwd);
        },
        blocks: true,
        log: () => {},
        env: {},
      });
      expect(result).toMatchObject({ state: "updated", to: "0.4.2" });
      expect(ran.some((line) => line.startsWith("npm install ") && !line.includes("--ignore-scripts"))).toBe(true);
      expect(seen).toEqual(["export default { v: 1 };\n"]);
      expect(await read(BLOCK)).toBe("export default { v: 2 };\n");
    });

    it("plans each block with what the blocks before it would write, though nothing's written yet", async () => {
      await site();
      await update({ root, fetchJson, run: commands().run, commit: true, log: () => {}, env: {} });
      const shared = "components/ui/accordion.tsx";
      const old = "export const Accordion = 1;\n";
      const entryOf = (name: string) => `blocks/installed/${name}/block.tsx`;
      const recorded = async (name: string, files: Record<string, string>) => [
        name,
        {
          source: `@goodfellow/${name}`,
          title: "FAQ",
          category: "Sections",
          version: "1.0.0",
          entry: entryOf(name),
          files,
        },
      ];
      const v1 = await hashText("export default { v: 1 };\n");
      // The first block came with the component; the second needs it only from this release on.
      await writeFile(
        join(root, "blocks/installed/installed.json"),
        serializeContent({
          version: 1,
          blocks: Object.fromEntries([
            await recorded("shadcn-faq", { [entryOf("shadcn-faq")]: v1, [shared]: await hashText(old) }),
            await recorded("shadcn-faq-2", { [entryOf("shadcn-faq-2")]: v1 }),
          ]),
        }),
      );
      await mkdir(join(root, "blocks/installed/shadcn-faq-2"), { recursive: true });
      await writeFile(join(root, entryOf("shadcn-faq-2")), "export default { v: 1 };\n");
      await mkdir(join(root, "components/ui"), { recursive: true });
      await writeFile(join(root, shared), old);
      const block = (name: string) =>
        `${JSON.stringify({
          ...JSON.parse(released),
          name,
          files: [{ path: `blocks/${name}/block.tsx`, type: "registry:block", content: "export default { v: 2 };\n" }],
          registryDependencies: ["@goodfellow/accordion"],
        })}\n`;
      const accordion = `${JSON.stringify({
        name: "accordion",
        type: "registry:ui",
        files: [{ path: shared, type: "registry:ui", content: "export const Accordion = 2;\n" }],
      })}\n`;
      await installRegistry(
        "0.4.2",
        {
          "shadcn-faq": await hashText(block("shadcn-faq")),
          "shadcn-faq-2": await hashText(block("shadcn-faq-2")),
          accordion: await hashText(accordion),
        },
        "admin",
      );
      const fetchText = async (url: string) => {
        const name = /\/r\/([^/]+)\.json$/.exec(url)?.[1] ?? "";
        return name === "accordion" ? accordion : block(name);
      };
      const result = await update({
        root,
        fetchJson,
        fetchText,
        run: commands().run,
        blocks: true,
        log: () => {},
        env: {},
      });
      expect(result).toMatchObject({ state: "up-to-date" });
      expect(await read(shared)).toBe("export const Accordion = 2;\n");
      // The second block's plan saw the component as the first's would leave it, so it's the second's too now.
      const blocks = (
        JSON.parse(await read("blocks/installed/installed.json")) as {
          blocks: Record<string, { files: Record<string, string> }>;
        }
      ).blocks;
      expect(blocks["shadcn-faq-2"]?.files[shared]).toBe(await hashText("export const Accordion = 2;\n"));
    });
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

  it("says when a newer release is out than the fixes it installs, and how to install it", async () => {
    await site();
    const { run } = commands();
    const lines: string[] = [];
    const result = await update({ root, fetchJson, run, registry: REGISTRY, log: (line) => lines.push(line), env: {} });
    expect(result).toMatchObject({ state: "updated", to: "0.4.2" });
    lines.length = 0;
    expect(
      await update({ root, fetchJson, run, registry: REGISTRY, log: (line) => lines.push(line), env: {} }),
    ).toEqual({ state: "up-to-date", from: "0.4.2" });
    expect(lines.join("\n")).toContain("0.5.0 is a newer release");
    expect(lines.join("\n")).toContain("--to latest");
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

  it("installs fixes automatically only once they're old enough, and not deprecated", async () => {
    await site();
    const now = new Date("2026-10-10T12:00:00.000Z");
    const releasesWith =
      (time: Record<string, string>, deprecated: string[] = []) =>
      async (url: string) =>
        url === "https://registry.npmjs.org/@goodfellow-cms/react"
          ? {
              versions: Object.fromEntries(
                ["0.4.1", "0.4.2", "0.4.3"].map((version) => [
                  version,
                  deprecated.includes(version) ? { deprecated: "Taken back" } : {},
                ]),
              ),
              time,
            }
          : fetchJson(url);
    const { ran, run } = commands();
    const lines: string[] = [];
    const options = {
      root,
      run,
      registry: REGISTRY,
      log: (line: string) => lines.push(line),
      env: {},
      now,
      verifyRelease,
    };
    // Published yesterday: it waits, and says how to install it now.
    const fresh = releasesWith({ "0.4.2": "2026-10-09T12:00:00.000Z" });
    expect(await update({ ...options, fetchJson: fresh, to: "automatic" })).toEqual({
      state: "up-to-date",
      from: "0.4.1",
    });
    expect(lines.join("\n")).toContain("isn't installed automatically yet");
    expect(ran).toEqual([]);
    // Asking for it installs it at once, holding back what npm got after now.
    expect(await update({ ...options, fetchJson: fresh, to: "0.4.2" })).toMatchObject({
      state: "updated",
      to: "0.4.2",
    });
    expect(ran).toContain("npm install --no-audit --no-fund --before=2026-10-10T12:00:00.000Z");
    // A deprecated release never installs by itself, however old.
    const older = releasesWith({ "0.4.2": "2026-10-01T12:00:00.000Z", "0.4.3": "2026-10-02T12:00:00.000Z" }, ["0.4.3"]);
    expect(await update({ ...options, fetchJson: older, to: "automatic" })).toEqual({
      state: "up-to-date",
      from: "0.4.2",
    });
    // Nor is it offered as one that's only waiting.
    expect(lines.join("\n")).not.toContain("--to 0.4.3");
    expect(
      await update({ ...options, fetchJson: releasesWith({ "0.4.3": "2026-10-02T12:00:00.000Z" }), to: "automatic" }),
    ).toMatchObject({
      state: "updated",
      to: "0.4.3",
    });
  });

  it("installs automatically only releases Goodfellow's release workflow built, by their provenance", async () => {
    await site();
    const { ran, run } = commands();
    const lines: string[] = [];
    const options = { root, fetchJson, run, registry: REGISTRY, log: (line: string) => lines.push(line), env: {} };
    const elsewhere: ReleaseVerifier = async (name) =>
      name === "goodfellow"
        ? {
            ok: true,
            source: { repository: "https://github.com/someone/fork", workflow: ".github/workflows/release.yml" },
            published: "2026-10-01T12:00:00.000Z",
          }
        : verifyRelease(name, "0.4.2");
    expect(await update({ ...options, to: "automatic", verifyRelease: elsewhere })).toEqual({
      state: "failed",
      from: "0.4.1",
      to: "0.4.2",
      step: "provenance",
    });
    expect(lines.join("\n")).toContain(
      "goodfellow 0.4.2 was built by .github/workflows/release.yml in https://github.com/someone/fork",
    );
    const unsigned: ReleaseVerifier = async (name, version) => ({
      ok: false,
      problem: "no-provenance",
      message: `${name} ${version} has no provenance.`,
    });
    expect(await update({ ...options, to: "automatic", verifyRelease: unsigned })).toMatchObject({
      step: "provenance",
    });
    expect(ran).toEqual([]);
    expect(JSON.parse(await read("package.json")).dependencies["@goodfellow-cms/react"]).toBe("0.4.1");
    // Goodfellow packages the site's own bring are checked too, such as the AI assistant's with the admin panel.
    await site();
    const asked: string[] = [];
    const bringing = async (url: string) =>
      url === "https://registry.npmjs.org/@goodfellow-cms/blocks/0.4.2"
        ? { dependencies: { "@goodfellow-cms/ai": "0.4.2", react: "19.3.1" } }
        : url === "https://registry.npmjs.org/@goodfellow-cms/ai/0.4.2"
          ? { dependencies: { "@goodfellow-cms/core": "0.4.2" } }
          : fetchJson(url);
    const recording: ReleaseVerifier = async (name, version) => {
      asked.push(name);
      return name === "@goodfellow-cms/core"
        ? { ok: false, problem: "unverified", message: `${name} ${version}'s provenance didn't verify.` }
        : verifyRelease(name, version);
    };
    expect(await update({ ...options, fetchJson: bringing, to: "automatic", verifyRelease: recording })).toMatchObject({
      state: "failed",
      step: "provenance",
    });
    expect(asked.sort()).toEqual([
      "@goodfellow-cms/ai",
      "@goodfellow-cms/blocks",
      "@goodfellow-cms/core",
      "@goodfellow-cms/react",
      "goodfellow",
    ]);
    // Where npm can't say what a release brings, it stops rather than check less.
    lines.length = 0;
    const unreadable = async (url: string) =>
      url === "https://registry.npmjs.org/@goodfellow-cms/blocks/0.4.2"
        ? Promise.reject(new Error("503"))
        : fetchJson(url);
    expect(await update({ ...options, fetchJson: unreadable, to: "automatic", verifyRelease })).toMatchObject({
      state: "failed",
      step: "provenance",
    });
    expect(lines.join("\n")).toContain("couldn't be read from npm: 503");
    expect(ran).toEqual([]);
    // Asked for by name, it installs without the check.
    expect(await update({ ...options, to: "0.4.2", verifyRelease: unsigned })).toMatchObject({ state: "updated" });
  });

  it("checks the provenance of every Goodfellow package npm installed, before the build", async () => {
    await site();
    let tampered = false;
    let elsewhere = false;
    const lock = (version: string) =>
      JSON.stringify({
        packages: {
          "": { name: "parish" },
          "node_modules/@goodfellow-cms/react": locked("@goodfellow-cms/react", "0.4.2"),
          "node_modules/@goodfellow-cms/blocks/node_modules/@goodfellow-cms/core": {
            ...locked("@goodfellow-cms/core", version),
            ...(tampered && { integrity: "sha512-elsewhere" }),
            ...(elsewhere && { resolved: "https://evil.example/core.tgz" }),
          },
          "node_modules/react": { version: "19.3.1" },
        },
      });
    // npm writes the lockfile as it installs, here with a newer core than the release a range took.
    const { ran, run: recorded } = commands();
    let installed = "0.4.3";
    const run: RunCommand = async (command, args, cwd) => {
      if (args[0] === "install") await writeFile(join(root, "package-lock.json"), lock(installed));
      return recorded(command, args, cwd);
    };
    const asked: string[] = [];
    const recording: ReleaseVerifier = async (name, version) => {
      asked.push(`${name}@${version}`);
      return version === "0.4.3"
        ? { ok: false, problem: "no-provenance", message: `${name} ${version} has no provenance.` }
        : verifyRelease(name, version);
    };
    const lines: string[] = [];
    const options = { root, fetchJson, run, registry: REGISTRY, log: (line: string) => lines.push(line), env: {} };
    expect(await update({ ...options, to: "automatic", verifyRelease: recording })).toMatchObject({
      state: "failed",
      step: "provenance",
    });
    expect(asked).toContain("@goodfellow-cms/core@0.4.3");
    // Installed without running any package's install script, though this site's `.npmrc` doesn't say so.
    expect(ran).toContainEqual(expect.stringMatching(/^npm install .*--ignore-scripts$/));
    // And put back the same way, once the check refused what it installed.
    expect(ran).toContain("npm ci --no-audit --no-fund --ignore-scripts");
    expect(lines.join("\n")).toContain("@goodfellow-cms/core 0.4.3 has no provenance.");
    expect(ran.some((line) => line.startsWith("npm run build"))).toBe(false);
    // Everything went back as it was.
    expect(JSON.parse(await read("package.json")).dependencies["@goodfellow-cms/react"]).toBe("0.4.1");
    expect(await read("package-lock.json")).toBe(LOCK);
    // A lockfile naming no Goodfellow package isn't one it can check, so it stops.
    const unreadable: RunCommand = async (command, args, cwd) => {
      if (args[0] === "install") await writeFile(join(root, "package-lock.json"), "{}\n");
      return recorded(command, args, cwd);
    };
    expect(await update({ ...options, run: unreadable, to: "automatic", verifyRelease: recording })).toMatchObject({
      state: "failed",
      step: "provenance",
    });
    expect(lines.join("\n")).toContain("names no Goodfellow packages");
    // A file other than the one its provenance is about, or one from anywhere but npm's registry, stops it too.
    installed = "0.4.2";
    tampered = true;
    expect(await update({ ...options, to: "automatic", verifyRelease: recording })).toMatchObject({
      step: "provenance",
    });
    expect(lines.join("\n")).toContain("isn't the file its provenance is about");
    tampered = false;
    elsewhere = true;
    expect(await update({ ...options, to: "automatic", verifyRelease: recording })).toMatchObject({
      step: "provenance",
    });
    expect(lines.join("\n")).toContain("wasn't installed from npm's registry");
    elsewhere = false;
    // The release it asked for everywhere, and it goes ahead.
    installed = "0.4.2";
    expect(await update({ ...options, to: "automatic", verifyRelease: recording })).toMatchObject({
      state: "updated",
      to: "0.4.2",
    });
  });

  it("goes back to an older release, and skips the one it left until it's chosen again", async () => {
    await site();
    const withFix = async (url: string) =>
      url === "https://registry.npmjs.org/@goodfellow-cms/react"
        ? {
            versions: { "0.4.1": {}, "0.4.2": {}, "0.4.3": {}, "0.5.0": {} },
            time: { "0.4.2": "2026-10-01T12:00:00.000Z", "0.4.3": "2026-10-05T12:00:00.000Z" },
          }
        : fetchJson(url);
    const { ran, run } = commands();
    const options = { root, fetchJson: withFix, run, registry: REGISTRY, log: () => {}, env: {}, verifyRelease };
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

    it("puts back what it wrote where one of them can't be read", async () => {
      await site();
      const before = await read("package.json");
      await mkdir(join(root, "app/admin/page.tsx"), { recursive: true });
      await expect(update({ ...options(), siteFiles: files })).rejects.toThrow(/EISDIR/);
      expect(await read("package.json")).toBe(before);
      expect((await stat(join(root, "app/admin/page.tsx"))).isDirectory()).toBe(true);
      expect(await read("app/admin/editor/page.tsx").catch(() => undefined)).toBeUndefined();
    });

    it("reports both errors where putting the site back fails too", async () => {
      await site();
      await mkdir(join(root, "app/admin/page.tsx"), { recursive: true });
      const run: RunCommand = async (command, args) => {
        if (command === "npm" && args[0] === "ci") throw new Error("npm couldn't be started");
        return { code: 0, output: "abc123\n" };
      };
      const failure = await update({ ...options(), run, siteFiles: files }).catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(AggregateError);
      const { errors } = failure as AggregateError;
      expect(String(errors[0])).toMatch(/EISDIR/);
      expect(String(errors[1])).toMatch(/npm couldn't be started/);
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
