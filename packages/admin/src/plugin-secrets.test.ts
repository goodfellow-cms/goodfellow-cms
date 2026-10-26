import type { PluginDescription } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { pluginSecretsHelp } from "./plugin-secrets.js";
import { defaultStrings, type StringKey } from "./strings.js";

const t = (key: StringKey, values: Record<string, string> = {}) =>
  defaultStrings[key].replace(/\{(\w+)\}/g, (_, name: string) => values[name] ?? "");

const plugin: PluginDescription = {
  name: "goodfellow-plugin-s3",
  title: "S3 storage",
  id: "goodfellow-plugin-s3",
  permissions: { secrets: ["S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] },
  server: true,
};

describe("how a plugin's secrets are added", () => {
  it("names GitHub's form for a new secret, and each secret's name", () => {
    const [help] = pluginSecretsHelp(
      { kind: "github", url: "https://github.com/parish/site/settings/secrets/actions/new" },
      plugin,
      t,
    );
    expect(help?.where).toBe("github");
    expect(help?.link?.url).toBe("https://github.com/parish/site/settings/secrets/actions/new");
    expect(help?.steps.map((step) => step.code)).toEqual([undefined, "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]);
    expect(help?.steps[1]?.text).toContain("type S3_ACCESS_KEY_ID in Name");
  });

  it("names Bitbucket's Pipelines variables, which are secured", () => {
    const url = "https://bitbucket.org/parish/site/admin/pipelines/repository-variables";
    const [help] = pluginSecretsHelp({ kind: "bitbucket", url }, plugin, t);
    expect(help?.where).toBe("bitbucket");
    expect(help?.link?.url).toBe(url);
    expect(help?.steps[2]?.text).toContain("type S3_SECRET_ACCESS_KEY in Name");
    expect(help?.steps[2]?.text).toContain("tick Secured");
  });

  it("gives the lines of .env.local in the development servers", () => {
    const [help] = pluginSecretsHelp({ kind: "next-dev" }, plugin, t);
    expect(help?.where).toBe("development");
    expect(help?.steps[0]?.code).toBe("S3_ACCESS_KEY_ID=\nS3_SECRET_ACCESS_KEY=");
  });

  it("offers a full-stack site's server first, with its CI, and only the CI to plugins without a server module", () => {
    const place = {
      kind: "server",
      ci: { kind: "gitlab", url: "https://gitlab.com/parish/site/-/settings/ci_cd#js-cicd-variables-settings" },
    } as const;
    expect(pluginSecretsHelp(place, plugin, t).map((help) => help.where)).toEqual(["server", "gitlab"]);
    expect(pluginSecretsHelp(place, { ...plugin, server: false }, t).map((help) => help.where)).toEqual(["gitlab"]);
  });

  it("says nothing where tasks can't run or the plugin has no secrets", () => {
    expect(pluginSecretsHelp(undefined, plugin, t)).toEqual([]);
    expect(pluginSecretsHelp({ kind: "goodfellow-dev" }, { ...plugin, permissions: {} }, t)).toEqual([]);
  });
});
