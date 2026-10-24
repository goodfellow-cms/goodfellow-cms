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

  it("refuses workflows, even beside content", async () => {
    const changes = [
      { path: "content/pages/about.json", content: "{}" },
      { path: ".github/workflows/deploy.yml", content: "" },
    ];
    expect(await decide({ path: "write", args: [changes], target: {} }, SITE)).toEqual({
      action: "refuse",
      paths: [".github/workflows/deploy.yml"],
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
});
