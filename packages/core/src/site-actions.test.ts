import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "../../..");
const ACTION = /uses:\s*["']?([\w.-]+\/[\w./-]+@[\w.-]+)/g;

/** Every action a text names, as `owner/repo@ref`. */
function actionsIn(text: string): string[] {
  return [...text.matchAll(ACTION)].map((match) => match[1] ?? "");
}

async function files(dir: string, keep: (name: string) => boolean): Promise<string[]> {
  const entries = await readdir(join(ROOT, dir), { withFileTypes: true, recursive: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isFile() && keep(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !path.includes("node_modules"));
}

/**
 * Sites' workflows name actions by their major version's tag, such as
 * `actions/checkout@v5`, never a commit, as this repository's own do: a site's
 * update can't change its workflows and sites have no Dependabot, so a pinned
 * commit would never move, and the site would miss the action's fixes until
 * GitHub retired the Node.js it runs on and its builds stopped. That's only
 * safe for GitHub's own actions, which are as trusted as GitHub's runners
 * already are, so sites may use no other.
 */
describe("the actions sites' workflows use", () => {
  it("are only GitHub's own, by their major version", async () => {
    const sources = [
      // Every workflow core writes for new sites, content repositories, Cloudflare Pages and token brokers.
      ...(await files("packages/core/src", (name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))),
      // And the ones the starters and the example have.
      ...(await files("templates", (name) => name.endsWith(".yml"))),
      ...(await files("examples", (name) => name.endsWith(".yml"))),
    ];
    const found = new Map<string, string>();
    for (const path of sources) {
      for (const action of actionsIn(await readFile(path, "utf8"))) found.set(action, path);
    }
    expect(found.size).toBeGreaterThan(5);
    for (const [action, path] of found) {
      expect(action, `${action} in ${path}`).toMatch(/^actions\/[\w.-]+@v\d+$/);
    }
  });
});
