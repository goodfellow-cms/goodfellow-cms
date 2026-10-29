/**
 * `goodfellow admin`: a site's admin address from a computer, for sites whose
 * config the admin panel can't publish, such as those that keep their content
 * in a repository of their own. `setAdminAddress()` writes or removes the
 * config's `admin` line, as the Domain screen's first publish does, and
 * `checkSiteAdminAddress()` checks the address as the Domain screen does from
 * there, then marks it `checked`. Both keep a content repository's `vercel.ts`
 * in step (`syncContentHeaders()`), since Vercel reads it before the code is
 * cloned.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  type AdminAddress,
  type AdminAddressCheck,
  type AdminCheckResponse,
  adminAddressProblem,
  adminOrigin,
  checkAdminAddress,
  configAdmin,
  vercelHeaders,
  withAdminConfig,
  withVercelAdminAddress,
  withVercelHeaders,
} from "./admin-domain.js";
import { brokerOrigin, configBroker } from "./broker.js";
import { outsideHost } from "./cloudflare-setup.js";
import { CONTENT_REPOSITORY_DIR, SITE_FILE } from "./content/paths.js";

/** Why the admin address couldn't be set or checked, in words for the person at the command line. */
export class AdminSetupError extends Error {
  override name = "AdminSetupError";
}

const CONFIG_FILE = "goodfellow.config.tsx";
const VERCEL_CONFIG = "vercel.ts";

async function readText(path: string): Promise<string | undefined> {
  return readFile(path, "utf8").catch(() => undefined);
}

async function readConfig(root: string): Promise<string> {
  const config = await readText(join(root, CONFIG_FILE));
  if (config === undefined) throw new AdminSetupError(`There's no ${CONFIG_FILE} in ${root}.`);
  return config;
}

