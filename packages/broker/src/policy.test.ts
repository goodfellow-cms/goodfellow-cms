import { brokerCalls, type GitBackend } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { decide } from "./policy.js";

const SITE = "https://example.org/";

describe("what the broker asks before making a call", () => {
  it("publishes content as it is", async () => {
    const call = { path: "write", args: [[{ path: "content/pages/about.json", content: "{}" }]], target: {} };
    expect(await decide(call, SITE)).toEqual({ action: "allow" });
  });

  it("asks about code, custom code and the Site address, together", async () => {
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

  it("checks a draft's changes when it's published", async () => {
    const draft = { changes: async () => [{ path: "package.json", content: "{}" }] };
    expect(await decide({ path: "draft.publish", args: ["Publish all"], target: draft }, SITE)).toEqual({
      action: "ask",
      questions: [{ kind: "code", paths: ["package.json"] }],
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

  it("asks before changing domains, taking access away, running tasks, setting up updates or throwing away a draft", async () => {
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
    expect(await ask("editors.remove", [{ id: "1", login: "ann", role: "editor" }])).toEqual([
      { kind: "editors-remove", who: "ann" },
    ]);
    expect(await ask("tasks.run", [{ id: "r", plugin: "s3", task: "sign", input: "{}", key: "{}" }])).toEqual([
      { kind: "task", plugin: "s3", task: "sign" },
    ]);
    expect(await ask("updates.enable", [])).toEqual([{ kind: "updates-setup" }]);
    expect(await ask("draft.discard", [], { name: "spring" })).toEqual([{ kind: "discard-draft", name: "spring" }]);
  });

  it("refuses calls it doesn't know, so one added later isn't made unchecked", async () => {
    expect(await decide({ path: "pages.somethingNew", args: [], target: {} }, SITE)).toEqual({
      action: "refuse",
      paths: ["pages.somethingNew"],
      reason: "unknown",
    });
    for (const path of ["read", "filesAt.read", "draft.store.list", "drafts.list", "updates.rebuild"]) {
      expect(await decide({ path, args: [], target: {} }, SITE), path).toEqual({ action: "allow" });
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
