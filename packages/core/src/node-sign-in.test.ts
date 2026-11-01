import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { setSignIn } from "./node-sign-in.js";

async function site(backend: string) {
  const root = await mkdtemp(join(tmpdir(), "goodfellow-sign-in-"));
  await writeFile(join(root, "goodfellow.config.tsx"), `export default defineConfig({\n  ${backend}\n});\n`);
  return root;
}

describe("setSignIn", () => {
  it("names a GitHub site's sign-in service, and takes it out", async () => {
    const root = await site(`backend: github({ repo: "parish/site" }),`);
    expect(await setSignIn(root, "https://sign-in.parish.workers.dev/")).toEqual({
      host: "github",
      value: "https://sign-in.parish.workers.dev",
    });
    expect(await readFile(join(root, "goodfellow.config.tsx"), "utf8")).toContain(
      `github({ repo: "parish/site", signIn: "https://sign-in.parish.workers.dev" })`,
    );
    await setSignIn(root, undefined);
    expect(await readFile(join(root, "goodfellow.config.tsx"), "utf8")).toContain(`github({ repo: "parish/site" })`);
    await expect(setSignIn(root, "http://localhost:8787")).rejects.toThrow("https://");
  });

  it("gives a GitLab or Bitbucket site its application's id", async () => {
    const root = await site(`backend: gitlab({ project: "parish/site", contentOnly: true }),`);
    expect((await setSignIn(root, " 5832fc6e14300a0d9622 ")).value).toBe("5832fc6e14300a0d9622");
    expect(await readFile(join(root, "goodfellow.config.tsx"), "utf8")).toContain(
      `gitlab({ project: "parish/site", contentOnly: true, clientId: "5832fc6e14300a0d9622" })`,
    );
    await expect(setSignIn(root, "not an id")).rejects.toThrow("GitLab application's ID");
  });

  it("says when the config has no backend yet", async () => {
    const root = await site(`// backend: github({ repo: "your-name/your-site" }),`);
    await expect(setSignIn(root, "https://sign-in.example")).rejects.toThrow("doesn't say where the site is stored");
  });
});
