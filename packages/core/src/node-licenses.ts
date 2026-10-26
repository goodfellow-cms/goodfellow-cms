/**
 * License notices for what a plugin's admin frame bundles. A site that serves
 * the frame at `/admin/plugins/<id>/` distributes that code, so every build
 * writes, beside the frame, each bundled package's name and version, its
 * license, where its source is, and its license text (`LICENSES_FILE`).
 */
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/** The file beside a plugin's frame that holds its notices. */
export const LICENSES_FILE = "LICENSES.txt";

/** One package a frame bundles, as its `package.json` and license files describe it. */
export interface BundledPackage {
  name: string;
  /** Its version, unless it has none, as a site's own package may not. */
  version?: string;
  /** Its SPDX expression, such as `GPL-2.0-or-later`, if it names one. */
  license?: string;
  /** Where its source is: its repository, else its page on npm. */
  source: string;
  /** Its license files' text, such as `LICENSE` and `NOTICE`, in order. */
  text: string;
}

/** Files whose names say they're a license or a notice, whatever their case or extension. */
const LICENSE_NAMES = /^(licen[cs]e|copying|notice)([.-].*)?$/i;

/** A `package.json`'s `repository` as an address people can open, at the package's own folder where it names one. */
function repositoryAddress(repository: unknown): string | undefined {
  const address = repositoryUrl(repository);
  const directory = (repository as { directory?: unknown } | undefined)?.directory;
  if (!address || typeof directory !== "string" || directory === "") return address;
  const host = new URL(address).hostname;
  if (host === "github.com") return `${address}/tree/HEAD/${directory}`;
  if (host === "gitlab.com") return `${address}/-/tree/HEAD/${directory}`;
  return address;
}

function repositoryUrl(repository: unknown): string | undefined {
  const raw = typeof repository === "string" ? repository : (repository as { url?: unknown } | undefined)?.url;
  if (typeof raw !== "string" || raw === "") return undefined;
  const shorthand = /^(?:(github|gitlab|bitbucket):)?([\w.-]+\/[\w.-]+)$/.exec(raw);
  if (shorthand) {
    const host = { github: "github.com", gitlab: "gitlab.com", bitbucket: "bitbucket.org" }[shorthand[1] ?? "github"];
    return `https://${host}/${shorthand[2]}`;
  }
  return raw
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git$/, "");
}

/** The `package.json` a file belongs to: the nearest one up from it with a name, such as a site's own. */
async function owningPackage(file: string, cache: Map<string, string | null>): Promise<string | null> {
  const seen: string[] = [];
  let dir = dirname(file);
  for (;;) {
    const known = cache.get(dir);
    if (known !== undefined) {
      for (const each of seen) cache.set(each, known);
      return known;
    }
    seen.push(dir);
    const path = join(dir, "package.json");
    if (existsSync(path)) {
      try {
        const json = JSON.parse(await readFile(path, "utf8")) as { name?: unknown };
        // Nested ones such as `dist/esm/package.json` only say `"type": "module"`.
        if (typeof json.name === "string") {
          for (const each of seen) cache.set(each, dir);
          return dir;
        }
      } catch {
        // Not a package's own; keep looking above it.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      for (const each of seen) cache.set(each, null);
      return null;
    }
    dir = parent;
  }
}

/** A package's details from its folder. */
async function describePackage(dir: string): Promise<BundledPackage> {
  const json = JSON.parse(await readFile(join(dir, "package.json"), "utf8")) as {
    name: string;
    version?: unknown;
    license?: unknown;
    licenses?: unknown;
    repository?: unknown;
  };
  const files = (await readdir(dir)).filter((name) => LICENSE_NAMES.test(name)).sort();
  const texts = await Promise.all(files.map((name) => readFile(join(dir, name), "utf8").catch(() => "")));
  const license =
    typeof json.license === "string"
      ? json.license
      : Array.isArray(json.licenses)
        ? json.licenses
            .map((entry) => (typeof entry === "string" ? entry : (entry as { type?: unknown })?.type))
            .filter((type): type is string => typeof type === "string")
            .join(" OR ") || undefined
        : undefined;
  const version = typeof json.version === "string" ? json.version : undefined;
  const npm = `https://www.npmjs.com/package/${json.name}${version ? `/v/${version}` : ""}`;
  return {
    name: json.name,
    ...(version && { version }),
    ...(license && { license }),
    source: repositoryAddress(json.repository) ?? npm,
    text: texts
      .map((text) => text.trim())
      .filter(Boolean)
      .join("\n\n"),
  };
}

/** A package's name and version, as the notices name it. */
function label(pkg: BundledPackage): string {
  return pkg.version ? `${pkg.name} ${pkg.version}` : pkg.name;
}

/**
 * The packages the bundled files belong to, from the bundler's module ids:
 * each once, by name and version. Virtual modules, which belong to no
 * package, are left out.
 */
export async function bundledPackages(moduleIds: Iterable<string>): Promise<BundledPackage[]> {
  const cache = new Map<string, string | null>();
  const dirs = new Set<string>();
  for (const id of moduleIds) {
    if (id.startsWith("\0") || (!id.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(id))) continue;
    const dir = await owningPackage(id.replace(/[?#].*$/, ""), cache);
    if (dir) dirs.add(dir);
  }
  const packages = await Promise.all([...dirs].map(describePackage));
  const unique = new Map(packages.map((pkg) => [label(pkg), pkg]));
  return [...unique.values()].sort((a, b) => label(a).localeCompare(label(b)));
}

/**
 * The notices for a frame, as `LICENSES_FILE` holds them: every package with
 * its license and source, then each license text once, after the packages it
 * covers.
 */
export function licenseNotices(title: string, packages: readonly BundledPackage[]): string {
  const lines = [
    `${title}'s admin frame bundles the packages below, each under its own license.`,
    "Each one's source is at the address given.",
    "",
  ];
  for (const pkg of packages) {
    lines.push(`- ${label(pkg)}: ${pkg.license ?? "no license named"}, source at ${pkg.source}`);
  }
  const byText = new Map<string, string[]>();
  for (const pkg of packages) {
    if (pkg.text) byText.set(pkg.text, [...(byText.get(pkg.text) ?? []), label(pkg)]);
  }
  for (const [text, names] of byText) {
    lines.push("", "-".repeat(72), "", `The license text of ${names.join(", ")}:`, "", text);
  }
  return `${lines.join("\n")}\n`;
}

/** What a bundler's `generateBundle` gives, as far as the notices need. */
interface BundleChunk {
  type: string;
  moduleIds?: readonly string[];
}

/**
 * A Vite, Rollup or Rolldown plugin that writes a frame's notices
 * (`licenseNotices()`) as `fileName` among what it builds, from the modules
 * its chunks hold, on every build.
 */
export function licensesPlugin(title: string, fileName: string) {
  return {
    name: "goodfellow:licenses",
    async generateBundle(
      this: { emitFile(file: { type: "asset"; fileName: string; source: string }): unknown },
      _options: unknown,
      bundle: Record<string, BundleChunk>,
    ) {
      const ids = Object.values(bundle).flatMap((chunk) => (chunk.type === "chunk" ? (chunk.moduleIds ?? []) : []));
      this.emitFile({ type: "asset", fileName, source: licenseNotices(title, await bundledPackages(ids)) });
    },
  };
}
