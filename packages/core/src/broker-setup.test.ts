import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { type BrokerRelease, fetchBrokerRelease, planBroker, plannedBrokerAddress } from "./broker-setup.js";

const bytes = (text: string) => new TextEncoder().encode(text);
const release: BrokerRelease = new Map([
  ["index.html", bytes("<!doctype html>")],
  ["assets/index.js", bytes("console.log(1)")],
  ["_headers", bytes("/*\n")],
  ["vercel.json", bytes("{}")],
  ["broker.example.json", bytes("{}")],
  ["files.json", bytes("{}")],
]);
const site = { package: "@goodfellow-cms/github", export: "github", options: { repo: "parish/site" } };
const text = (files: ReturnType<typeof planBroker>, path: string) => {
  const file = files.find((candidate) => candidate.path === path);
  return file && "content" in file ? file.content : undefined;
};

describe("planBroker", () => {
  it("puts the released page in site/ with broker.json naming the site", () => {
    const files = planBroker({ release, site, host: "cloudflare-pages", name: "St. Joseph's" });
    expect(files.map((file) => file.path)).toEqual([
      "README.md",
      "site/_headers",
      "site/assets/index.js",
      "site/broker.json",
      "site/index.html",
      "site/vercel.json",
    ]);
    expect(JSON.parse(text(files, "site/broker.json") ?? "")).toEqual({ sites: [site] });
    expect(text(files, "README.md")).toContain("no build command and `site` as the output directory");
  });

  it("publishes it with GitHub Pages at its own domain, from a workflow that runs no code", () => {
    const files = planBroker({ release, site, host: "github-pages", domain: "signin.example.org" });
    expect(text(files, "site/CNAME")).toBe("signin.example.org\n");
    const workflow = parse(text(files, ".github/workflows/deploy.yml") ?? "");
    expect(workflow.permissions).toEqual({});
    expect(workflow.jobs.build.permissions).toEqual({ contents: "read" });
    expect(workflow.jobs.build.steps.some((step: { run?: string }) => step.run)).toBe(false);
    expect(workflow.jobs.build.steps.at(-1).with.path).toBe("site");
    expect(text(files, "README.md")).toContain("`https://signin.example.org`");
  });

  it("publishes it with GitLab Pages at the project's unique domain", () => {
    const files = planBroker({ release, site, host: "gitlab-pages" });
    expect(parse(text(files, ".gitlab-ci.yml") ?? "").pages.pages.publish).toBe("site");
    expect(files.some((file) => file.path.startsWith(".github/"))).toBe(false);
  });

  it("knows the address only where the broker has a domain of its own", () => {
    expect(plannedBrokerAddress("signin.example.org")).toEqual({ url: "https://signin.example.org" });
    expect(plannedBrokerAddress(undefined)).toBeUndefined();
  });
});

describe("fetchBrokerRelease", () => {
  const answer = (body: string) => ({
    ok: true,
    status: 200,
    json: async () => JSON.parse(body) as unknown,
    arrayBuffer: async () => new TextEncoder().encode(body).buffer as ArrayBuffer,
  });
  const serve = (listed: unknown) => async (url: string) =>
    answer(url.endsWith("/files.json") ? JSON.stringify(listed) : `file ${url}`);

  it("reads the files a release lists", async () => {
    const files = await fetchBrokerRelease("https://cdn.example/site", serve({ files: ["index.html", "assets/a.js"] }));
    expect(new TextDecoder().decode(files.get("assets/a.js"))).toBe("file https://cdn.example/site/assets/a.js");
  });

  it("refuses a list that reaches outside the release", async () => {
    await expect(fetchBrokerRelease("https://cdn.example/site/", serve({ files: ["../secret"] }))).rejects.toThrow();
    await expect(fetchBrokerRelease("https://cdn.example/site/", serve({ files: "index.html" }))).rejects.toThrow();
  });
});
