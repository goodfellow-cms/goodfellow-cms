import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pluginId } from "@goodfellow-cms/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPluginFrame } from "./plugins.js";

const PLUGIN = { name: "goodfellow-plugin-x", title: "X", admin: "./admin.ts" };

describe("buildPluginFrame while watching", () => {
  let root: string;
  beforeEach(async () => {
    // In the package, so the bundler finds the admin panel's packages.
    root = await mkdtemp(join(process.cwd(), ".plugin-frame-test-"));
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("takes out what an earlier build left, keeping the page and stylesheet it writes itself", async () => {
    await writeFile(join(root, "admin.ts"), "export default { mount() {} };\n");
    const dir = join(root, pluginId(PLUGIN.name));
    const builds: (Error | undefined)[] = [];
    let built: () => void = () => {};
    const next = () => new Promise<void>((done) => (built = done));
    let waiting = next();
    const close = await buildPluginFrame(PLUGIN, {
      root,
      dir,
      watch: {
        onBuilt(error) {
          builds.push(error);
          built();
        },
      },
    });
    try {
      await waiting;
      expect(builds[0]).toBeUndefined();
      // A page an earlier build's import brought, which the author has since taken out.
      await writeFile(join(dir, "help-Ab12Cd34.html"), "<script>steal()</script>\n");
      const earlier = new Date(Date.now() - 60_000);
      for (const file of await readdir(dir)) await utimes(join(dir, file), earlier, earlier);
      waiting = next();
      await writeFile(join(root, "admin.ts"), "export default { mount() { return; } };\n");
      await waiting;
      expect(builds[1]).toBeUndefined();
      const files = await readdir(dir);
      expect(files).not.toContain("help-Ab12Cd34.html");
      expect(files).toEqual(expect.arrayContaining(["index.html", "plugin.css", "plugin.js", "LICENSES.txt"]));
    } finally {
      await close();
    }
  }, 120_000);

  it("refuses a folder that isn't the frame's own, such as public/, leaving its files as they were", async () => {
    await writeFile(join(root, "admin.ts"), "export default { mount() {} };\n");
    const dir = join(root, "public");
    await mkdir(dir);
    await writeFile(join(dir, "favicon.ico"), "icon");
    const earlier = new Date(Date.now() - 60_000);
    await utimes(join(dir, "favicon.ico"), earlier, earlier);
    await expect(buildPluginFrame(PLUGIN, { root, dir, watch: { onBuilt() {} } })).rejects.toThrow(
      "a folder of its own",
    );
    expect(await readdir(dir)).toEqual(["favicon.ico"]);
  });
});
