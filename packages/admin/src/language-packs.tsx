/**
 * The Admin panel languages screen's Language packs section: finding the
 * admin panel's text in a language on npm (`searchLanguagePacks()`, packages
 * named `goodfellow-language-<name>`), showing what installing a release
 * would say and keep, and installing, updating and removing it with
 * `planLanguagePack()`, which keeps every string an owner wrote or changed.
 * Packs have no code, so publishing one is a publish of the site's file
 * like any other; nothing updates them by itself.
 */

import type { AdminTextSource } from "@goodfellow-cms/ai";
import {
  type AdminTextFile,
  chooseLanguagePackRelease,
  fetchLanguagePack,
  GOODFELLOW_VERSION,
  type LanguagePack,
  languagePackReleases,
  PackageError,
  type PackageFetch,
  type PackageListing,
  planLanguagePack,
  RELEASE_AGE_DAYS,
  type ReleaseChoice,
  searchLanguagePacks,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin } from "./admin-context.js";
import { ADMIN_LANGUAGES } from "./admin-language.js";
import { languageStatus } from "./admin-text-sources.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, TextField } from "./ui.js";

const packFetch: PackageFetch = (url) => window.fetch(url);

type Translate = ReturnType<typeof useStrings>;

function packProblem(t: Translate, error: unknown): string {
  if (!(error instanceof PackageError) || error.code === "unavailable") return t("adminText.pack.error.unreachable");
  if (error.code === "bad-file") return t("adminText.pack.error.badFile");
  return t("adminText.pack.error.notAPack");
}

/** The language a site's file came from a pack for, by the pack's name. */
function installedPacks(
  files: Readonly<Record<string, AdminTextFile>>,
): Map<string, { code: string; release: string }> {
  const found = new Map<string, { code: string; release: string }>();
  for (const [code, file] of Object.entries(files)) {
    if (file.pack) found.set(file.pack.name, { code, release: file.pack.release });
  }
  return found;
}

