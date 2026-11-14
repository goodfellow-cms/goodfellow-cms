import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  d1DatabaseId,
  kvNamespaceId,
  type Runner,
  type RunResult,
  setUpCloudflare,
  withCloudflareIds,
} from "./cloudflare-setup.js";

const DATABASE = "5b1f3a2e-9c4d-4e8f-a1b2-c3d4e5f60718";
const KV = "0123456789abcdef0123456789abcdef";

const WRANGLER = `{
  "kv_namespaces": [{ "binding": "VINEXT_KV_CACHE", "id": "your-kv-namespace-id" }],
  "d1_databases": [{ "binding": "DB", "database_name": "acme", "database_id": "your-database-id" }]
}
`;

/** What wrangler prints, as of its version 4, for each command; anything else succeeds silently. */
function fakeWrangler(answers: Record<string, RunResult> = {}) {
  const ran: { line: string; inherit: boolean; input?: string }[] = [];
  const run: Runner = (command, args, options = {}) => {
    const line = [command, ...args].join(" ");
    ran.push({ line, inherit: options.inherit ?? false, ...(options.input !== undefined && { input: options.input }) });
    for (const [start, answer] of Object.entries(answers)) if (line.startsWith(start)) return answer;
    if (line === "npx wrangler d1 create acme") {
      return {
        status: 0,
        stdout: `✅ Successfully created DB 'acme'\n{\n  "d1_databases": [\n    { "binding": "DB", "database_name": "acme", "database_id": "${DATABASE}" }\n  ]\n}\n`,
      };
    }
    if (line === "npx wrangler kv namespace create acme-cache") {
      return {
        status: 0,
        stdout: `🌀 Creating namespace with title "acme-cache"\n✨ Success!\n{\n  "kv_namespaces": [\n    { "binding": "acme_cache", "id": "${KV}" }\n  ]\n}\n`,
      };
    }
    return { status: 0, stdout: "" };
  };
  return { run, ran };
}

/** Answers questions in turn, with yes for any it runs out of. */
function answering(...answers: string[]) {
  const asked: string[] = [];
  return {
    asked,
    ask: async (question: string) => {
      asked.push(question);
      return answers.shift() ?? "";
    },
  };
}

let target: string;
beforeEach(async () => {
  target = await mkdtemp(join(tmpdir(), "cloudflare-setup-"));
  await writeFile(join(target, "wrangler.jsonc"), WRANGLER);
});
afterEach(() => rm(target, { recursive: true, force: true }));

describe("setUpCloudflare", () => {
  it("makes the database and the cache, puts the site online, sets its secrets, and makes its first admin", async () => {
    const { run, ran } = fakeWrangler();
    const { ask } = answering("", "", "", "olive@example.org", "Olive Owner");
    const said: string[] = [];
    const left = await setUpCloudflare({
      target,
      worker: "acme",
      run,
      ask,
      say: (line) => said.push(line),
      sessionKey: () => "made-here",
    });
    expect(left).toEqual([]);
    const wrangler = await readFile(join(target, "wrangler.jsonc"), "utf8");
    expect(wrangler).toContain(`"database_id": "${DATABASE}"`);
    expect(wrangler).toContain(`"id": "${KV}"`);
    expect(ran.map((step) => step.line)).toEqual([
      "npx wrangler whoami",
      "npx wrangler d1 create acme",
      "npx wrangler kv namespace create acme-cache",
      "npm run build",
      "npm run deploy",
      "npx wrangler secret put BETTER_AUTH_SECRET",
      "npx wrangler secret put GOODFELLOW_GIT_TOKEN",
      "npm run new-admin -- olive@example.org Olive Owner --remote",
    ]);
    // The session key goes to wrangler only, never on screen; the token and the password are typed into wrangler's
    // and the script's own prompts, in the terminal.
    const key = ran.find((step) => step.line.endsWith("BETTER_AUTH_SECRET"));
    expect(key).toMatchObject({ input: "made-here\n", inherit: false });
    expect(said.join("\n")).not.toContain("made-here");
    expect(ran.find((step) => step.line.endsWith("GOODFELLOW_GIT_TOKEN"))?.inherit).toBe(true);
    expect(ran.find((step) => step.line.startsWith("npm run new-admin"))?.inherit).toBe(true);
  });

  it("signs in first where wrangler isn't, and leaves everything to the README where that doesn't finish", async () => {
    const { run, ran } = fakeWrangler({
      "npx wrangler whoami": { status: 0, stdout: "You are not authenticated. Please run `wrangler login`." },
      "npx wrangler login": { status: 1, stdout: "" },
    });
    const left = await setUpCloudflare({ target, worker: "acme", run, ask: answering().ask, say: () => {} });
    expect(ran.map((step) => step.line)).toEqual(["npx wrangler whoami", "npx wrangler login"]);
    expect(left[0]).toContain("npx wrangler login");
    expect(await readFile(join(target, "wrangler.jsonc"), "utf8")).toBe(WRANGLER);
  });

  it("stops before anything it needs failed, and keeps an id it was given", async () => {
    const { run, ran } = fakeWrangler({ "npx wrangler kv namespace create": { status: 1, stdout: "" } });
    const left = await setUpCloudflare({ target, worker: "acme", run, ask: answering().ask, say: () => {} });
    expect(ran.map((step) => step.line).at(-1)).toBe("npx wrangler kv namespace create acme-cache");
    expect(left.join(" ")).toContain("step 2");
    const wrangler = await readFile(join(target, "wrangler.jsonc"), "utf8");
    expect(wrangler).toContain(DATABASE);
    expect(wrangler).toContain("your-kv-namespace-id");
  });

  it("does only what's agreed to", async () => {
    const { run, ran } = fakeWrangler();
    const left = await setUpCloudflare({ target, worker: "acme", run, ask: answering("n").ask, say: () => {} });
    expect(ran.map((step) => step.line)).toEqual(["npx wrangler whoami"]);
    expect(left.join(" ")).toContain("step 2");
  });
});

describe("what wrangler prints", () => {
  it("gives the ids, in its JSON or its TOML", () => {
    expect(d1DatabaseId(`database_id = "${DATABASE}"`)).toBe(DATABASE);
    expect(d1DatabaseId(`"database_id": "${DATABASE}"`)).toBe(DATABASE);
    expect(d1DatabaseId("Couldn't create it")).toBeUndefined();
    expect(kvNamespaceId(`{ binding = "acme_cache", id = "${KV}" }`)).toBe(KV);
    expect(kvNamespaceId(`"id": "${KV}"`)).toBe(KV);
    expect(withCloudflareIds(WRANGLER, { database: DATABASE })).toContain(`"database_id": "${DATABASE}"`);
    expect(withCloudflareIds(WRANGLER, {})).toBe(WRANGLER);
  });
});
