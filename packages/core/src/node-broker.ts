/**
 * `goodfellow broker`: a site's token broker from a computer. `addBroker()`
 * writes the broker's repository into a folder of its own, from the released
 * page that matches the site's Goodfellow version, as the Security tab's
 * **Add a token broker** makes it on the site's host; `setBrokerAddress()`
 * writes or removes the config's `broker` line, as **Sign in there from now
 * on** and **Stop using the sign-in page** publish it.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { configAdmin } from "./admin-domain.js";
import { brokerAddressProblem, brokerOrigin, withBrokerConfig } from "./broker.js";
import { type BrokerFetch, type BrokerHost, brokerReleaseUrl, fetchBrokerRelease, planBroker } from "./broker-setup.js";
import { SITE_FILE } from "./content/paths.js";
import type { HostSource } from "./git.js";
import { GOODFELLOW_VERSION } from "./site-description.js";

/** Why the broker couldn't be added or its address set, in words for the person at the command line. */
export class BrokerSetupError extends Error {
  override name = "BrokerSetupError";
}

const CONFIG_FILE = "goodfellow.config.tsx";

async function siteSettings(root: string): Promise<{ title?: string; url?: string }> {
  try {
    return JSON.parse(await readFile(join(root, SITE_FILE), "utf8")) as { title?: string; url?: string };
  } catch {
    return {};
  }
}

export interface AddBrokerOptions {
  /** The site's backend, as its config makes it (`GitHost.source`). */
  source: HostSource;
  host: BrokerHost;
  /** The broker's own domain, which GitHub Pages needs. */
  domain?: string;
  /** Where to write it. Defaults to a folder beside the site's, named after it with `-signin`. */
  folder?: string;
  /** Where the released page is. Defaults to the site's Goodfellow version on jsDelivr. */
  release?: string;
  fetch?: BrokerFetch;
}

export interface AddedBroker {
  folder: string;
  files: number;
  /** Whether the folder was made a git repository with everything in a first commit. */
  committed: boolean;
}

/** Writes a site's token broker's repository into a folder of its own, ready to push and put online. */
export async function addBroker(root: string, options: AddBrokerOptions): Promise<AddedBroker> {
  const site = resolve(root);
  if (options.host === "github-pages" && !options.domain) {
    throw new BrokerSetupError(
      "GitHub Pages' own addresses are shared by every site in the same account, so a sign-in page there needs --domain, such as signin.example.org.",
    );
  }
  if (options.domain && /(^|\.)(github|gitlab)\.io$/.test(options.domain)) {
    throw new BrokerSetupError(
      `${options.domain} is shared with other sites. Give the sign-in page a domain of yours.`,
    );
  }
  const folder = resolve(options.folder ?? join(dirname(site), `${basename(site)}-signin`));
  if (existsSync(folder) && readdirSync(folder).length > 0) {
    throw new BrokerSetupError(`${folder} already has files in it. Choose an empty folder.`);
  }
  const fetcher = options.fetch ?? ((url: string) => fetch(url));
  const release = await fetchBrokerRelease(options.release ?? brokerReleaseUrl(GOODFELLOW_VERSION), fetcher);
  const { title } = await siteSettings(site);
  const files = planBroker({
    release,
    site: options.source,
    host: options.host,
    ...(options.domain && { domain: options.domain }),
    ...(title && { name: title }),
  });
  for (const file of files) {
    if ("delete" in file) continue;
    const path = join(folder, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, "content" in file ? file.content : file.bytes);
  }
  return { folder, files: files.length, committed: commitBroker(folder) };
}

/** Makes the broker's folder a git repository on `main`, with everything in its first commit. */
function commitBroker(folder: string): boolean {
  const git = (...args: string[]) => spawnSync("git", args, { cwd: folder, encoding: "utf8" });
  if (git("rev-parse", "--is-inside-work-tree").status === 0) return false;
  if (git("init", "-q", "-b", "main").status !== 0) return false;
  return git("add", "-A").status === 0 && git("commit", "-q", "-m", "Add the sign-in page").status === 0;
}

/**
 * Writes the config's `broker` line, or removes it with `undefined`, checking
 * the address as the Security tab does. Returns the address written.
 */
export async function setBrokerAddress(root: string, url: string | undefined): Promise<string | undefined> {
  const file = join(resolve(root), CONFIG_FILE);
  const config = await readFile(file, "utf8").catch(() => {
    throw new BrokerSetupError(`There's no ${CONFIG_FILE} in ${resolve(root)}.`);
  });
  let address: string | undefined;
  if (url !== undefined) {
    const trimmed = url.trim().replace(/\/+$/, "");
    const problem = brokerAddressProblem(
      { url: trimmed },
      { siteUrl: (await siteSettings(root)).url, admin: configAdmin(config) },
    );
    if (problem === "invalid") {
      throw new BrokerSetupError("The sign-in page's address needs to be https://, with nothing after the domain.");
    }
    if (problem === "shared") {
      throw new BrokerSetupError("That address is shared with other sites. The sign-in page needs one of its own.");
    }
    if (problem === "same-as-site") {
      throw new BrokerSetupError("That's the site's own address. The sign-in page needs one of its own.");
    }
    address = brokerOrigin({ url: trimmed }) ?? trimmed;
  }
  const next = withBrokerConfig(config, address ? { url: address } : undefined);
  if (next === undefined) throw new BrokerSetupError(`${CONFIG_FILE} has no defineConfig({ to put the address in.`);
  await writeFile(file, next);
  return address;
}
