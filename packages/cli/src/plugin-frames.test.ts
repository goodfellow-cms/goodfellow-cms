import { existsSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPluginFrame } from "./plugin-frames.js";

describe("buildPluginFrame", () => {
  let root: string;
  beforeEach(async () => {
    // In the package, so the bundler finds the admin panel's packages.
    root = await mkdtemp(join(process.cwd(), ".plugin-frame-test-"));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  const plugin = { name: "goodfellow-plugin-x", title: "X", admin: "./admin.ts" };

  it("writes a frame of its script, styles, and page", async () => {
    await writeFile(join(root, "admin.ts"), "export default { mount() {} };\n");
    await buildPluginFrame(plugin, { root, base: "/", outDir: join(root, "dist") });
    const files = await readdir(join(root, "dist/admin/plugins/goodfellow-plugin-x"));
    expect(files).toContain("index.html");
    expect(files.some((file) => file.endsWith(".js"))).toBe(true);
  }, 120_000);

  it("stops at a page the admin module brings as an address, which would open at the admin panel's", async () => {
    await writeFile(join(root, "help.html"), "<!DOCTYPE html><script>steal()</script>\n");
    await writeFile(join(root, "pic.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>steal()</script></svg>\n');
    await writeFile(
      join(root, "admin.ts"),
      'import help from "./help.html?url";\nimport pic from "./pic.svg?no-inline";\nexport default { help, pic, mount() {} };\n',
    );
    await expect(buildPluginFrame(plugin, { root, base: "/", outDir: join(root, "dist") })).rejects.toThrow(
      /help-[\w-]+\.html.*pic-[\w-]+\.svg|pic-[\w-]+\.svg.*help-[\w-]+\.html/,
    );
    expect(existsSync(join(root, "dist/admin/plugins/goodfellow-plugin-x/index.html"))).toBe(true);
  }, 120_000);
});
