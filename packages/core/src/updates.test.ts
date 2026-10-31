import { describe, expect, it } from "vitest";
import { ContentError } from "./content/errors.js";
import {
  availableUpdates,
  chooseUpdate,
  DEFAULT_UPDATE_SETTINGS,
  findUpdateResult,
  formatUpdateResult,
  parseUpdateSettings,
  releaseVersions,
  SITE_OVERRIDES,
  siteVersion,
  updateSettingsFile,
  withSiteOverrides,
} from "./updates.js";

const versions = ["0.3.0", "0.4.0", "0.4.1", "0.4.2-beta.1", "0.4.3", "0.5.0", "0.5.1", "1.0.0-rc.1"];

describe("choosing an update", () => {
  it("finds the newest fixes for the site's release, and the newest release", () => {
    expect(availableUpdates("0.4.1", versions)).toEqual({ fixes: "0.4.3", newer: "0.5.1" });
    expect(availableUpdates("0.5.1", versions)).toEqual({});
    expect(availableUpdates("^0.4.3", versions)).toEqual({ newer: "0.5.1" });
  });

  it("chooses fixes, the newest, or a release itself, which may be older, but never a pre-release", () => {
    expect(chooseUpdate("0.4.1", versions, "fixes")).toBe("0.4.3");
    expect(chooseUpdate("0.4.3", versions, "fixes")).toBeUndefined();
    expect(chooseUpdate("0.4.1", versions, "latest")).toBe("0.5.1");
    expect(chooseUpdate("0.4.1", versions, "0.5.0")).toBe("0.5.0");
    expect(chooseUpdate("0.4.1", versions, "0.3.0")).toBe("0.3.0");
    expect(chooseUpdate("0.4.1", versions, "0.4.1")).toBeUndefined();
    expect(chooseUpdate("0.4.1", versions, "1.0.0-rc.1")).toBeUndefined();
    expect(chooseUpdate("0.4.1", versions, "9.9.9")).toBeUndefined();
  });

  it("leaves out skipped releases, unless one is asked for", () => {
    expect(availableUpdates("0.4.1", versions, ["0.4.3", "0.5.1"])).toEqual({ newer: "0.5.0" });
    expect(chooseUpdate("0.4.1", versions, "fixes", ["0.4.3"])).toBeUndefined();
    expect(chooseUpdate("0.4.0", versions, "fixes", ["0.4.3"])).toBe("0.4.1");
    expect(chooseUpdate("0.4.1", versions, "latest", ["0.5.1"])).toBe("0.5.0");
    expect(chooseUpdate("0.4.1", versions, "0.4.3", ["0.4.3"])).toBe("0.4.3");
  });

  it("reads releases from npm's metadata, oldest first", () => {
    expect(releaseVersions({ versions: { "0.10.0": {}, "0.9.1": {}, "0.9.0-rc.1": {} } })).toEqual(["0.9.1", "0.10.0"]);
    expect(releaseVersions(null)).toEqual([]);
  });

  it("reads the site's version from its package.json", () => {
    expect(siteVersion(JSON.stringify({ dependencies: { "@goodfellow-cms/react": "0.4.1" } }))).toBe("0.4.1");
    expect(siteVersion(JSON.stringify({ dependencies: { "@goodfellow-cms/react": "workspace:*" } }))).toBeUndefined();
    expect(siteVersion("not json")).toBeUndefined();
  });
});

describe("sites' overrides", () => {
  it("adds the overrides sites need, keeping the site's own", () => {
    expect(withSiteOverrides(undefined)).toEqual({
      overrides: SITE_OVERRIDES,
      added: [
        ["@puckeditor/core", "happy-dom"],
        ["cacache", "glob"],
        ["@tufjs/models", "minimatch"],
      ],
    });
    const own = {
      react: "19.3.0",
      "@puckeditor/core": { "happy-dom": "^22.0.0", tslib: "2.8.0" },
      cacache: { glob: "^15.0.0" },
      "@tufjs/models": { minimatch: "^12.0.0" },
    };
    expect(withSiteOverrides(own)).toEqual({ overrides: own, added: [] });
    // A site that overrides Puck itself chose its own.
    expect(withSiteOverrides({ "@puckeditor/core": "0.24.0" })).toEqual({
      overrides: {
        "@puckeditor/core": "0.24.0",
        cacache: { glob: "^14.0.2" },
        "@tufjs/models": { minimatch: "^11.0.1" },
      },
      added: [
        ["cacache", "glob"],
        ["@tufjs/models", "minimatch"],
      ],
    });
    expect(withSiteOverrides({ react: "19.3.0" }).overrides).toEqual({ react: "19.3.0", ...SITE_OVERRIDES });
  });
});

describe("update settings", () => {
  it("default to installing fixes and skipping nothing", () => {
    expect(parseUpdateSettings(undefined)).toEqual(DEFAULT_UPDATE_SETTINGS);
    expect(parseUpdateSettings('{ "version": 1 }')).toEqual(DEFAULT_UPDATE_SETTINGS);
  });

  it("are written in canonical form, with skipped releases oldest first", () => {
    const text = updateSettingsFile({ automatic: false, skip: ["0.10.0", "0.4.3", "0.4.3"] });
    expect(text).toBe('{\n  "version": 1,\n  "automatic": false,\n  "skip": [\n    "0.4.3",\n    "0.10.0"\n  ]\n}\n');
    expect(parseUpdateSettings(text)).toEqual({ version: 1, automatic: false, skip: ["0.4.3", "0.10.0"] });
  });

  it("say what's wrong with a file that can't be used", () => {
    expect(() => parseUpdateSettings('{ "version": 1, "automatic": "no" }')).toThrow(ContentError);
    expect(() => parseUpdateSettings("not json")).toThrow(/content\/updates\.json/);
  });
});

describe("update results", () => {
  it("are found in a log", () => {
    const result = { state: "updated" as const, from: "0.4.1", to: "0.4.3", kept: [] };
    expect(findUpdateResult(`Installing…\n${formatUpdateResult(result)}\nDone`)).toEqual(result);
    expect(findUpdateResult("goodfellow-update {}")).toBeUndefined();
  });
});
