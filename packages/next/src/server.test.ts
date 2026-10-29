import { APP_API_HEADER, type AppEditor, defineConfig } from "@goodfellow-cms/core";
import { github } from "@goodfellow-cms/github";
import { fakeGitHub } from "@goodfellow-cms/github/testing";
import { gitlab } from "@goodfellow-cms/gitlab";
import { fakeGitLab } from "@goodfellow-cms/gitlab/testing";
import { afterEach, describe, expect, it, vi } from "vitest";
import { goodfellowApi } from "./server.js";

const FILES = {
  "content/site.json": '{"version":1,"title":"St. Joseph"}',
  "content/pages/index.json": '{"version":1,"data":{"root":{"props":{"title":"Home"}},"content":[]}}',
};

const ALICE: AppEditor = { login: "alice", name: "Alice Editor", email: "alice@example.org", role: "editor" };

/** Calls a route made by `goodfellowApi()` as Next.js would, from a page of the site. */
function caller(route: ReturnType<typeof goodfellowApi>) {
  return async (endpoint: string, init: RequestInit = {}) => {
    const request = new Request(`https://parish.example/api/goodfellow/${endpoint}`, {
      ...init,
      headers: { [APP_API_HEADER]: "1", "sec-fetch-site": "same-origin", ...init.headers },
    });
    const path = new URL(request.url).pathname.slice("/api/goodfellow/".length).split("/").filter(Boolean);
    const handler = request.method === "POST" ? route.POST : route.GET;
    return handler(request, { params: Promise.resolve({ path }) });
  };
}

describe("goodfellowApi", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("publishes to GitHub with the server's token, in the editor's name", async () => {
    const fake = fakeGitHub({ repo: "parish/site", files: FILES });
    vi.stubEnv("GOODFELLOW_GIT_TOKEN", "test-token");
    const call = caller(
      goodfellowApi({
        config: defineConfig({ blocks: {}, backend: github({ repo: "parish/site", fetch: fake.fetch }) }),
        authorize: () => ALICE,
        signIn: "/sign-in",
      }),
    );
    const { revision } = (await (await call("revision/")).json()) as { revision: string };
    const home = await call(`file/?path=content/pages/index.json&revision=${revision}`);
    expect(await home.json()).toEqual({ content: FILES["content/pages/index.json"] });

    const saved = await call("write/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        changes: [{ path: "content/pages/about.json", content: "{}" }],
        message: "Add About",
        expectedRevision: revision,
      }),
    });
    const { revision: next } = (await saved.json()) as { revision: string };
    expect(fake.commitAuthors.get(next)).toMatchObject({ name: "Alice Editor", email: "alice@example.org" });
  });

  it("publishes to GitLab the same way", async () => {
    const fake = fakeGitLab({ project: "parish/site", files: FILES });
    const call = caller(
      goodfellowApi({
        config: defineConfig({ blocks: {}, backend: gitlab({ project: "parish/site", fetch: fake.fetch }) }),
        token: "test-token",
        authorize: () => ALICE,
        signIn: "/sign-in",
      }),
    );
    const { revision } = (await (await call("revision/")).json()) as { revision: string };
    const saved = await call("write/", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        changes: [{ path: "content/pages/about.json", content: "{}" }],
        message: "Add About",
        expectedRevision: revision,
      }),
    });
    const { revision: next } = (await saved.json()) as { revision: string };
    expect(fake.commitAuthors.get(next)).toEqual({ name: "Alice Editor", email: "alice@example.org" });
  });

  it("says what's missing on the first request, so builds need no token", async () => {
    const route = goodfellowApi({ config: defineConfig({ blocks: {} }), authorize: () => ALICE, signIn: "/" });
    await expect(caller(route)("revision/")).rejects.toThrow("needs the config's `backend`");

    const fake = fakeGitHub({ repo: "parish/site", files: FILES });
    vi.stubEnv("GOODFELLOW_GIT_TOKEN", "");
    const tokenless = goodfellowApi({
      config: defineConfig({ blocks: {}, backend: github({ repo: "parish/site", fetch: fake.fetch }) }),
      authorize: () => ALICE,
      signIn: "/",
    });
    await expect(caller(tokenless)("revision/")).rejects.toThrow("set GOODFELLOW_GIT_TOKEN");
  });

  it("offers the AI services it has keys for", async () => {
    const fake = fakeGitHub({ repo: "parish/site", files: FILES });
    const call = caller(
      goodfellowApi({
        config: defineConfig({ blocks: {}, backend: github({ repo: "parish/site", fetch: fake.fetch }) }),
        token: "test-token",
        authorize: () => ALICE,
        signIn: "/sign-in",
        signOut: "/sign-out",
        ai: { anthropic: "sk-ant-site", openai: undefined },
      }),
    );
    expect(await (await call("session/")).json()).toEqual({
      signedIn: true,
      user: { login: "alice", name: "Alice Editor" },
      role: "editor",
      ai: ["anthropic"],
      codeReview: true,
      signOut: "/sign-out",
    });
  });

  it("lets owners publish the site's code only where the route says so", async () => {
    const fake = fakeGitHub({ repo: "parish/site", files: FILES });
    const call = caller(
      goodfellowApi({
        config: defineConfig({ blocks: {}, backend: github({ repo: "parish/site", fetch: fake.fetch }) }),
        token: "test-token",
        authorize: () => ALICE,
        signIn: "/sign-in",
        codeChanges: "publish",
      }),
    );
    expect(await (await call("session/")).json()).not.toHaveProperty("codeReview");
  });
});
