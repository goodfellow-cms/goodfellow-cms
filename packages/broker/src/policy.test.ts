import { brokerCalls, type GitBackend } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { decide } from "./policy.js";

const SITE = "https://example.org/";

describe("what the broker asks before making a call", () => {
  it("publishes content as it is", async () => {
    const call = { path: "write", args: [[{ path: "content/pages/about.json", content: "{}" }]], target: {} };
    expect(await decide(call, SITE)).toEqual({ action: "allow" });
  });

  it("asks about code, custom code, and the Site address, together", async () => {
    const changes = [
      { path: "blocks/installed/faq/block.tsx", content: "" },
      { path: "components/ui/accordion.tsx", content: "" },
      { path: "content/code/head.html", content: "<script></script>" },
    ];
    expect(await decide({ path: "draft.store.write", args: [changes], target: {} }, SITE)).toEqual({
      action: "ask",
      questions: [
        { kind: "code", paths: ["blocks/installed/faq/block.tsx", "components/ui/accordion.tsx"] },
        { kind: "custom-code", paths: ["content/code/head.html"] },
      ],
    });
  });

  it("says which plugins a publish installs, and what they ask to do", async () => {
    const entry = (release: string) => ({
      release,
      installed: "2026-10-25",
      manifest: { version: 1, title: "Guestbook", permissions: { connect: ["https://guestbook.example.com"] } },
    });
    const record = (plugins: Record<string, unknown>) => JSON.stringify({ version: 1, plugins });
    const target = {
      read: async (path: string) =>
        path === "plugins/installed/installed.json"
          ? record({ "goodfellow-plugin-guestbook": entry("1.0.0"), "goodfellow-plugin-old": entry("2.0.0") })
          : undefined,
    };
    const changes = [
      { path: "package.json", content: "{}" },
      {
        path: "plugins/installed/installed.json",
        content: record({ "goodfellow-plugin-guestbook": entry("1.1.0") }),
      },
    ];
    expect(await decide({ path: "write", args: [changes], target }, SITE)).toEqual({
      action: "ask",
      questions: [
        {
          kind: "plugins",
          installed: [{ name: "goodfellow-plugin-guestbook", ...entry("1.1.0") }],
          removed: ["goodfellow-plugin-old"],
        },
        { kind: "code", paths: ["package.json", "plugins/installed/installed.json"] },
      ],
    });
  });

  it("asks about a theme installed before it's three days old, naming where it says it was built", async () => {
    const early = {
      from: "1.0.0",
      repository: "https://github.com/example/goodfellow-theme-harbor",
      workflow: ".github/workflows/release.yml",
    };
    const changes = [
      {
        path: "content/styles/theme.json",
        content: JSON.stringify({
          version: 1,
          name: "goodfellow-theme-harbor",
          release: "1.1.0",
          title: "Harbor",
          early,
        }),
      },
    ];
    expect(await decide({ path: "write", args: [changes], target: {} }, SITE)).toEqual({
      action: "ask",
      questions: [{ kind: "theme-early", name: "goodfellow-theme-harbor", release: "1.1.0", ...early }],
    });
    // Written as bytes, which every backend publishes alike.
    const [record] = changes;
    if (!record) throw new Error("No record");
    const bytes = [{ path: record.path, bytes: new TextEncoder().encode(record.content) }];
    expect(await decide({ path: "write", args: [bytes], target: {} }, SITE)).toEqual({
      action: "ask",
      questions: [{ kind: "theme-early", name: "goodfellow-theme-harbor", release: "1.1.0", ...early }],
    });
  });

  it("refuses workflows, even beside content", async () => {
    const changes = [
      { path: "content/pages/about.json", content: "{}" },
      { path: ".github/workflows/deploy.yml", content: "" },
    ];
    expect(await decide({ path: "write", args: [changes], target: {} }, SITE)).toEqual({
      action: "refuse",
      paths: [".github/workflows/deploy.yml"],
      reason: "workflow",
    });
  });

  it("refuses publishing what's outside the signed-in person's limits, but not keeping it in a draft", async () => {
    const files: Record<string, string> = {
      "content/site.json": '{"version":1,"title":"Parish"}',
      "content/permissions.json": '{"version":1,"people":{"maria":{"pages":["/news"]}}}',
      "content/pages/about.json": '{"version":1,"data":{"root":{"props":{}},"content":[]}}',
    };
    const backend = {
      user: { login: "Maria" },
      read: async (path: string) => files[path],
      list: async () => [],
    } as unknown as GitBackend;
    const about = [{ path: "content/pages/about.json", content: '{"version":1,"data":{"root":{},"content":[]}}' }];
    const news = [{ path: "content/pages/news.json", content: '{"version":1,"data":{"root":{},"content":[]}}' }];
    expect(await decide({ path: "write", args: [about], target: backend }, SITE, backend)).toEqual({
      action: "refuse",
      paths: ["content/pages/about.json"],
      reason: "limits",
    });
    expect(await decide({ path: "write", args: [news], target: backend }, SITE, backend)).toEqual({ action: "allow" });
    expect(await decide({ path: "draft.store.write", args: [about], target: {} }, SITE, backend)).toEqual({
      action: "allow",
    });
    const draft = { changes: async () => about };
    expect(await decide({ path: "draft.publish", args: ["Publish all"], target: draft }, SITE, backend)).toMatchObject({
      action: "refuse",
      reason: "limits",
    });
  });

  it("checks a draft's changes when it's published, or the changes it's asked to publish", async () => {
    const draft = { changes: async () => [{ path: "package.json", content: "{}" }] };
    expect(await decide({ path: "draft.publish", args: ["Publish all"], target: draft }, SITE)).toEqual({
      action: "ask",
      questions: [{ kind: "code", paths: ["package.json"] }],
    });
    const given = { changes: [{ path: ".github/workflows/deploy.yml", content: "" }] };
    expect(await decide({ path: "draft.publish", args: ["Publish all", given], target: draft }, SITE)).toEqual({
      action: "refuse",
      paths: [".github/workflows/deploy.yml"],
      reason: "workflow",
    });
  });

  it("asks before installing a release or giving someone access", async () => {
    expect(await decide({ path: "updates.start", args: ["0.5.0"], target: {} }, SITE)).toEqual({
      action: "ask",
      questions: [{ kind: "update", release: "0.5.0" }],
    });
    expect(await decide({ path: "editors.invite", args: ["eve", "owner"], target: {} }, SITE)).toEqual({
      action: "ask",
      questions: [{ kind: "editors", who: "eve", role: "owner" }],
    });
    expect(await decide({ path: "pages.status", args: ["example.org"], target: {} }, SITE)).toEqual({
      action: "allow",
    });
  });

  it("asks before changing domains, taking access away, running tasks, setting up updates, or throwing away a draft", async () => {
    const ask = async (path: string, args: unknown[], target: unknown = {}) =>
      ((await decide({ path, args, target }, SITE)) as { questions?: unknown[] }).questions;
    expect(await ask("pages.connect", ["example.org", {}])).toEqual([
      { kind: "domain", change: "connect", domain: "example.org" },
    ]);
    expect(await ask("pages.secure", ["example.org"])).toEqual([
      { kind: "domain", change: "secure", domain: "example.org" },
    ]);
    expect(await ask("pages.disconnect", ["example.org"])).toEqual([
      { kind: "domain", change: "disconnect", domain: "example.org" },
    ]);
    const editors = { list: async () => ({ editors: [{ id: "1", login: "ann", role: "editor" }], manage: "yes" }) };
    expect(await ask("editors.remove", [{ id: "1", login: "ann", role: "editor" }], editors)).toEqual([
      { kind: "editors-remove", who: "ann" },
    ]);
    expect(await ask("tasks.run", [{ id: "r", plugin: "s3", task: "sign", input: "{}", key: "{}" }])).toEqual([
      { kind: "task", plugin: "s3", task: "sign" },
    ]);
    expect(await ask("updates.enable", [])).toEqual([{ kind: "updates-setup" }]);
    expect(await ask("draft.discard", [], { name: "spring" })).toEqual([{ kind: "discard-draft", name: "spring" }]);
  });

  it("names the editor the site's list gives the id, and hands the call that editor, never the admin panel's", async () => {
    const ann = { id: "1", login: "ann", role: "editor" };
    const editors = { list: async () => ({ editors: [ann, { id: "2", login: "bob", role: "owner" }], manage: "yes" }) };
    for (const path of ["editors.remove", "editors.setRole"]) {
      // The admin panel says "eve", but the backend would act on id 1, which is Ann.
      const given = { id: "1", login: "eve", role: "viewer" };
      const args: unknown[] = [given, "owner"];
      const decision = await decide({ path, args, target: editors }, SITE);
      expect(decision, path).toMatchObject({ action: "ask", questions: [{ who: "ann" }], args: [ann, "owner"] });
      // Handed back in the decision, never written over what the call came with.
      expect(args[0], path).toBe(given);
      expect(
        await decide({ path, args: [{ id: "..", login: "ann", role: "editor" }, "owner"], target: editors }, SITE),
        path,
      ).toEqual({ action: "refuse", paths: [path], reason: "editor" });
      expect(await decide({ path, args: ["ann", "owner"], target: editors }, SITE), path).toMatchObject({
        action: "refuse",
      });
      // A list that can't be read, or isn't one, names nobody: refused as the broker's own, never thrown.
      for (const broken of [
        { list: async () => Promise.reject(new Error("403")) },
        { list: async () => ({}) },
        { list: async () => ({ editors: [null] }) },
      ]) {
        expect(await decide({ path, args: [ann, "owner"], target: broken }, SITE), path).toEqual({
          action: "refuse",
          paths: [path],
          reason: "editor",
        });
      }
    }
  });

  it("asks before making a repository for comments or deleting one, but moderates in ways that can be undone", async () => {
    expect(await decide({ path: "comments.create", args: ["site-comments", "Comments"], target: {} }, SITE)).toEqual({
      action: "ask",
      questions: [{ kind: "comments-create", name: "site-comments" }],
    });
    expect(await decide({ path: "comments.remove", args: ["DC_1"], target: {} }, SITE)).toEqual({
      action: "ask",
      questions: [{ kind: "comments-delete" }],
    });
    for (const [path, args] of [
      ["comments.threads", [{ repo: "example/comments" }]],
      ["comments.hide", ["DC_1", "spam"]],
      ["comments.show", ["DC_1"]],
      ["comments.lock", ["D_1"]],
      ["comments.find", ["example/comments"]],
    ] as const) {
      expect(await decide({ path, args: [...args], target: {} }, SITE), path).toEqual({ action: "allow" });
    }
  });

  it("refuses calls it doesn't know, so one added later isn't made unchecked", async () => {
    expect(await decide({ path: "pages.somethingNew", args: [], target: {} }, SITE)).toEqual({
      action: "refuse",
      paths: ["pages.somethingNew"],
      reason: "unknown",
    });
    const calls: Array<[string, unknown[]]> = [
      ["read", ["content/site.json"]],
      ["filesAt.read", ["0123abc", "content/site.json"]],
      ["draft.store.list", ["content/pages"]],
      ["drafts.list", []],
      ["updates.rebuild", []],
    ];
    for (const [path, args] of calls) {
      expect(await decide({ path, args, target: {} }, SITE), path).toEqual({ action: "allow" });
    }
  });

  it("reads only plain paths, at commits, so a read can't reach another of the host's addresses", async () => {
    const commit = "0123456789abcdef0123456789abcdef01234567";
    const allowed: Array<[string, unknown[]]> = [
      ["readAt", ["goodfellow.config.tsx", commit]],
      ["readFiles", [["content/site.json", "content/menus.json"]]],
      ["changedPaths", [commit, "abcdef0"]],
      ["deployStatus", [commit]],
      ["history", ["content", { page: 2 }]],
      ["updates.code.readAt", ["package.json", commit]],
      ["filesAt.list", [commit, "public/media"]],
      ["scheduledBuilds.sync", [[], { known: [] }]],
    ];
    for (const [path, args] of allowed) {
      expect(await decide({ path, args, target: {} }, SITE), path).toEqual({ action: "allow" });
    }
    const refused: Array<[string, unknown[]]> = [
      ["read", ["../../../user"]],
      ["readBytes", ["content/../../x"]],
      ["list", ["content/."]],
      ["readFiles", [["content/site.json", ".."]]],
      ["readFiles", ["content/site.json"]],
      ["fileSizes", ["/content"]],
      ["history", ["content//pages"]],
      ["readAt", ["package.json", "main"]],
      ["readAt", ["package.json", "../../../pullrequests"]],
      ["readAt", ["..", commit]],
      ["changedPaths", [commit, `${commit}/../..`]],
      ["deployStatus", ["../../pipelines"]],
      ["filesAt.read", ["..", "content/site.json"]],
      ["filesAt.readBytes", [commit, "public\\media"]],
      // An extra argument to filesAt() would move its method's path out of the place that's checked.
      ["filesAt.read", [commit, "content/site.json", "../../user"]],
      ["read", ["content/site.json", "../../user"]],
      ["draft.store.read", ["content/../.."]],
      ["updates.code.read", ["../x"]],
      ["updates.code.history", [".."]],
    ];
    for (const [path, args] of refused) {
      expect(await decide({ path, args, target: {} }, SITE), `${path} ${JSON.stringify(args)}`).toEqual({
        action: "refuse",
        paths: [path],
        reason: "read",
      });
    }
  });
});