/** The Site address, from `content/site.json`, or the content repository's where the content isn't linked yet. */
async function siteUrl(root: string): Promise<string | undefined> {
  for (const path of [join(root, SITE_FILE), join(root, CONTENT_REPOSITORY_DIR, SITE_FILE)]) {
    const text = await readText(path);
    if (text === undefined) continue;
    try {
      const { url } = JSON.parse(text) as { url?: unknown };
      return typeof url === "string" && url ? url : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/**
 * Writes the site's header rules, and the admin address its redirects are
 * worked out from, into the content repository's `vercel.ts`, where Vercel
 * builds from it, from the config's `admin` and `broker` lines. Returns whether it changed the file.
 */
export async function syncContentHeaders(root: string): Promise<boolean> {
  const site = resolve(root);
  const path = join(site, CONTENT_REPOSITORY_DIR, VERCEL_CONFIG);
  const vercel = await readText(path);
  if (vercel === undefined) return false;
  const config = await readConfig(site);
  const admin = configAdmin(config);
  const broker = brokerOrigin(configBroker(config));
  const rules = vercelHeaders({ ...(admin && { admin }), ...(broker && { broker }) });
  const withHeaders = withVercelHeaders(vercel, rules);
  if (withHeaders === undefined) return false;
  // And the admin address, which the redirects between it and the Site address are worked out from.
  const next = withVercelAdminAddress(withHeaders, admin) ?? withHeaders;
  if (next === vercel) return false;
  await writeFile(path, next);
  return true;
}

export interface AdminAddressResult {
  admin: AdminAddress | undefined;
  /** Whether the content repository's `vercel.ts` changed too, which is committed there. */
  contentChanged: boolean;
}

/**
 * Writes the config's `admin` line with `url`, not yet checked, or removes
 * it with `undefined`, checking the address as the Domain screen does.
 */
export async function setAdminAddress(root: string, url: string | undefined): Promise<AdminAddressResult> {
  const site = resolve(root);
  const config = await readConfig(site);
  let admin: AdminAddress | undefined;
  if (url !== undefined) {
    const trimmed = url.trim().replace(/\/+$/, "");
    const candidate = { url: /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}` };
    const problem = adminAddressProblem(candidate, await siteUrl(site));
    if (problem === "invalid") {
      throw new AdminSetupError("The admin address needs to be https://, with nothing after the domain.");
    }
    if (problem === "same-as-site") {
      throw new AdminSetupError("That's the site's own address. The admin panel needs one of its own.");
    }
    admin = { url: adminOrigin(candidate) ?? candidate.url };
  }
  const next = withAdminConfig(config, admin);
  if (next === undefined) throw new AdminSetupError(`${CONFIG_FILE} has no defineConfig({ to put the address in.`);
  await writeFile(join(site, CONFIG_FILE), next);
  return { admin, contentChanged: await syncContentHeaders(site) };
}

export interface CheckedAdminAddress extends AdminAddressResult {
  check: AdminAddressCheck;
  /** The page that was read. */
  home: string;
}

/**
 * Checks the config's admin address from this computer, as the Domain screen
 * does from the address: the site's home page there must start with the
 * guard, and be sandboxed where the host sends headers (Cloudflare Pages and
 * Vercel). Once it passes, marks the address `checked`, from which the admin
 * panel starts only there.
 */
export async function checkSiteAdminAddress(
  root: string,
  options: { fetch?: (url: string) => Promise<AdminCheckResponse> } = {},
): Promise<CheckedAdminAddress> {
  const site = resolve(root);
  const config = await readConfig(site);
  const admin = configAdmin(config);
  const origin = adminOrigin(admin);
  if (!admin || !origin) {
    throw new AdminSetupError("The site has no admin address yet: add one with goodfellow admin add <address> first.");
  }
  const url = await siteUrl(site);
  if (!url) throw new AdminSetupError("The site has no Site address yet: the admin address goes beside it.");
  const home = `${origin}${new URL(url).pathname}`;
  // The host's setup files are in the code's folder, or the content repository's where that one builds the site.
  const read = async (path: string) =>
    (await readText(join(site, path))) ?? (await readText(join(site, CONTENT_REPOSITORY_DIR, path)));
  const headers = (await outsideHost(read)) !== undefined;
  const fetcher = options.fetch ?? ((address: string) => fetch(address, { headers: { "cache-control": "no-cache" } }));
  const check = await checkAdminAddress(home, { headers, fetch: fetcher });
  if (check !== "ok" || admin.checked) {
    return { admin, check, home, contentChanged: await syncContentHeaders(site) };
  }
  const checked = { ...admin, checked: true };
  const next = withAdminConfig(config, checked);
  if (next === undefined) throw new AdminSetupError(`${CONFIG_FILE} has no defineConfig({ to put the address in.`);
  await writeFile(join(site, CONFIG_FILE), next);
  return { admin: checked, check, home, contentChanged: await syncContentHeaders(site) };
}

/** What `goodfellow admin` says about a result, for `cli`: `goodfellow` or `goodfellow-next`. */
export function formatAdminResult(
  action: "add" | "check" | "remove",
  result: AdminAddressResult | CheckedAdminAddress,
  cli = "goodfellow",
): { lines: string[]; ok: boolean } {
  const lines: string[] = [];
  const origin = adminOrigin(result.admin) ?? result.admin?.url;
  let ok = true;
  if (action === "add") {
    lines.push(
      `The admin address is ${origin}. Publish ${CONFIG_FILE}, connect the address to the site at its host, and once the site has rebuilt, run "${cli} admin check".`,
    );
  } else if (action === "remove") {
    lines.push(`The admin panel starts at the Site address again once the site has rebuilt with ${CONFIG_FILE}.`);
  } else if ("check" in result) {
    ok = result.check === "ok";
    if (ok) {
      lines.push(
        `${origin} is ready: once the site has rebuilt with ${CONFIG_FILE}, the admin panel starts only there, and editors sign in there.`,
      );
    } else if (result.check === "no-guard") {
      lines.push(
        `${result.home} doesn't start with the admin address's guard yet. Publish ${CONFIG_FILE}, wait for the site to rebuild, then check again.`,
      );
    } else if (result.check === "no-sandbox") {
      lines.push(
        `${result.home} isn't sandboxed. The host should send it with Content-Security-Policy: sandbox, from the _headers the build writes (Cloudflare Pages) or vercel.ts (Vercel). Rebuild the site, then check again.`,
      );
    } else {
      lines.push(
        `Couldn't read ${result.home}. Check that the address reaches the site, with its DNS records and the host's domain settings, then check again.`,
      );
    }
  }
  if (result.contentChanged) {
    lines.push(
      `${CONTENT_REPOSITORY_DIR}/${VERCEL_CONFIG} changed too, since Vercel reads it before the code is cloned: publish it in the content repository.`,
    );
  }
  return { lines, ok };
}
