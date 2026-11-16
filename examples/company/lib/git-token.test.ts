import { hostSource } from "@goodfellow-cms/core";
import { github as githubHost } from "@goodfellow-cms/github";
import { convertAppManifest, publishingAppManifest } from "@goodfellow-cms/github/app";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteEnv } from "./env.ts";
import { gitToken } from "./git-token.ts";

const CONTENT = "someone/acme-content";
const backend = {
  source: hostSource("@goodfellow-cms/github", "github", { repo: CONTENT, contentOnly: true }, []),
};

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A fake GitHub with the site's publishing app installed on the content repository, and the site's variables for it. */
async function withApp() {
  const github = fakeGitHub({ repo: CONTENT });
  vi.stubGlobal("fetch", github.fetch);
  const manifest = publishingAppManifest({
    name: "acme-content publishing",
    url: "https://a.example",
    redirectUrl: "https://a.example/",
    setupUrl: "https://a.example/",
  });
  const { code, app } = await github.createApp(manifest, "someone");
  const made = await convertAppManifest(code, { fetch: github.fetch });
  github.install(app.slug, "someone", [CONTENT]);
  const vars: SiteEnv = {
    GOODFELLOW_APP_ID: String(made.id),
    // As a Worker's secret may hold it, on one line.
    GOODFELLOW_APP_KEY: made.pem.trim().replace(/\n/g, "\\n"),
    GOODFELLOW_GIT_TOKEN: "ignored",
  };
  return { github, vars };
}

describe("gitToken", () => {
  it("makes the content repository's token from the site's publishing app, and keeps it", async () => {
    const { github, vars } = await withApp();
    const token = gitToken(backend, async () => vars);
    const first = await token();
    expect(first).toMatch(/^ghs_/);
    expect(await token()).toBe(first);
    expect(github.issued.at(-1)).toMatchObject({
      token: first,
      repositories: [CONTENT],
      permissions: { contents: "write" },
    });
    // Where GitHub refused it, the backend asks for another, which is kept in its place.
    const again = await token({ refresh: true });
    expect(again).toMatch(/^ghs_/);
    expect(again).not.toBe(first);
    expect(await token()).toBe(again);
  });

  it("makes the token again where GitHub refuses it, when the site's backend tries once more", async () => {
    const { github, vars } = await withApp();
    const token = gitToken(backend, async () => vars);
    const refused = await token();
    let refusals = 0;
    // GitHub refuses the token it has, as once it's been revoked.
    const fetcher: typeof fetch = async (input, init) => {
      if (new Headers(init?.headers).get("authorization") === `Bearer ${refused}`) {
        refusals++;
        return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
      }
      return github.fetch(input, init);
    };
    const host = githubHost({ repo: CONTENT, contentOnly: true, fetch: fetcher });
    if (!host.server) throw new Error("no server");
    expect(await host.server({ token }).revision()).toMatch(/^[0-9a-f]{40}$/);
    expect(refusals).toBe(1);
    expect(await token()).not.toBe(refused);
  });

  it("uses GOODFELLOW_GIT_TOKEN where there's no app, and says what's missing where there's neither", async () => {
    expect(await gitToken(backend, async () => ({ GOODFELLOW_GIT_TOKEN: "github_pat_x" }))()).toBe("github_pat_x");
    // Half an app is no app.
    expect(await gitToken(backend, async () => ({ GOODFELLOW_APP_ID: "1", GOODFELLOW_GIT_TOKEN: "t" }))()).toBe("t");
    await expect(gitToken(backend, async () => ({}))()).rejects.toThrow(/GOODFELLOW_APP_ID and GOODFELLOW_APP_KEY/);
  });

  it("refuses an app for a backend that isn't GitHub's", async () => {
    const gitlab = { source: hostSource("@goodfellow-cms/gitlab", "gitlab", { project: "a/b" }, []) };
    await expect(gitToken(gitlab, async () => ({ GOODFELLOW_APP_ID: "1", GOODFELLOW_APP_KEY: "k" }))()).rejects.toThrow(
      /GitHub repository/,
    );
  });
});
