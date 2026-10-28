import { describe, expect, it } from "vitest";
import {
  type BrokerPort,
  BrokerRefusedError,
  brokerAddressProblem,
  brokerChangeCheck,
  configBroker,
  remoteBackend,
  serveBackend,
  withBrokerConfig,
} from "./broker.js";
import { ConflictError, type FileChange } from "./content/store.js";
import { EditorsError } from "./editors.js";
import type { GitBackend } from "./git.js";

type Port = BrokerPort & { close(): void };
const { MessageChannel } = globalThis as unknown as { MessageChannel: new () => { port1: Port; port2: Port } };

describe("broker addresses", () => {
  it("takes addresses of their own only", () => {
    const site = { siteUrl: "https://example.org/" };
    expect(brokerAddressProblem({ url: "https://broker.example.org" }, site)).toBeUndefined();
    expect(brokerAddressProblem({ url: "https://broker-abc123.gitlab.io" }, site)).toBeUndefined();
    expect(brokerAddressProblem({ url: "https://parish.github.io" }, site)).toBe("shared");
    expect(brokerAddressProblem({ url: "https://example.org/broker" }, site)).toBe("invalid");
    expect(brokerAddressProblem({ url: "http://broker.example.org" }, site)).toBe("invalid");
    expect(brokerAddressProblem({ url: "https://example.org" }, site)).toBe("same-as-site");
    expect(
      brokerAddressProblem(
        { url: "https://admin.example.org" },
        { ...site, admin: { url: "https://admin.example.org" } },
      ),
    ).toBe("same-as-site");
  });

  it("adds, changes and removes the config's line", () => {
    const config = "export default defineConfig({\n  blocks,\n});\n";
    const added = withBrokerConfig(config, { url: "https://broker.example.org" }) ?? "";
    expect(added).toBe(
      'export default defineConfig({\n  broker: { url: "https://broker.example.org" },\n  blocks,\n});\n',
    );
    expect(configBroker(added)).toEqual({ url: "https://broker.example.org" });
    expect(withBrokerConfig(added, undefined)).toBe(config);
    expect(configBroker(config)).toBeUndefined();
  });
});

describe("what the broker publishes without asking", () => {
  const site = (url: string): FileChange => ({
    path: "content/site.json",
    content: JSON.stringify({ version: 1, url }),
  });

  it("publishes content and media, asks about code, custom code and the Site address, and never changes workflows", () => {
    const check = brokerChangeCheck(
      [
        { path: "content/pages/about.json", content: "{}" },
        { path: "public/media/a.png", bytes: new Uint8Array() },
        site("https://example.org/"),
        { path: "content/code/head.html", content: "<script></script>" },
        { path: "blocks/installed/faq/block.tsx", content: "" },
        { path: "package.json", content: "{}" },
        { path: ".github/workflows/deploy.yml", content: "" },
        { path: ".gitlab-ci.yml", content: "" },
        { path: "bitbucket-pipelines.yml", content: "" },
      ],
      "https://example.org/",
    );
    expect(check.refused).toEqual([".github/workflows/deploy.yml", ".gitlab-ci.yml", "bitbucket-pipelines.yml"]);
    expect(check.confirm).toEqual([
      { path: "content/code/head.html", kind: "custom-code" },
      { path: "blocks/installed/faq/block.tsx", kind: "code" },
      { path: "package.json", kind: "code" },
    ]);
    expect(brokerChangeCheck([site("https://evil.example/")], "https://example.org/").confirm).toEqual([
      { path: "content/site.json", kind: "site-address" },
    ]);
  });
});

