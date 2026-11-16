// The copy of the sign-in worker Cloudflare's Deploy to Cloudflare button deploys (`packages/worker/deploy/`),
// which this package's build carries as `templates/sign-in/`, for copies to update themselves from.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(new URL(`../../worker/deploy/${file}`, import.meta.url), "utf8");
/** npm's attestations for a release, kept as the registry gave them. */
// biome-ignore lint/suspicious/noExplicitAny: the registry's answer, which the test changes to try what's refused
const fixture = (name: string): any =>
  JSON.parse(readFileSync(new URL(`../test/fixtures/${name}`, import.meta.url), "utf8"));

describe("the Deploy to Cloudflare copy", () => {
  const wrangler = JSON.parse(read("wrangler.json")) as Record<string, unknown>;
  const pkg = JSON.parse(read("package.json")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("runs the bundled worker with the same compatibility date as this one", () => {
    expect(wrangler.main).toBe("worker.js");
    const own = readFileSync(new URL("../../worker/wrangler.jsonc", import.meta.url), "utf8");
    expect(own).toContain(`"compatibility_date": "${wrangler.compatibility_date}"`);
  });

  it("keeps the settings its setup page writes, which a var of the same name would clash with", () => {
    expect(wrangler.vars).toBeUndefined();
    expect(wrangler.keep_vars).toBe(true);
  });

  it("deploys with its name, an exact Wrangler, and a lockfile from npm's registry", () => {
    expect(pkg.scripts.deploy).toBe("node deploy.mjs");
    expect(read("deploy.mjs")).toContain("WORKER_NAME:");
    expect(pkg.devDependencies.wrangler).toMatch(/^\d+\.\d+\.\d+$/);
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: Record<string, { version?: string; resolved?: string }>;
    };
    expect(lock.packages["node_modules/wrangler"]?.version).toBe(pkg.devDependencies.wrangler);
    for (const [path, entry] of Object.entries(lock.packages)) {
      if (entry.resolved) expect(entry.resolved, path).toMatch(/^https:\/\/registry\.npmjs\.org\//);
    }
  });

  it("updates itself from npm with a token that can only push, running none of the release's code", () => {
    const workflow = read("update.yml");
    expect(workflow).toContain("permissions: {}");
    expect(workflow).toContain("contents: write");
    expect(workflow).toContain("node update.mjs");
    expect(workflow).not.toMatch(/npm (ci|install|run)/);
    for (const action of workflow.match(/uses: \S+/g) ?? []) expect(action).toMatch(/^uses: actions\/[\w-]+@v\d+$/);
    expect(read("update.mjs")).toContain("--ignore-scripts");
  });
});

describe("the Deploy to Cloudflare copy's update", async () => {
  const update = (await import(new URL("../../worker/deploy/update.mjs", import.meta.url).href)) as {
    chooseRelease(
      time: Record<string, string>,
      current: string | undefined,
      now?: number,
      tags?: { latest?: string; deprecated?: string[] },
    ): string | undefined;
    provenanceProblem(answer: unknown, integrity: string, chain?: string): string | undefined;
    FULCIO_CHAIN: string;
    recordRelease(packageJson: string, release: string): string;
  };
  const now = Date.parse("2026-11-16T12:00:00Z");
  const days = (n: number) => new Date(now - n * 86_400_000).toISOString();

  it("takes the highest release that's been out a day, never an older one than the copy has", () => {
    const time = {
      created: days(400),
      modified: days(0),
      "0.12.4": days(2),
      "0.13.0": days(5),
      "0.13.1": days(0.5),
      "0.14.0-beta.1": days(3),
    };
    // Not the one published last (0.12.4, a fix to an older line), nor one out less than a day.
    expect(update.chooseRelease(time, undefined, now)).toBe("0.13.0");
    expect(update.chooseRelease(time, "0.12.9", now)).toBe("0.13.0");
    // A copy that's further on stays where it is.
    expect(update.chooseRelease(time, "0.13.1", now)).toBe("0.13.1");
    expect(update.chooseRelease({ "1.0.0": days(0.1) }, undefined, now)).toBeUndefined();
    // A copy made from a prerelease never goes back below it, and takes its release once it's out.
    expect(update.chooseRelease(time, "0.14.0-rc.1", now)).toBe("0.14.0-rc.1");
    expect(update.chooseRelease({ ...time, "0.14.0": days(2) }, "0.14.0-rc.1", now)).toBe("0.14.0");
  });

  it("takes nothing past npm's latest tag, nor a deprecated release", () => {
    const time = { "0.13.0": days(5), "0.14.0": days(3), "0.14.1": days(2) };
    // 0.14.0 was broken: latest went back to 0.13.0, and 0.14.0 was deprecated.
    expect(update.chooseRelease(time, undefined, now, { latest: "0.13.0" })).toBe("0.13.0");
    expect(update.chooseRelease(time, "0.13.0", now, { latest: "0.13.0", deprecated: ["0.14.0"] })).toBe("0.13.0");
    // Once the fix is latest it's taken, never the deprecated release before it.
    expect(update.chooseRelease(time, "0.13.0", now, { latest: "0.14.1", deprecated: ["0.14.0"] })).toBe("0.14.1");
    // A prerelease as latest allows only what comes before it, and a tag that isn't a version allows nothing.
    expect(update.chooseRelease(time, undefined, now, { latest: "0.14.0-rc.1" })).toBe("0.13.0");
    expect(update.chooseRelease(time, undefined, now, { latest: "next" })).toBeUndefined();
    const fixless = { "0.13.0": days(5), "0.14.0": days(3) };
    expect(update.chooseRelease(fixless, undefined, now, { deprecated: ["0.14.0"] })).toBe("0.13.0");
  });

  it("takes a release only where its signed provenance names Goodfellow's release workflow and the packed file", () => {
    // npm's attestations for create-goodfellow 0.13.0, as its registry gave them, and that release's packed file.
    const ours = fixture("create-goodfellow-0.13.0-attestations.json");
    const integrity = "sha512-qXapZ02b3Jd3mXG4MdGvhX5y+92LPp+KOEDuJ+pbych8zSz/RiFoJ5h9BRt5r5p9utNIToDV54mAkUOlLe01uw==";
    expect(update.provenanceProblem(ours, integrity)).toBeUndefined();
    expect(update.provenanceProblem(ours, `sha512-${Buffer.alloc(64).toString("base64")}`)).toBe(
      "its provenance is for another file",
    );
    // What it says is read only once its signature verifies: a statement changed after signing is refused.
    const changed = structuredClone(ours);
    const envelope = changed.attestations[0].bundle.dsseEnvelope;
    const statement = JSON.parse(Buffer.from(envelope.payload, "base64").toString("utf8"));
    statement.subject[0].digest.sha512 = "00";
    envelope.payload = Buffer.from(JSON.stringify(statement)).toString("base64");
    expect(update.provenanceProblem(changed, integrity)).toBe("its provenance's signature doesn't verify");
    // Signed by Sigstore, but for another repository's workflow.
    expect(update.provenanceProblem(fixture("sigstore-tuf-5.0.0-attestations.json"), integrity)).toBe(
      "its provenance wasn't signed by Goodfellow's release workflow",
    );
    // A certificate that doesn't lead up to Sigstore's own authority.
    const root = update.FULCIO_CHAIN.slice(update.FULCIO_CHAIN.lastIndexOf("-----BEGIN"));
    expect(update.provenanceProblem(ours, integrity, root)).toBe("its provenance's certificate isn't Sigstore's");
    expect(update.provenanceProblem(ours, integrity, "")).toBe("its provenance's certificate isn't Sigstore's");
    expect(update.provenanceProblem({ attestations: [] }, integrity)).toBe("it has no provenance");
    expect(update.provenanceProblem(undefined, integrity)).toBe("it has no provenance");
  });
});

describe("create-goodfellow's copy of the sign-in service", () => {
  it("records the release it comes from, so a new copy's first update never goes back", async () => {
    const update = (await import(new URL("../../worker/deploy/update.mjs", import.meta.url).href)) as {
      recordRelease(packageJson: string, release: string): string;
    };
    const written = update.recordRelease('{"name":"goodfellow-sign-in","private":true}', "0.13.0");
    expect(JSON.parse(written)).toEqual({ name: "goodfellow-sign-in", private: true, goodfellowRelease: "0.13.0" });
    expect(written.endsWith("}\n")).toBe(true);
    const bundling = readFileSync(new URL("../scripts/bundle-templates.mjs", import.meta.url), "utf8");
    expect(bundling).toMatch(/writeFileSync\(signInPackage, recordRelease\(/);
  });
});
