/**
 * Finding and reading language packs on npm: packages named
 * `goodfellow-language-<name>` (or `@scope/goodfellow-language-<name>`) with
 * the `goodfellow-language` keyword, read from npm's registry and their file
 * from jsDelivr, both of which answer browsers. A language pack has no code,
 * only its `goodfellow-language.json`, whose every string is checked as it's
 * used, as a site's own admin text is.
 */
import { type LanguagePack, languagePackManifestSchema } from "./content/language-packs.js";
import {
  chooseRelease,
  getPackageText,
  PackageError,
  type PackageFetchOptions,
  type PackageListing,
  type PackageRelease,
  packageFetch,
  packageFileUrl,
  packageReleases,
  searchPackages,
} from "./npm-packages.js";

/** The keyword language packs' packages carry. */
export const LANGUAGE_PACK_KEYWORD = "goodfellow-language";
/** The file at the root of a language pack's package that holds its text. */
export const LANGUAGE_PACK_MANIFEST = "goodfellow-language.json";
/** At most this many language packs are listed for a search. */
export const MAX_LANGUAGE_PACKS = 50;

const LANGUAGE_PACK_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?goodfellow-language-[a-z0-9][a-z0-9._~-]*$/;

/** Whether a package's name is a language pack's, such as `goodfellow-language-fr` or `@acme/goodfellow-language-fr`. */
export function isLanguagePackName(name: string): boolean {
  return LANGUAGE_PACK_NAME.test(name) && name.length <= 214;
}

/** Language packs on npm, newest-looking first, optionally matching words. Only packages named as language packs are listed. */
export function searchLanguagePacks(words = "", options: PackageFetchOptions = {}): Promise<PackageListing[]> {
  return searchPackages(LANGUAGE_PACK_KEYWORD, isLanguagePackName, words, { ...options, size: MAX_LANGUAGE_PACKS });
}

/** A language pack's releases on npm, oldest first. Pre-releases are left out. */
export async function languagePackReleases(name: string, options: PackageFetchOptions = {}): Promise<PackageRelease[]> {
  if (!isLanguagePackName(name)) {
    throw new PackageError("not-a-language-pack", `${name} isn't named as a language pack.`);
  }
  return packageReleases(name, options);
}

/** The release of a language pack to offer on a Goodfellow release, from its releases oldest first. */
export const chooseLanguagePackRelease = chooseRelease;

/**
 * Reads a language pack's release: its `goodfellow-language.json`, checked as
 * a site's admin text file is. Throws a `PackageError` when it can't be read
 * or isn't a language pack.
 */
export async function fetchLanguagePack(
  release: PackageRelease & { name: string },
  options: PackageFetchOptions = {},
): Promise<LanguagePack> {
  const { name, version } = release;
  const fetcher = packageFetch(options);
  let raw: unknown;
  try {
    raw = JSON.parse(
      await getPackageText(packageFileUrl(name, version, LANGUAGE_PACK_MANIFEST), LANGUAGE_PACK_MANIFEST, fetcher),
    );
  } catch (error) {
    if (error instanceof PackageError) {
      throw error.code === "bad-file"
        ? new PackageError("not-a-language-pack", `${name} has no ${LANGUAGE_PACK_MANIFEST}.`, LANGUAGE_PACK_MANIFEST)
        : error;
    }
    throw new PackageError("bad-file", `${LANGUAGE_PACK_MANIFEST} isn't valid JSON.`, LANGUAGE_PACK_MANIFEST);
  }
  const parsed = languagePackManifestSchema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new PackageError(
      "bad-file",
      `${LANGUAGE_PACK_MANIFEST}: ${issue?.path.join(".") ?? ""} ${issue?.message ?? ""}`.trim(),
      LANGUAGE_PACK_MANIFEST,
    );
  }
  return {
    name,
    release: version,
    manifest: parsed.data,
    ...(release.goodfellow && { goodfellow: release.goodfellow }),
  };
}
