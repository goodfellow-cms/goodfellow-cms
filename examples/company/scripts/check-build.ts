// Checks what the Deploy workflow's build job handed over before wrangler reads any of it in the deploy job, which
// holds the Cloudflare token and the site's keys. The build runs the site's code and every package it loads, so the
// config it writes is taken only where it's the config wrangler.jsonc says, with the build's own files in dist/: a
// config of its own could name a command for wrangler to run before uploading (build), an image to build
// (containers), or files outside dist/ to upload with the Worker, such as the deploy's own environment.
//
// Run from the site's folder, after the build's files are in place: `node scripts/check-build.ts`.
import { existsSync, lstatSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

/** JSON with comments and trailing commas, as wrangler.jsonc is written, read as JSON. */
function parseJsonc(text: string): unknown {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === '"') {
      const start = i;
      i++;
      while (i < text.length && text[i] !== '"') i += text[i] === "\\" ? 2 : 1;
      out += text.slice(start, ++i);
    } else if (char === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      i = end === -1 ? text.length : end + 2;
    } else if (char === ",") {
      // A comma before a closing bracket, past spaces and comments, is a trailing one.
      let j = i + 1;
      for (;;) {
        while (j < text.length && /\s/.test(text[j] ?? "")) j++;
        if (text.startsWith("//", j)) while (j < text.length && text[j] !== "\n") j++;
        else if (text.startsWith("/*", j)) {
          const end = text.indexOf("*/", j + 2);
          j = end === -1 ? text.length : end + 2;
        } else break;
      }
      if (text[j] !== "}" && text[j] !== "]") out += char;
      i++;
    } else {
      out += char;
      i++;
    }
  }
  return JSON.parse(out);
}

/** Whether `path` is somewhere under `folder`, and not the folder itself. */
const within = (path: string, folder: string) => {
  const rest = relative(folder, path);
  return rest !== "" && !rest.startsWith("..") && !isAbsolute(rest);
};

/** A value that names nothing: an empty list or object, or an object holding only those. */
const empty = (value: unknown): boolean =>
  Array.isArray(value)
    ? value.length === 0
    : typeof value === "object" && value !== null && Object.values(value).every(empty);

/** JSON with its objects' keys in order, so two values compare by what they hold. */
const canonical = (value: unknown): string =>
  JSON.stringify(value, (_key, each: unknown) =>
    typeof each === "object" && each !== null && !Array.isArray(each)
      ? Object.fromEntries(Object.entries(each).sort(([a], [b]) => (a < b ? -1 : 1)))
      : each,
  );
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);

type Config = Record<string, unknown>;

/** The keys the build writes that wrangler.jsonc doesn't have, with what each may hold. */
const WRITTEN: Record<string, (value: unknown) => boolean> = {
  no_bundle: (value) => value === true,
  rules: (value) => same(value, [{ type: "ESModule", globs: ["**/*.js", "**/*.mjs"] }]),
  jsx_factory: (value) => value === "React.createElement",
  jsx_fragment: (value) => value === "React.Fragment",
  upload_source_maps: (value) => typeof value === "boolean",
  python_modules: (value) => same(value, { exclude: ["**/*.pyc"] }),
  // Only `wrangler dev` reads these.
  dev: (value) => typeof value === "object" && value !== null && !Array.isArray(value),
};

/** What's wrong with the build's files in `root`, or nothing. */
function buildProblems(root: string): string[] {
  const problems: string[] = [];
  const dist = join(root, "dist");
  const redirect = join(root, ".wrangler/deploy/config.json");
  if (!existsSync(dist) || !existsSync(redirect)) return ["The build's files aren't there."];

  // Links could lead anywhere on this computer, the folders themselves too.
  for (const folder of [dist, join(root, ".wrangler")]) {
    if (lstatSync(folder).isSymbolicLink()) problems.push(`${relative(root, folder)} is a link.`);
  }
  if (problems.length > 0) return problems;
  const walk = (folder: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(folder, entry.name);
      if (lstatSync(path).isSymbolicLink()) problems.push(`${relative(root, path)} is a link.`);
      else if (entry.isDirectory()) walk(path);
    }
  };
  walk(dist);
  walk(join(root, ".wrangler"));
  if (problems.length > 0) return problems;

  const pointer = JSON.parse(readFileSync(redirect, "utf8")) as Config;
  for (const key of Object.keys(pointer)) {
    if (key === "configPath") continue;
    if (key === "auxiliaryWorkers" && empty(pointer[key])) continue;
    problems.push(`.wrangler/deploy/config.json has ${key}.`);
  }
  const configPath = typeof pointer.configPath === "string" ? resolve(dirname(redirect), pointer.configPath) : "";
  if (!within(configPath, dist) || !existsSync(configPath)) {
    return [...problems, "The build's config isn't in dist/."];
  }
  const built = JSON.parse(readFileSync(configPath, "utf8")) as Config;
  const trusted = parseJsonc(readFileSync(join(root, "wrangler.jsonc"), "utf8")) as Config;
  const builtFolder = dirname(configPath);
  /** A path the build's config names, resolved as wrangler resolves it. */
  const path = (value: unknown) => (typeof value === "string" ? resolve(builtFolder, value) : "");

  for (const [key, value] of Object.entries(built)) {
    const ok = (() => {
      switch (key) {
        case "configPath":
        case "userConfigPath":
          return path(value) === join(root, "wrangler.jsonc");
        case "topLevelName":
          return value === trusted.name;
        case "main":
          return within(path(value), dist) && existsSync(path(value)) && statSync(path(value)).isFile();
        case "assets": {
          if (typeof value !== "object" || value === null) return false;
          const { directory, ...rest } = value as Config;
          const { directory: _, ...expected } = (trusted.assets ?? {}) as Config;
          return within(path(directory), dist) && same(rest, expected);
        }
        case "d1_databases": {
          const expected = (trusted.d1_databases ?? []) as Config[];
          if (!Array.isArray(value) || value.length !== expected.length) return false;
          return value.every((database: Config, index) => {
            const { migrations_dir: dir, ...rest } = database;
            const { migrations_dir: trustedDir, ...trustedRest } = expected[index] ?? {};
            const where = trustedDir === undefined ? undefined : resolve(root, String(trustedDir));
            return same(rest, trustedRest) && (dir === undefined ? where === undefined : path(dir) === where);
          });
        }
      }
      if (key in trusted) return same(value, trusted[key]);
      return empty(value) || WRITTEN[key]?.(value) === true;
    })();
    if (!ok) problems.push(`The build's config has ${key} as wrangler.jsonc doesn't.`);
  }
  // A setting the build left out would be taken away from the Worker, such as keep_vars, its variables.
  for (const key of Object.keys(trusted)) {
    if (key !== "$schema" && !(key in built)) problems.push(`The build's config leaves out wrangler.jsonc's ${key}.`);
  }
  return problems;
}

const problems = buildProblems(process.cwd());
for (const problem of problems) console.log(`::error::${problem}`);
if (problems.length > 0) {
  console.log("The deploy stops here: wrangler reads only a config that's wrangler.jsonc's, with files in dist/.");
  process.exit(1);
}
console.log("The build's config is wrangler.jsonc's, with its files in dist/.");
