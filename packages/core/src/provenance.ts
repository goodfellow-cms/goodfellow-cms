/**
 * Where a package's release was built, from the provenance npm keeps for it,
 * and whether an update to a plugin or theme the site already has may be
 * installed before it's `RELEASE_AGE_DAYS` old: only when the new release was
 * built by the same repository and workflow as the release installed. The
 * wait is for releases published with a stolen token, which come from
 * somewhere else; a version number proves nothing, so provenance is all that
 * counts. Nothing here checks a signature: the admin panel reads what a
 * release says to offer the choice, and the site's build checks it
 * (`verifiedSource()` in `@goodfellow-cms/core/node`), since a browser can
 * lie.
 */
import { z } from "zod";
import { compareReleases, NPM_REGISTRY } from "./updates.js";

/** The predicate type of npm's build provenance, SLSA's. */
export const SLSA_PROVENANCE = "https://slsa.dev/provenance/v1";

/** Where a release was built: its source repository and the workflow file that built it. */
export interface ProvenanceSource {
  /** The repository's address, as `normalizedRepository()` spells it. */
  repository: string;
  /** The workflow file, in the repository, such as `.github/workflows/release.yml`. */
  workflow: string;
}

export const provenanceSourceSchema = z.object({ repository: z.string().min(1), workflow: z.string().min(1) });

/**
 * In an install record: the release was installed before it was old enough,
 * as an update from `from`, both built by `repository` and `workflow`, which
 * the site's build checks before it uses the release.
 */
export const earlyInstallSchema = provenanceSourceSchema.extend({ from: z.string().min(1) });
export type EarlyInstallRecord = z.output<typeof earlyInstallSchema>;

/** What a release's provenance statement says, unchecked. */
export interface ProvenanceStatement extends ProvenanceSource {
  /** The repository's address as the statement writes it, as the signing certificate names it. */
  repositoryUrl: string;
  /** The git ref it was built from, such as `refs/heads/main`. */
  ref?: string;
  /** The package and release it's about, as a package URL: `pkg:npm/name@1.2.3`. */
  subjects: { name: string; sha512?: string }[];
}

/** A release's provenance, as npm's attestations endpoint answers it: the Sigstore bundle and what it says. */
export interface ProvenanceAttestation {
  bundle: unknown;
  statement: ProvenanceStatement;
}

/** npm's address for a release's attestations. */
export function attestationsUrl(name: string, version: string): string {
  return `${NPM_REGISTRY}/-/npm/v1/attestations/${name.replace("/", "%2F")}@${version}`;
}

/**
 * A repository's address spelled one way, so two spellings of one compare
 * equal: lowercase (GitHub's and GitLab's names don't tell case apart),
 * without `git+`, `.git` or a trailing slash.
 */
export function normalizedRepository(url: string): string {
  return url
    .trim()
    .replace(/^git\+/, "")
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .toLowerCase();
}

/** Whether two releases were built by the same repository and the same workflow file in it. */
export function sameSource(a: ProvenanceSource, b: ProvenanceSource): boolean {
  return normalizedRepository(a.repository) === normalizedRepository(b.repository) && a.workflow === b.workflow;
}

