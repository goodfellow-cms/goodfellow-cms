/**
 * Site Settings' Themes screen: themes published on npm as
 * `goodfellow-theme-<name>`, which owners install, update and remove. A theme
 * is data with no code, so installing one runs nobody else's code: its
 * settings, CSS and optional header and footer are copied into the site
 * (`planTheme()`), where owners change them like any setting.
 */
import {
  allPages,
  chooseThemeRelease,
  compareReleases,
  fetchTheme,
  GOODFELLOW_VERSION,
  mayInstallEarly,
  type ProvenanceSource,
  pageTitle,
  parseThemeRecord,
  planTheme,
  readProvenanceSource,
  searchThemes,
  THEME_FILE,
  THEME_RELEASE_AGE_DAYS,
  type ThemeChanged,
  type ThemeChoice,
  ThemeError,
  type ThemeFetch,
  type ThemeListing,
  type ThemePackage,
  type ThemePlan,
  type ThemeRecord,
  themeFileUrl,
  themeLabel,
  themeLoads,
  themeReleases,
  themeUnknownBlocks,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin, useCanChangeSettings, useSiteContent } from "./admin-context.js";
import { PreviewFrame } from "./preview.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, Field, TextField } from "./ui.js";

const themeFetch: ThemeFetch = (url) => window.fetch(url);

type Translate = ReturnType<typeof useStrings>;

const CHANGED_GROUPS: Record<string, StringKey> = {
  colors: "theme.colors",
  darkColors: "theme.darkColors",
  darkMode: "theme.darkMode",
  fonts: "theme.fonts",
  radius: "theme.radius",
  code: "theme.code",
  parts: "theme.parts",
};

/** What owners changed, in words, each kind of setting once. */
function changedList(t: Translate, changed: readonly ThemeChanged[]): string[] {
  const names = changed.map((item) => {
    if (item.kind !== "setting") {
      return t(item.kind === "css" ? "themes.changed.css" : item.kind === "header" ? "layout.header" : "layout.footer");
    }
    const group = CHANGED_GROUPS[item.key.split(".")[0] ?? ""];
    return group ? t(group) : item.key;
  });
  return [...new Set(names)];
}

function themeProblem(t: Translate, error: unknown): string {
  if (!(error instanceof ThemeError)) return t("themes.error.unreachable");
  if (error.code === "unavailable") return t("themes.error.unreachable");
  if (error.code === "bad-file") return t("themes.error.badFile");
  return t("themes.error.notATheme");
}

/** The theme's record, read when the screen opens and after each publish. */
function useThemeRecord() {
  const { readFile, state } = useAdmin();
  const revision = state.status === "ready" ? state.revision : undefined;
  const [record, setRecord] = useState<ThemeRecord | null>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let current = true;
    void revision;
    readFile(THEME_FILE).then(
      (text) => {
        if (!current) return;
        try {
          setRecord(parseThemeRecord(text) ?? null);
        } catch (problem) {
          setError(problem);
          setRecord(null);
        }
      },
      (problem: unknown) => {
        if (!current) return;
        setError(problem);
        setRecord(null);
      },
    );
    return () => {
      current = false;
    };
  }, [readFile, revision]);
  return { record, error };
}

