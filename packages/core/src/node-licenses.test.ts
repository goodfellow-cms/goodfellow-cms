import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundledPackages, licenseNotices, licensesPlugin } from "./node-licenses.js";

/** A folder of packages, as a site's `node_modules` holds them. */
function packages(): string {
  const root = mkdtempSync(join(tmpdir(), "goodfellow-licenses-"));
  const add = (name: string, json: Record<string, unknown>, files: Record<string, string>) => {
    const dir = join(root, "node_modules", name);
    mkdirSync(join(dir, "dist", "esm"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name, ...json }));
    // A nested package.json that only says what kind of modules are under it.
    writeFileSync(join(dir, "dist", "esm", "package.json"), JSON.stringify({ type: "module" }));
    writeFileSync(join(dir, "dist", "esm", "index.js"), "");
    for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  };
  add(
    "goodfellow-plugin-gutenberg",
    { version: "1.0.0", license: "GPL-2.0-or-later", repository: "github:goodfellow-cms/goodfellow-plugin-gutenberg" },
    { LICENSE: "GNU GENERAL PUBLIC LICENSE\nVersion 2" },
  );
  add(
    "@wordpress/blocks",
    {
      version: "16.2.0",
      license: "GPL-2.0-or-later",
      repository: { type: "git", url: "git+https://github.com/WordPress/gutenberg.git", directory: "packages/blocks" },
    },
    { "LICENSE.md": "GNU GENERAL PUBLIC LICENSE\nVersion 2" },
  );
  add("react", { version: "19.3.0", license: "MIT" }, { LICENSE: "MIT License", NOTICE: "Made by Meta" });
  add("unlicensed", {}, {});
  return root;
}

const file = (root: string, name: string) => join(root, "node_modules", name, "dist", "esm", "index.js");

describe("license notices for plugins' frames", () => {
  it("finds the package each bundled file belongs to, with its license and where its source is", async () => {
    const root = packages();
    const found = await bundledPackages([
      file(root, "react"),
      `${file(root, "react")}?commonjs-proxy`,
      file(root, "@wordpress/blocks"),
      file(root, "goodfellow-plugin-gutenberg"),
      file(root, "unlicensed"),
      "\0virtual:goodfellow/plugin-frame",
    ]);
    expect(found.map(({ name, license, source }) => ({ name, license, source }))).toEqual([
      {
        name: "@wordpress/blocks",
        license: "GPL-2.0-or-later",
        source: "https://github.com/WordPress/gutenberg/tree/HEAD/packages/blocks",
      },
      {
        name: "goodfellow-plugin-gutenberg",
        license: "GPL-2.0-or-later",
        source: "https://github.com/goodfellow-cms/goodfellow-plugin-gutenberg",
      },
      { name: "react", license: "MIT", source: "https://www.npmjs.com/package/react/v/19.3.0" },
      { name: "unlicensed", license: undefined, source: "https://www.npmjs.com/package/unlicensed" },
    ]);
    expect(found.find((pkg) => pkg.name === "react")?.text).toBe("MIT License\n\nMade by Meta");
  });

  it("lists every package, and each license text once", async () => {
    const root = packages();
    const notices = licenseNotices(
      "Gutenberg",
      await bundledPackages(
        ["goodfellow-plugin-gutenberg", "@wordpress/blocks", "react"].map((name) => file(root, name)),
      ),
    );
    expect(notices).toContain(
      "- goodfellow-plugin-gutenberg 1.0.0: GPL-2.0-or-later, source at https://github.com/goodfellow-cms/goodfellow-plugin-gutenberg",
    );
    expect(notices).toContain("The license text of @wordpress/blocks 16.2.0, goodfellow-plugin-gutenberg 1.0.0:");
    expect(notices.match(/GNU GENERAL PUBLIC LICENSE/g)).toHaveLength(1);
    expect(notices).toContain("The license text of react 19.3.0:\n\nMIT License\n\nMade by Meta");
  });

  it("writes them as a file of the build, from its chunks' modules", async () => {
    const root = packages();
    const emitted: { fileName: string; source: string }[] = [];
    await licensesPlugin("Gutenberg", "admin/plugins/gutenberg/LICENSES.txt").generateBundle.call(
      { emitFile: (asset) => emitted.push(asset) },
      {},
      {
        "plugin.js": { type: "chunk", moduleIds: [file(root, "react")] },
        "plugin.css": { type: "asset" },
      },
    );
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.fileName).toBe("admin/plugins/gutenberg/LICENSES.txt");
    expect(emitted[0]?.source).toContain("- react 19.3.0: MIT");
  });
});
