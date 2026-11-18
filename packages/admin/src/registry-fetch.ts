import { checkedFetchJson, type FetchJson, goodfellowRegistryUrl, type RegistryDigests } from "@goodfellow-cms/core";
import { REGISTRY_VERSION } from "./registry-version.js";

/** Set by the admin panel's build from the registry built with it (`@goodfellow-cms/registry`'s `r/digests.json`). */
declare const __GOODFELLOW_REGISTRY_DIGESTS__: RegistryDigests | undefined;

/**
 * The SHA-256 of each item of Goodfellow's registry released with this admin panel, or `undefined` where a build
 * bundled the admin panel's source without them.
 */
export const REGISTRY_DIGESTS: RegistryDigests | undefined =
  typeof __GOODFELLOW_REGISTRY_DIGESTS__ === "object" ? __GOODFELLOW_REGISTRY_DIGESTS__ : undefined;

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} answered ${response.status}.`);
  return response.text();
}

const fetchAny: FetchJson = async (url) => JSON.parse(await fetchText(url));

/**
 * Fetches block registries' files, taking those of the release of Goodfellow's registry this admin panel was built
 * with only where they're what that release built (`checkedFetchJson()`), since a block's files become the site's
 * code. Other registries, such as one the site's config names, are fetched as they are.
 */
export const registryFetchJson: FetchJson = REGISTRY_DIGESTS
  ? checkedFetchJson(goodfellowRegistryUrl(REGISTRY_VERSION), REGISTRY_DIGESTS, fetchText, fetchAny)
  : fetchAny;