export function ThemesScreen() {
  const t = useStrings();
  const { record, error: recordError } = useThemeRecord();
  const [words, setWords] = useState("");
  const [searched, setSearched] = useState("");
  const [found, setFound] = useState<ThemeListing[]>();
  const [searchError, setSearchError] = useState<unknown>();
  const [chosen, setChosen] = useState<string>();
  const [published, setPublished] = useState<string>();

  const search = useCallback((text: string) => {
    setFound(undefined);
    setSearchError(undefined);
    setSearched(text);
    searchThemes(text, { fetch: themeFetch }).then(setFound, setSearchError);
  }, []);
  useEffect(() => search(""), [search]);

  const onPublished = (message: string) => {
    setChosen(undefined);
    setPublished(message);
  };

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.tab.themes")}</h1>
      </div>
      <p className="gfa-hint">{t("themes.intro")}</p>
      {published && (
        <p className="gfa-notice gfa-notice-success" role="status">
          {published}
        </p>
      )}
      {recordError !== undefined && <ErrorMessage message={t("themes.error.record")} error={recordError} />}

      <h2 className="gfa-section-title">{t("themes.installed")}</h2>
      {record === undefined ? (
        <p className="gfa-hint">{t("loading")}</p>
      ) : record === null ? (
        <p className="gfa-hint">{t("themes.noneInstalled")}</p>
      ) : (
        <InstalledTheme
          record={record}
          open={chosen === record.name}
          onOpen={() => setChosen(record.name)}
          onPublished={onPublished}
        />
      )}
      {record && chosen === record.name && (
        <ThemeDetails
          name={record.name}
          record={record}
          onClose={() => setChosen(undefined)}
          onPublished={onPublished}
        />
      )}

      <h2 className="gfa-section-title">{t("themes.find")}</h2>
      <form
        className="gfa-theme-search"
        onSubmit={(event) => {
          event.preventDefault();
          search(words);
        }}
      >
        <TextField label={t("themes.search")} value={words} onChange={setWords} />
        <Button type="submit">{t("themes.searchButton")}</Button>
      </form>
      {searchError !== undefined && (
        <ErrorMessage
          message={themeProblem(t, searchError)}
          error={searchError}
          action={<Button onClick={() => search(searched)}>{t("action.tryAgain")}</Button>}
        />
      )}
      {!found && searchError === undefined && <p className="gfa-hint">{t("themes.loading")}</p>}
      {found && found.length === 0 && <p className="gfa-hint">{t("themes.noneFound")}</p>}
      {found && found.length > 0 && (
        <ul className="gfa-block-grid">
          {found.map((listing) => (
            <li key={listing.name} className="gfa-block-card">
              <div className="gfa-block-text">
                <h3 className="gfa-block-title">
                  {themeLabel(listing.name)}
                  {record?.name === listing.name && <span className="gfa-badge">{t("themes.installedBadge")}</span>}
                </h3>
                {listing.description && <p className="gfa-hint">{listing.description}</p>}
                <p className="gfa-hint">
                  {listing.publisher
                    ? t("themes.byPublisher", { name: listing.name, publisher: listing.publisher })
                    : listing.name}
                </p>
              </div>
              <Button
                aria-label={t("themes.showLabel", { name: themeLabel(listing.name) })}
                onClick={() => setChosen(listing.name)}
              >
                {t("themes.show")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {chosen && chosen !== record?.name && (
        <ThemeDetails
          name={chosen}
          record={record ?? undefined}
          onClose={() => setChosen(undefined)}
          onPublished={onPublished}
        />
      )}
    </div>
  );
}

/** The newest release of a theme that may be installed here, and why newer ones aren't. */
function useThemeChoice(name: string) {
  const [choice, setChoice] = useState<ThemeChoice>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void attempt;
    setChoice(undefined);
    setError(undefined);
    themeReleases(name, { fetch: themeFetch }).then(
      (releases) => current && setChoice(chooseThemeRelease(releases, GOODFELLOW_VERSION)),
      (problem: unknown) => current && setError(problem),
    );
    return () => {
      current = false;
    };
  }, [name, attempt]);
  return { choice, error, retry: () => setAttempt((count) => count + 1) };
}

function InstalledTheme({
  record,
  open,
  onOpen,
  onPublished,
}: {
  record: ThemeRecord;
  open: boolean;
  onOpen: () => void;
  onPublished: (message: string) => void;
}) {
  const t = useStrings();
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  const { choice } = useThemeChoice(record.name);
  const [removing, setRemoving] = useState<ThemePlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const newer =
    choice?.release && compareReleases(choice.release.version, record.release) > 0 ? choice.release : undefined;

  const askRemove = async () => {
    setError(undefined);
    try {
      setRemoving(await planTheme({ ...content, record }, undefined));
    } catch (problem) {
      setError(problem);
    }
  };
  const remove = async () => {
    if (!removing) return;
    setBusy(true);
    const result = await publish(removing.changes, t("themes.removeMessage", { title: record.title }));
    setBusy(false);
    setRemoving(undefined);
    if (result.ok) onPublished(t("themes.removed", { title: record.title }));
    else if (result.reason !== "checks") setError(result.error);
  };

  return (
    <div className="gfa-block-row gfa-theme-installed">
      <span>
        <strong>{record.title}</strong>{" "}
        <span className="gfa-hint">{t("themes.release", { version: record.release })}</span>
        {newer && <span className="gfa-badge">{t("themes.updateAvailable", { version: newer.version })}</span>}
      </span>
      <span className="gfa-dialog-actions">
        {!open && (
          <Button variant={newer ? "primary" : "ghost"} onClick={onOpen}>
            {newer ? t("themes.seeVersion", { version: newer.version }) : t("themes.show")}
          </Button>
        )}
        <Button variant="ghost" onClick={() => void askRemove()}>
          {t("themes.remove")}
        </Button>
      </span>
      {error !== undefined && <ErrorMessage message={t("publish.error")} error={error} />}
      {removing && (
        <Dialog title={t("themes.removeTitle", { title: record.title })} onClose={() => setRemoving(undefined)}>
          <p>{t("themes.removeBody")}</p>
          {removing.replaced.length > 0 && (
            <p>{t("themes.removeReplaced", { list: changedList(t, removing.replaced).join(", ") })}</p>
          )}
          <div className="gfa-dialog-actions">
            <Button onClick={() => setRemoving(undefined)}>{t("action.cancel")}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void remove()}>
              {busy ? t("publish.publishing") : t("themes.remove")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

/** A theme's newest release that may be installed, with what installing it changes, a preview, and Install or Update. */
function ThemeDetails({
  name,
  record,
  onClose,
  onPublished,
}: {
  name: string;
  record: ThemeRecord | undefined;
  onClose: () => void;
  onPublished: (message: string) => void;
}) {
  const t = useStrings();
  const { publish, site, demo } = useAdmin();
  const { content } = useSiteContent();
  const { choice, error: choiceError, retry } = useThemeChoice(name);
  const [theme, setTheme] = useState<ThemePackage>();
  const [themeError, setThemeError] = useState<unknown>();
  const [layout, setLayout] = useState<boolean>();
  const [plan, setPlan] = useState<ThemePlan>();
  const [busy, setBusy] = useState(false);
  const [publishError, setPublishError] = useState<unknown>();
  // The page the preview shows: the home page until another is chosen.
  const [shown, setShown] = useState("/");
  const update = record?.name === name;
  // Where the newer release waiting could be installed now: built where the release installed was. Owners only.
  const owner = useCanChangeSettings();
  const [offer, setOffer] = useState<ProvenanceSource>();
  const [early, setEarly] = useState<ProvenanceSource>();
  const waiting = choice?.waiting;
  useEffect(() => {
    setOffer(undefined);
    setEarly(undefined);
    if (!waiting || !update || !record || !owner || demo) return;
    let current = true;
    const options = { fetch: themeFetch };
    Promise.all([
      // Sites that installed it before provenance was recorded read it from npm once, and record it.
      record.provenance ?? readProvenanceSource(name, record.release, options),
      readProvenanceSource(name, waiting.version, options),
    ]).then(([was, next]) => {
      if (!current) return;
      const decision = mayInstallEarly(
        { release: record.release, ...(was && { provenance: was }) },
        { version: waiting.version, ...(next && { provenance: next }) },
      );
      setOffer(decision.early ? decision.source : undefined);
    });
    return () => {
      current = false;
    };
  }, [name, record, update, waiting, owner, demo]);
  const release = early ? waiting : choice?.release;

  useEffect(() => {
    if (!release) return;
    let current = true;
    setTheme(undefined);
    setThemeError(undefined);
    fetchTheme({ name, ...release }, { fetch: themeFetch }).then(
      (read) => current && setTheme(read),
      (problem: unknown) => current && setThemeError(problem),
    );
    return () => {
      current = false;
    };
  }, [name, release]);

  const unknownBlocks = useMemo(
    () => (theme ? themeUnknownBlocks(theme, Object.keys(site.description.blocks)) : []),
    [theme, site.description.blocks],
  );
  const hasLayout = Boolean(theme?.header || theme?.footer);
  // On an update, the header and footer are used where the release before was.
  const useLayout =
    hasLayout && unknownBlocks.length === 0 && (layout ?? (update && Boolean(record?.header || record?.footer)));

  useEffect(() => {
    if (!theme) return;
    let current = true;
    // Where it was built, for the record, which later updates installed early are checked against.
    readProvenanceSource(name, theme.release, { fetch: themeFetch })
      .then((provenance) =>
        planTheme({ ...content, ...(record && { record }) }, theme, {
          layout: useLayout,
          ...(provenance && { provenance }),
          ...(early && { early }),
        }),
      )
      .then(
        (next) => current && setPlan(next),
        (problem: unknown) => current && setThemeError(problem),
      );
    return () => {
      current = false;
    };
  }, [name, theme, content, record, useLayout, early]);

  const loads = useMemo(() => (theme ? themeLoads(theme) : []), [theme]);
  const pages = useMemo(() => allPages(content), [content]);
  const previewPath = (pages.find((candidate) => candidate.path === shown) ?? pages[0])?.path ?? "/";
  const show = useMemo(
    () =>
      plan && {
        content: {
          ...content,
          settings: plan.settings,
          customCss: plan.customCss,
          header: plan.header,
          footer: plan.footer,
        },
        path: previewPath,
      },
    [plan, content, previewPath],
  );
  const title = theme?.manifest.title ?? themeLabel(name);
  const sameRelease = update && release?.version === record?.release;

  const install = async () => {
    if (!plan || !theme) return;
    setBusy(true);
    setPublishError(undefined);
    const message = update
      ? t("themes.updateMessage", { title, version: theme.release })
      : t("themes.installMessage", { title, version: theme.release });
    const result = await publish(plan.changes, message);
    setBusy(false);
    if (result.ok) {
      onPublished(
        update ? t("themes.updated", { title, version: theme.release }) : t("themes.installedNotice", { title }),
      );
    } else if (result.reason !== "checks") {
      setPublishError(result.error);
    }
  };

  return (
    <section className="gfa-theme-details" aria-label={title}>
      <div className="gfa-screen-header">
        <h2>{title}</h2>
        <Button variant="ghost" onClick={onClose}>
          {t("action.close")}
        </Button>
      </div>
      {choiceError !== undefined && (
        <ErrorMessage
          message={themeProblem(t, choiceError)}
          error={choiceError}
          action={<Button onClick={retry}>{t("action.tryAgain")}</Button>}
        />
      )}
      {!choice && choiceError === undefined && <p className="gfa-hint">{t("loading")}</p>}
      {choice && !release && (
        <p className="gfa-notice" role="note">
          {choice.waiting
            ? t("themes.tooNew", { days: String(THEME_RELEASE_AGE_DAYS) })
            : t("themes.notCompatible", { version: GOODFELLOW_VERSION })}
        </p>
      )}
      {offer && !early && waiting && record && (
        <div className="gfa-notice" role="note">
          <p>{t("themes.early", { version: waiting.version, installed: record.release, source: offer.repository })}</p>
          <Button onClick={() => setEarly(offer)}>{t("themes.installNow", { version: waiting.version })}</Button>
        </div>
      )}
      {release && (
        <>
          {theme?.manifest.description && <p>{theme.manifest.description}</p>}
          <p className="gfa-hint">
            {t("themes.releaseDetails", {
              name,
              version: release.version,
              date: new Date(release.published).toLocaleDateString(),
            })}
          </p>
          <p className="gfa-hint">
            {release.provenance && release.repository
              ? t("themes.provenance", { source: release.repository })
              : t("themes.noProvenance")}
          </p>
          {choice?.waiting && !early && (
            <p className="gfa-hint">
              {t("themes.waiting", { version: choice.waiting.version, days: String(THEME_RELEASE_AGE_DAYS) })}
            </p>
          )}
          {early && waiting && record && (
            <p className="gfa-notice" role="note">
              {t("themes.earlyNotice", {
                version: waiting.version,
                days: String(THEME_RELEASE_AGE_DAYS),
                installed: record.release,
              })}
            </p>
          )}
          {choice?.incompatible && (
            <p className="gfa-hint">
              {t("themes.incompatible", { version: choice.incompatible.version, goodfellow: GOODFELLOW_VERSION })}
            </p>
          )}
        </>
      )}
      {themeError !== undefined && <ErrorMessage message={themeProblem(t, themeError)} error={themeError} />}
      {release && !theme && themeError === undefined && <p className="gfa-hint">{t("loading")}</p>}
      {theme && (
        <>
          {theme.manifest.image && (
            <img
              className="gfa-theme-image"
              src={themeFileUrl(name, theme.release, theme.manifest.image)}
              alt={t("themes.imageAlt", { title })}
            />
          )}
          <Swatches colors={theme.manifest.theme.colors} />
          {loads.length > 0 && (
            <div className="gfa-notice" role="note">
              <p>{t("themes.loads")}</p>
              <ul>
                {loads.map((address) => (
                  <li key={address}>
                    <code>{address}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {hasLayout &&
            (unknownBlocks.length > 0 ? (
              <p className="gfa-hint">{t("themes.layoutUnknown", { blocks: unknownBlocks.join(", ") })}</p>
            ) : (
              <label className="gfa-checkbox">
                <input type="checkbox" checked={useLayout} onChange={(event) => setLayout(event.target.checked)} />
                {t("themes.useLayout")}
              </label>
            ))}
          {plan && plan.kept.length > 0 && (
            <p className="gfa-hint">{t("themes.kept", { list: changedList(t, plan.kept).join(", ") })}</p>
          )}
          {plan && plan.replaced.length > 0 && (
            <p className="gfa-notice" role="note">
              {t("themes.replaced", { list: changedList(t, plan.replaced).join(", ") })}
            </p>
          )}
          {pages.length > 1 && (
            <Field label={t("themes.previewPage")}>
              {(props) => (
                <select
                  {...props}
                  className="gfa-input"
                  value={previewPath}
                  onChange={(event) => setShown(event.target.value)}
                >
                  {pages.map((candidate) => (
                    <option key={candidate.path} value={candidate.path}>
                      {pageTitle(candidate)} ({candidate.path})
                    </option>
                  ))}
                </select>
              )}
            </Field>
          )}
          {show && (
            <div className="gfa-theme-preview">
              <PreviewFrame title={t("themes.preview", { title })} show={show} />
            </div>
          )}
          {publishError !== undefined && <ErrorMessage message={t("publish.error")} error={publishError} />}
          <div className="gfa-dialog-actions">
            <Button variant="primary" disabled={!plan || busy || sameRelease} onClick={() => void install()}>
              {busy
                ? t("publish.publishing")
                : sameRelease
                  ? t("themes.upToDate")
                  : update
                    ? t("themes.updateTo", { version: theme.release })
                    : demo
                      ? t("themes.installDemo")
                      : t("themes.install")}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function Swatches({ colors }: { colors: Readonly<Record<string, string | undefined>> }) {
  const t = useStrings();
  const shown = Object.entries(colors).filter((entry): entry is [string, string] => entry[1] !== undefined);
  if (shown.length === 0) return null;
  return (
    <ul className="gfa-theme-swatches" aria-label={t("theme.colors")}>
      {shown.map(([name, color]) => (
        <li key={name} title={`${t(`theme.color.${name}` as StringKey)}: ${color}`}>
          <span className="gfa-theme-swatch" style={{ background: color }} aria-hidden="true" />
          <span className="gfa-visually-hidden">{`${t(`theme.color.${name}` as StringKey)}: ${color}`}</span>
        </li>
      ))}
    </ul>
  );
}