describe("what the calls it makes unasked take", () => {
  const commit = "0123456789abcdef0123456789abcdef01234567";
  it("takes domains, repositories and drafts' starting points only as they are", async () => {
    const allowed: Array<[string, unknown[]]> = [
      ["pages.status", ["www.example.org"]],
      ["pages.records", ["example.org", {}]],
      ["comments.find", ["example/site-comments"]],
      ["drafts.create", ["20261024-abc123"]],
      ["drafts.create", ["20261024-abc123", { from: commit }]],
    ];
    for (const [path, args] of allowed) {
      expect(await decide({ path, args, target: {} }, SITE), path).toEqual({ action: "allow" });
    }
    const refused: Array<[string, unknown[]]> = [
      ["pages.status", [".."]],
      ["pages.status", ["Example.org/.."]],
      ["pages.records", ["../../pages", {}]],
      ["comments.find", ["example/.."]],
      ["comments.find", ["../../user"]],
      ["comments.find", ["example/site/extra"]],
      ["drafts.create", ["20261024-abc123", { from: "main" }]],
      ["drafts.create", ["20261024-abc123", { from: "../../x" }]],
    ];
    for (const [path, args] of refused) {
      expect(await decide({ path, args, target: {} }, SITE), `${path} ${JSON.stringify(args)}`).toEqual({
        action: "refuse",
        paths: [path],
        reason: "read",
      });
    }
  });
});

describe("every call the broker offers", () => {
  it("has a decision, so none is refused only because it isn't listed", async () => {
    const unknown: string[] = [];
    for (const path of brokerCalls()) {
      const decision = await decide({ path, args: [[]], target: { changes: async () => [] } }, SITE);
      if (decision.action === "refuse" && decision.reason === "unknown") unknown.push(path);
    }
    expect(unknown).toEqual([]);
  });
});