export function LanguagePacks({
  files,
  sources,
}: {
  files: Readonly<Record<string, AdminTextFile>>;
  sources: readonly AdminTextSource[];
}) {
  const t = useStrings();
  const [words, setWords] = useState("");
  const [searched, setSearched] = useState("");
  const [found, setFound] = useState<PackageListing[]>();
  const [searchError, setSearchError] = useState<unknown>();
  const [chosen, setChosen] = useState<string>();
  const [published, setPublished] = useState<string>();
  const installed = useMemo(() => installedPacks(files), [files]);

  // npm is asked only when someone searches, never just for opening the screen.
  const [searching, setSearching] = useState(false);
  const search = useCallback((text: string) => {
    setFound(undefined);
    setSearchError(undefined);
    setSearched(text);
    setSearching(true);
    searchLanguagePacks(text, { fetch: packFetch })
      .then(setFound, setSearchError)
      .finally(() => setSearching(false));
  }, []);
  const show = (packName: string) => {
    setPublished(undefined);
    setChosen(packName);
  };

  return (
    <section>
      <h2 className="gfa-section-title">{t("adminText.pack.title")}</h2>
      <p className="gfa-hint">{t("adminText.pack.intro")}</p>
      {published && (
        <p className="gfa-notice gfa-notice-success" role="status">
          {published}
        </p>
      )}
      {installed.size > 0 && (
        <ul className="gfa-check-list">
          {[...installed].map(([packName, { code, release }]) => (
            <li key={packName}>
              {t("adminText.pack.installedAs", { name: packName, version: release, code })}{" "}
              <Button aria-label={t("adminText.pack.showLabel", { name: packName })} onClick={() => show(packName)}>
                {t("adminText.pack.show")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="gfa-theme-search"
        onSubmit={(event) => {
          event.preventDefault();
          search(words);
        }}
      >
        <TextField label={t("adminText.pack.search")} value={words} onChange={setWords} />
        <Button type="submit">{t("adminText.pack.searchButton")}</Button>
      </form>
      {searchError !== undefined && (
        <ErrorMessage
          message={packProblem(t, searchError)}
          error={searchError}
          action={<Button onClick={() => search(searched)}>{t("action.tryAgain")}</Button>}
        />
      )}
      {searching && <p className="gfa-hint">{t("adminText.pack.loading")}</p>}
      {found && found.length === 0 && <p className="gfa-hint">{t("adminText.pack.noneFound")}</p>}
      {found && found.length > 0 && (
        <ul className="gfa-block-grid">
          {found.map((listing) => (
            <li key={listing.name} className="gfa-block-card">
              <div className="gfa-block-text">
                <h3 className="gfa-block-title">
                  {listing.name}
                  {installed.has(listing.name) && (
                    <span className="gfa-badge">{t("adminText.pack.installedBadge")}</span>
                  )}
                </h3>
                {listing.description && <p className="gfa-hint">{listing.description}</p>}
                {listing.publisher && (
                  <p className="gfa-hint">
                    {t("adminText.pack.byPublisher", { name: listing.name, publisher: listing.publisher })}
                  </p>
                )}
              </div>
              <Button
                aria-label={t("adminText.pack.showLabel", { name: listing.name })}
                onClick={() => show(listing.name)}
              >
                {t("adminText.pack.show")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {chosen && (
        <PackDetails
          key={chosen}
          name={chosen}
          files={files}
          sources={sources}
          onClose={() => setChosen(undefined)}
          onPublished={(message) => {
            setChosen(undefined);
            setPublished(message);
          }}
        />
      )}
    </section>
  );
}

/** The newest release of a pack that may be installed here, and why newer ones aren't. */
function usePackChoice(name: string) {
  const [choice, setChoice] = useState<ReleaseChoice>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void attempt;
    setChoice(undefined);
    setError(undefined);
    languagePackReleases(name, { fetch: packFetch }).then(
      (releases) => current && setChoice(chooseLanguagePackRelease(releases, GOODFELLOW_VERSION)),
      (problem: unknown) => current && setError(problem),
    );
    return () => {
      current = false;
    };
  }, [name, attempt]);
  return { choice, error, retry: () => setAttempt((count) => count + 1) };
}

function PackDetails({
  name,
  files,
  sources,
  onClose,
  onPublished,
}: {
  name: string;
  files: Readonly<Record<string, AdminTextFile>>;
  sources: readonly AdminTextSource[];
  onClose: () => void;
  onPublished: (message: string) => void;
}) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { choice, error: choiceError, retry } = usePackChoice(name);
  const [pack, setPack] = useState<LanguagePack>();
  const [packError, setPackError] = useState<unknown>();
  const [replaceOwn, setReplaceOwn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const [removing, setRemoving] = useState(false);
  const release = choice?.release;

  useEffect(() => {
    if (!release) return;
    let current = true;
    setPack(undefined);
    setPackError(undefined);
    fetchLanguagePack({ name, ...release }, { fetch: packFetch }).then(
      (read) => current && setPack(read),
      (problem: unknown) => current && setPackError(problem),
    );
    return () => {
      current = false;
    };
  }, [name, release]);

  // The language this pack is installed for here, if it is.
  const installedCode = Object.entries(files).find(([, file]) => file.pack?.name === name)?.[0];
  const code = pack?.manifest.code ?? installedCode;
  const file = code ? files[code] : undefined;
  const installedRelease = file?.pack?.name === name ? file.pack.release : undefined;
  const upToDate = installedRelease !== undefined && installedRelease === pack?.release;
  const language = file?.name ?? pack?.manifest.name ?? code ?? name;
  const builtIn = ADMIN_LANGUAGES.find((known) => known.code === code);
  const plan = useMemo(
    () => (pack && code ? planLanguagePack(code, file, pack, { replaceOwn }) : undefined),
    [pack, code, file, replaceOwn],
  );
  const keeping = useMemo(
    () => (pack && code ? planLanguagePack(code, file, pack).kept.length : 0),
    [pack, code, file],
  );
  const status = plan?.file && !builtIn ? languageStatus(plan.file, sources) : undefined;

  const install = async () => {
    if (!plan || !pack) return;
    setBusy(true);
    setFailure(null);
    const details = { name, version: pack.release, language: pack.manifest.name };
    const result = await publish(
      plan.changes,
      t(installedRelease ? "adminText.pack.updateMessage" : "adminText.pack.installMessage", details),
      { checks: false },
    );
    setBusy(false);
    if (result.ok) onPublished(t("adminText.pack.installed", { name, language: pack.manifest.name }));
    else setFailure(result);
  };

  const remove = async () => {
    const installedFile = installedCode ? files[installedCode] : undefined;
    if (!installedCode || !installedFile) return;
    setBusy(true);
    setFailure(null);
    const result = await publish(
      planLanguagePack(installedCode, installedFile, undefined).changes,
      t("adminText.pack.removeMessage", { name, language }),
      { checks: false },
    );
    setBusy(false);
    if (result.ok) onPublished(t("adminText.pack.removedNotice", { name }));
    else setFailure(result);
  };

  return (
    <section className="gfa-theme-details" aria-label={name}>
      <div className="gfa-screen-header">
        <h3>{name}</h3>
        <Button variant="ghost" onClick={onClose}>
          {t("action.close")}
        </Button>
      </div>
      {choiceError !== undefined && (
        <ErrorMessage
          message={packProblem(t, choiceError)}
          error={choiceError}
          action={<Button onClick={retry}>{t("action.tryAgain")}</Button>}
        />
      )}
      {!choice && choiceError === undefined && <p className="gfa-hint">{t("loading")}</p>}
      {choice && !release && (
        <p className="gfa-notice" role="note">
          {choice.waiting
            ? t("adminText.pack.tooNew", { days: String(RELEASE_AGE_DAYS) })
            : t("adminText.pack.notCompatible", { version: GOODFELLOW_VERSION })}
        </p>
      )}
      {release && (
        <>
          <p className="gfa-hint">
            {t("adminText.pack.releaseDetails", {
              name,
              version: release.version,
              date: new Date(release.published).toLocaleDateString(),
            })}
          </p>
          <p className="gfa-hint">
            {release.provenance && release.repository
              ? t("adminText.pack.provenance", { source: release.repository })
              : t("adminText.pack.noProvenance")}
          </p>
          {choice?.waiting && (
            <p className="gfa-hint">
              {t("adminText.pack.waiting", { version: choice.waiting.version, days: String(RELEASE_AGE_DAYS) })}
            </p>
          )}
          {choice?.incompatible && (
            <p className="gfa-hint">
              {t("adminText.pack.incompatible", {
                version: choice.incompatible.version,
                goodfellow: GOODFELLOW_VERSION,
              })}
            </p>
          )}
        </>
      )}
      {packError !== undefined && <ErrorMessage message={packProblem(t, packError)} error={packError} />}
      {release && !pack && packError === undefined && <p className="gfa-hint">{t("loading")}</p>}
      {pack && plan && code && (
        <>
          {pack.manifest.description && <p>{pack.manifest.description}</p>}
          <p>
            <strong lang={code}>{t("adminText.pack.language", { language: pack.manifest.name, code })}</strong>
          </p>
          {status && (
            <p>
              {t("adminText.pack.coverage", {
                current: String(status.current),
                total: String(status.total),
                language: pack.manifest.name,
              })}
            </p>
          )}
          {builtIn && <p className="gfa-notice">{t("adminText.pack.builtIn", { language: builtIn.name })}</p>}
          {file?.pack && file.pack.name !== name && (
            <p className="gfa-notice">{t("adminText.pack.other", { language, name: file.pack.name })}</p>
          )}
          {upToDate ? (
            <p className="gfa-hint">{t("adminText.pack.upToDate", { version: pack.release })}</p>
          ) : (
            <>
              {keeping > 0 && (
                <div className="gfa-notice" role="note">
                  <p>{t("adminText.pack.kept", { count: String(keeping) })}</p>
                  <label className="gfa-checkbox">
                    <input
                      type="checkbox"
                      checked={replaceOwn}
                      onChange={(event) => setReplaceOwn(event.target.checked)}
                    />{" "}
                    {t("adminText.pack.replaceOwn")}
                  </label>
                </div>
              )}
              {plan.replaced.length > 0 && (
                <p className="gfa-hint">{t("adminText.pack.replaced", { count: String(plan.replaced.length) })}</p>
              )}
              {plan.removed > 0 && (
                <p className="gfa-hint">{t("adminText.pack.removed", { count: String(plan.removed) })}</p>
              )}
            </>
          )}
        </>
      )}
      {!removing && <PublishFailure failure={failure} />}
      <div className="gfa-row-actions">
        {pack && plan && !upToDate && (
          <Button variant="primary" disabled={busy} onClick={() => void install()}>
            {installedRelease ? t("adminText.pack.update", { version: pack.release }) : t("adminText.pack.install")}
          </Button>
        )}
        {/* Removing needs nothing from npm, so it's offered even when no release can be read. */}
        {installedCode && (
          <Button variant="danger" disabled={busy} onClick={() => setRemoving(true)}>
            {t("adminText.pack.remove")}
          </Button>
        )}
      </div>
      {removing && (
        <Dialog title={t("adminText.pack.removeTitle", { name })} onClose={() => setRemoving(false)}>
          <p>{t("adminText.pack.removeBody", { language })}</p>
          <PublishFailure failure={failure} />
          <div className="gfa-dialog-actions">
            <Button onClick={() => setRemoving(false)}>{t("action.cancel")}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void remove()}>
              {t("adminText.pack.remove")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