/** A backend that keeps files in memory, with drafts and editors, as the broker's own would be. */
function memoryBackend() {
  const files = new Map<string, string>([["content/site.json", '{"version":1}']]);
  let revision = "a".repeat(40);
  const invited: string[] = [];
  let ownerActive = false;
  const backend = {
    user: { login: "maria" },
    async revision() {
      return revision;
    },
    async read(path: string) {
      return files.get(path);
    },
    async readBytes() {
      return new Uint8Array([1, 2, 3]);
    },
    async list(dir: string) {
      return [...files.keys()].filter((path) => path.startsWith(`${dir}/`));
    },
    async write(changes: FileChange[], { expectedRevision }: { expectedRevision: string }) {
      if (expectedRevision !== revision) throw new ConflictError();
      for (const change of changes) if ("content" in change) files.set(change.path, change.content);
      revision = "b".repeat(40);
      return { revision };
    },
    async changedPaths() {
      return [];
    },
    async deployStatus() {
      return { state: "live" as const };
    },
    async history() {
      return [];
    },
    async readAt() {
      return undefined;
    },
    filesAt(at: string) {
      return {
        read: async (path: string) => `${at}:${path}`,
        list: async () => [],
        readBytes: async () => undefined,
      };
    },
    editors: {
      async list() {
        return { editors: [], canManage: true };
      },
      async invite(who: string) {
        if (who === "nobody") throw new EditorsError("not-found", "No such person.");
        invited.push(who);
      },
      async setRole() {},
      async remove() {},
    },
    ownerAccess: {
      tokenLink: { url: "https://github.com/settings/tokens", label: "owner.token.create" as const },
      get active() {
        return ownerActive;
      },
      async applyToken() {
        ownerActive = true;
      },
      forget() {
        ownerActive = false;
      },
    },
    drafts: {
      async create(name: string) {
        return {
          name,
          store: backend,
          async changes() {
            return [{ path: "content/pages/x.json", content: "{}" }];
          },
          async publish() {
            return { revision };
          },
          async submitForReview() {
            return { url: "https://example.org/pr/1" };
          },
          async discard() {},
        };
      },
      async open(name: string) {
        return backend.drafts.create(name);
      },
    },
    signOut() {},
    // Not part of `GitBackend`: the broker never offers it.
    async request() {
      return "secret";
    },
  };
  return { backend: backend as unknown as GitBackend, files, invited };
}

describe("the broker's backend in the admin panel", () => {
  async function connect(options: Parameters<typeof serveBackend>[2] = {}) {
    const memory = memoryBackend();
    const { port1, port2 } = new MessageChannel();
    serveBackend(port1, memory.backend, options);
    const remote = await remoteBackend(port2);
    return {
      ...memory,
      remote,
      close: () => {
        port1.close();
        port2.close();
      },
    };
  }

  it("reads, publishes and keeps the classes of errors", async () => {
    const { remote, files, close } = await connect();
    expect(remote.user).toEqual({ login: "maria" });
    const revision = await remote.revision();
    expect(await remote.read("content/site.json")).toBe('{"version":1}');
    expect(await remote.readBytes("public/media/a.png")).toEqual(new Uint8Array([1, 2, 3]));
    expect(await remote.filesAt("c".repeat(40)).read("content/site.json")).toBe(`${"c".repeat(40)}:content/site.json`);
    await remote.write([{ path: "content/pages/a.json", content: "{}" }], {
      message: "Add",
      expectedRevision: revision,
    });
    expect(files.get("content/pages/a.json")).toBe("{}");
    await expect(remote.write([], { message: "Again", expectedRevision: revision })).rejects.toBeInstanceOf(
      ConflictError,
    );
    await expect(remote.editors?.invite("nobody", "editor")).rejects.toMatchObject({
      name: "EditorsError",
      problem: "not-found",
    });
    expect("request" in remote).toBe(false);
    close();
  });

  it("follows the broker's values, and opens drafts as objects of their own", async () => {
    const { remote, close } = await connect({
      extra: {
        "ownerAccess.requestToken": async () => {
          await (memoryBackend().backend.ownerAccess as { applyToken(token: string): Promise<void> }).applyToken("x");
        },
      },
    });
    expect(remote.ownerAccess?.active).toBe(false);
    expect(typeof remote.ownerAccess?.requestToken).toBe("function");
    expect("applyToken" in (remote.ownerAccess ?? {})).toBe(false);
    remote.ownerAccess?.forget();
    const draft = await remote.drafts?.create("20261024-abc123");
    expect(draft?.name).toBe("20261024-abc123");
    expect(await draft?.changes()).toEqual([{ path: "content/pages/x.json", content: "{}" }]);
    expect(await draft?.store.read("content/site.json")).toBe('{"version":1}');
    close();
  });

  it("lets the broker refuse calls, by their path in the backend", async () => {
    const asked: string[] = [];
    const { remote, invited, close } = await connect({
      check({ path }) {
        asked.push(path);
        if (path === "editors.invite") throw new BrokerRefusedError("declined", "The editor said no.");
      },
    });
    await expect(remote.editors?.invite("eve", "owner")).rejects.toBeInstanceOf(BrokerRefusedError);
    expect(invited).toEqual([]);
    const draft = await remote.drafts?.open("20261024-abc123");
    await draft?.publish("Publish all");
    expect(asked).toEqual(["editors.invite", "drafts.open", "draft.publish"]);
    close();
  });
});
