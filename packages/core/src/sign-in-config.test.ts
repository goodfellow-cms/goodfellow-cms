import { describe, expect, it } from "vitest";
import {
  configBackendHost,
  configBackendOption,
  signInRedirectAddresses,
  withBackendOption,
} from "./sign-in-config.js";

const ONE_LINE = `export default defineConfig({
  blocks,
  backend: github({ repo: "parish/site" }),
});
`;

const MULTI_LINE = `export default defineConfig({
  backend: gitlab({
    project: "parish/site",
    branch: process.env.BRANCH ?? "main",
  }),
});
`;

describe("withBackendOption", () => {
  it("adds, changes and takes out an option on one line", () => {
    const added = withBackendOption(ONE_LINE, "signIn", "https://sign-in.example");
    expect(added).toContain(`backend: github({ repo: "parish/site", signIn: "https://sign-in.example" }),`);
    expect(configBackendOption(added ?? "", "signIn")).toBe("https://sign-in.example");
    const changed = withBackendOption(added ?? "", "signIn", "https://other.example");
    expect(changed).toContain(`signIn: "https://other.example" })`);
    expect(withBackendOption(changed ?? "", "signIn", undefined)).toBe(ONE_LINE);
  });

  it("keeps one option a line, and the code around it", () => {
    const added = withBackendOption(MULTI_LINE, "clientId", "abc123") ?? "";
    expect(added).toBe(`export default defineConfig({
  backend: gitlab({
    project: "parish/site",
    branch: process.env.BRANCH ?? "main",
    clientId: "abc123",
  }),
});
`);
    expect(configBackendHost(added)).toBe("gitlab");
    expect(withBackendOption(added, "clientId", undefined)).toBe(`export default defineConfig({
  backend: gitlab({
    project: "parish/site",
    branch: process.env.BRANCH ?? "main",
  }),
});
`);
  });

  it("takes out the first option without leaving a comma", () => {
    const source = `  backend: bitbucket({ clientId: "key", repo: "parish/site" }),\n`;
    expect(withBackendOption(source, "clientId", undefined)).toBe(`  backend: bitbucket({ repo: "parish/site" }),\n`);
  });

  it("leaves configs it can't change safely to a developer", () => {
    expect(withBackendOption(`export default defineConfig({});`, "signIn", "https://x.example")).toBeUndefined();
    expect(
      withBackendOption(`  backend: github({ repo: "a/b", code: { repo: "a/c" } }),`, "signIn", "https://x.example"),
    ).toBeUndefined();
    // A commented-out line isn't the backend.
    expect(configBackendHost(`  // backend: github({ repo: "a/b" }),`)).toBeUndefined();
  });
});

describe("signInRedirectAddresses", () => {
  it("lists the admin panel at each address, with the site's base path", () => {
    expect(
      signInRedirectAddresses("https://parish.gitlab.io/site/", {
        admin: "https://admin.parish.example",
        broker: "https://signin.parish.example",
      }),
    ).toEqual([
      "https://parish.gitlab.io/site/admin/",
      "https://admin.parish.example/site/admin/",
      "https://signin.parish.example/",
    ]);
    expect(signInRedirectAddresses("https://parish.example")).toEqual(["https://parish.example/admin/"]);
    expect(signInRedirectAddresses(undefined)).toEqual([]);
  });
});