function base64Text(text: string): string {
  const { atob, TextDecoder: Decoder } = globalThis as unknown as {
    atob(data: string): string;
    TextDecoder: new () => { decode(bytes: Uint8Array): string };
  };
  const binary = atob(text);
  return new Decoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** The SLSA provenance among npm's attestations for a release, with what it says, or `undefined` without one. */
export function provenanceAttestation(answer: unknown): ProvenanceAttestation | undefined {
  const attestations = (answer as { attestations?: unknown } | null)?.attestations;
  if (!Array.isArray(attestations)) return undefined;
  for (const attestation of attestations) {
    const { predicateType, bundle } = (attestation ?? {}) as { predicateType?: unknown; bundle?: unknown };
    if (predicateType !== SLSA_PROVENANCE || !bundle || typeof bundle !== "object") continue;
    const payload = (bundle as { dsseEnvelope?: { payload?: unknown } }).dsseEnvelope?.payload;
    if (typeof payload !== "string") continue;
    let statement: {
      predicateType?: unknown;
      subject?: { name?: unknown; digest?: { sha512?: unknown } }[];
      predicate?: { buildDefinition?: { externalParameters?: { workflow?: Record<string, unknown> } } };
    };
    try {
      statement = JSON.parse(base64Text(payload));
    } catch {
      continue;
    }
    if (statement.predicateType !== SLSA_PROVENANCE) continue;
    const workflow = statement.predicate?.buildDefinition?.externalParameters?.workflow;
    if (typeof workflow?.repository !== "string" || typeof workflow.path !== "string") continue;
    return {
      bundle,
      statement: {
        repository: normalizedRepository(workflow.repository),
        repositoryUrl: workflow.repository,
        workflow: workflow.path,
        ...(typeof workflow.ref === "string" && { ref: workflow.ref }),
        subjects: (Array.isArray(statement.subject) ? statement.subject : []).flatMap((subject) =>
          typeof subject?.name === "string"
            ? [
                {
                  name: subject.name,
                  ...(typeof subject.digest?.sha512 === "string" && { sha512: subject.digest.sha512 }),
                },
              ]
            : [],
        ),
      },
    };
  }
  return undefined;
}

/** The part of `fetch` reading attestations uses. */
export type ProvenanceFetch = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/**
 * Where a release says it was built, read from npm without checking its
 * signature, for the admin panel to offer installing it early; `undefined`
 * where it has no provenance or it can't be read.
 */
export async function readProvenanceSource(
  name: string,
  version: string,
  options: { fetch?: ProvenanceFetch } = {},
): Promise<ProvenanceSource | undefined> {
  const fetcher = options.fetch ?? (globalThis as unknown as { fetch: ProvenanceFetch }).fetch;
  try {
    const response = await fetcher(attestationsUrl(name, version));
    if (!response.ok) return undefined;
    const found = provenanceAttestation(await response.json());
    return found && { repository: found.statement.repository, workflow: found.statement.workflow };
  } catch {
    return undefined;
  }
}

/** Why a release can't be installed before it's old enough. */
export type EarlyRefusal =
  /** The site doesn't have the package yet: first installs always wait. */
  | "not-installed"
  /** It isn't newer than the release installed. */
  | "not-newer"
  /** The release installed has no provenance, so nothing says where updates should come from. */
  | "installed-no-provenance"
  /** The new release has no provenance. */
  | "no-provenance"
  /** The new release was built by another repository. */
  | "other-repository"
  /** The new release was built by another workflow in the same repository. */
  | "other-workflow";

export type EarlyDecision = { early: true; source: ProvenanceSource } | { early: false; reason: EarlyRefusal };

/** An installed release, with where it was built, if it had provenance. */
export interface InstalledRelease {
  release: string;
  provenance?: ProvenanceSource;
}

/**
 * Whether a release of a plugin or theme may be installed before it's
 * `RELEASE_AGE_DAYS` old: only an update of one the site has, whose
 * installed release and the new one were both built by the same repository
 * and workflow. The default is still to wait: this only says the owner may
 * choose not to, and the site's build checks it again.
 */
export function mayInstallEarly(
  installed: InstalledRelease | undefined,
  release: { version: string; provenance?: ProvenanceSource },
): EarlyDecision {
  if (!installed) return { early: false, reason: "not-installed" };
  if (compareReleases(release.version, installed.release) <= 0) return { early: false, reason: "not-newer" };
  if (!installed.provenance) return { early: false, reason: "installed-no-provenance" };
  if (!release.provenance) return { early: false, reason: "no-provenance" };
  if (normalizedRepository(release.provenance.repository) !== normalizedRepository(installed.provenance.repository)) {
    return { early: false, reason: "other-repository" };
  }
  if (release.provenance.workflow !== installed.provenance.workflow) return { early: false, reason: "other-workflow" };
  return { early: true, source: installed.provenance };
}
