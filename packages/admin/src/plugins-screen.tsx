/**
 * Site Settings' Plugins screen: plugins published on npm as
 * `goodfellow-plugin-<name>`, which owners install, update and remove. A
 * plugin has code, which is included when the site builds, so the screen
 * shows what each asks to do (its `goodfellow-plugin.json`) and what its
 * packages' code could do (`reviewPluginPackages()`) before installing it,
 * and installs only where the site's own pages can't publish code
 * (`pluginInstalls`): at a checked admin address or with a token broker, or,
 * on full-stack sites, as a change submitted for a developer to review.
 */
import {
  blockUses,
  CONFIG_FILE,
  chooseRelease,
  compareReleases,
  fetchPluginPackage,
  GOODFELLOW_VERSION,
  INSTALLED_PLUGINS_FILE,
  type InstalledPlugin,
  type InstalledPlugins,
  mayInstallEarly,
  PackageError,
  type PackageFetch,
  type PackageListing,
  type PackageReview,
  type PermissionChange,
  PluginInstallError,
  type PluginManifest,
  type PluginPackage,
  type PluginPlan,
  type ProvenanceSource,
  parseInstalledPlugins,
  permissionChanges,
  planPluginInstall,
  planPluginRemove,
  pluginReleases,
  RELEASE_AGE_DAYS,
  type ReleaseChoice,
  readProvenanceSource,
  reviewPluginPackages,
  searchPlugins,
  writesEarlyLockfile,
  writesLockfile,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAdmin, useCanChangeSettings, useSiteContent } from "./admin-context.js";
import { AppServerError } from "./app-server.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, TextField } from "./ui.js";
import { AppLink } from "./use-link.js";

const packageFetch: PackageFetch = (url) => window.fetch(url);

type Translate = ReturnType<typeof useStrings>;

/** The setup files whose workflows write the lockfile, as the starters' do. */
const SETUP_FILES = [".github/workflows/deploy.yml", ".gitlab-ci.yml", "bitbucket-pipelines.yml"];

/** What a plugin is called until its own title is read: `goodfellow-plugin-guest-book` → "Guest book". */
function pluginLabel(name: string): string {
  const words = name.replace(/^.*goodfellow-plugin-/, "").replace(/[-_.~]+/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function packageProblem(t: Translate, error: unknown): string {
  if (!(error instanceof PackageError) || error.code === "unavailable") return t("plugins.error.unreachable");
  if (error.code === "bad-file") return t("plugins.error.badFile");
  return t("plugins.error.notAPlugin");
}

function installProblem(t: Translate, error: unknown, version?: string): string | undefined {
  // The site's server checked a release installed early, and its provenance didn't allow it.
  if (error instanceof AppServerError && error.code === "early-refused") {
    return t("plugins.earlyRefused", {
      version: version ?? "",
      days: String(RELEASE_AGE_DAYS),
      reasons: error.reasons.join(" "),
    });
  }
  if (!(error instanceof PluginInstallError)) return undefined;
  const { problem } = error;
  if (problem.code === "config") return t("plugins.error.config");
  if (problem.code === "in-code") return t("plugins.error.inCode");
  if (problem.code === "block-clash") return t("plugins.error.blockClash", { blocks: problem.blocks.join(", ") });
  return t("plugins.error.notInstalled");
}

/** What a plugin asks to do, a line each. */
function asksFor(t: Translate, manifest: PluginManifest): string[] {
  const { permissions } = manifest;
  const list = (values: readonly string[] | undefined, key: StringKey) =>
    values?.length ? [t(key, { list: values.join(", ") })] : [];
  return [
    ...list(permissions.connect, "plugins.asks.connect"),
    ...list(permissions.files, "plugins.asks.files"),
    ...list(permissions.secrets, "plugins.asks.secrets"),
    ...list(permissions.read, "plugins.asks.read"),
    ...list(permissions.write, "plugins.asks.write"),
    ...list(manifest.blocks, "plugins.asks.blocks"),
    ...(manifest.admin ? [t("plugins.asks.admin")] : []),
    ...list(
      manifest.screens?.map((screen) => screen.title),
      "plugins.asks.screens",
    ),
    ...list(
      manifest.build?.map((step) => step.title ?? step.id),
      "plugins.asks.build",
    ),
    ...list(
      manifest.tasks?.map((task) => task.title ?? task.id),
      "plugins.asks.tasks",
    ),
    ...(manifest.server ? [t("plugins.asks.server")] : []),
    ...(manifest.mediaStorage ? [t("plugins.asks.mediaStorage")] : []),
    ...(manifest.editor ? [t("plugins.asks.editor", { title: manifest.editor.title })] : []),
  ];
}

/** The record of plugins installed from this screen, read when the screen opens and after each publish. */
function useInstalledPlugins() {
  const { readFile, state } = useAdmin();
  const revision = state.status === "ready" ? state.revision : undefined;
  const [record, setRecord] = useState<{ text: string | undefined; plugins: InstalledPlugins }>();
  const [error, setError] = useState<unknown>();
  useEffect(() => {
    let current = true;
    void revision;
    readFile(INSTALLED_PLUGINS_FILE).then(
      (text) => {
        if (!current) return;
        try {
          setRecord({ text, plugins: parseInstalledPlugins(text) });
        } catch (problem) {
          setError(problem);
        }
      },
      (problem: unknown) => current && setError(problem),
    );
    return () => {
      current = false;
    };
  }, [readFile, revision]);
  return { record, error };
}

/**
 * Whether the site's setup writes the lockfile when package.json changes, and
 * for plugins installed before they're old enough once their provenance
 * checks out, read from its setup files.
 */
function useLockfileSetup(): { writes?: boolean; early: boolean } {
  const { versions, state, pluginInstalls } = useAdmin();
  const revision = state.status === "ready" ? state.revision : undefined;
  const [setup, setSetup] = useState<{ writes?: boolean; early: boolean }>({ early: false });
  useEffect(() => {
    // A developer reviews changes on full-stack sites, and builds them as they choose; the server checks
    // plugins installed early itself.
    if (pluginInstalls === "review") return setSetup({ writes: true, early: true });
    if (!versions || !revision) return setSetup({ writes: false, early: false });
    let current = true;
    Promise.all(SETUP_FILES.map((path) => versions.readAt(path, revision).catch(() => undefined))).then(
      (texts) => current && setSetup({ writes: writesLockfile(texts), early: writesEarlyLockfile(texts) }),
    );
    return () => {
      current = false;
    };
  }, [versions, revision, pluginInstalls]);
  return setup;
}

/** Why plugins can't be installed here, in words, or nothing where they can. */
function useWhyNot(): string | undefined {
  const t = useStrings();
  const { pluginInstalls, contentOnly, demo, outOfReach } = useAdmin();
  if (pluginInstalls) return undefined;
  if (contentOnly) return t("plugins.where.contentOnly");
  if (demo) return t("plugins.where.demo");
  // The development servers' admin panels are out of reach too, but plugins are packages a developer installs there.
  if (outOfReach) return t("plugins.where.local");
  return t("plugins.where.none");
}

export function PluginsScreen() {
  const t = useStrings();
  const { site } = useAdmin();
  const { record, error: recordError } = useInstalledPlugins();
  const { writes: lockfile, early: earlySetup } = useLockfileSetup();
  // Only owners may skip the wait, and only where the site's setup checks it.
  const canInstallEarly = useCanChangeSettings() && earlySetup;
  const whyNot = useWhyNot();
  const [words, setWords] = useState("");
  const [searched, setSearched] = useState("");
  const [found, setFound] = useState<PackageListing[]>();
  const [searchError, setSearchError] = useState<unknown>();
  const [chosen, setChosen] = useState<string>();
  const [done, setDone] = useState<{ message: string; url?: string }>();

  const search = useCallback((text: string) => {
    setFound(undefined);
    setSearchError(undefined);
    setSearched(text);
    searchPlugins(text, { fetch: packageFetch }).then(setFound, setSearchError);
  }, []);
  useEffect(() => search(""), [search]);

  const installed = record?.plugins.plugins ?? {};
  // Plugins a developer added in code, which this screen leaves to them.
  const inCode = (site.description.plugins ?? []).filter((plugin) => !installed[plugin.name]);
  const onDone = (message: string, url?: string) => {
    setChosen(undefined);
    setDone({ message, ...(url && { url }) });
  };
  const canInstall = whyNot === undefined && lockfile === true;

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.tab.plugins")}</h1>
      </div>
      <p className="gfa-hint">{t("plugins.intro")}</p>
      {whyNot && (
        <p className="gfa-notice" role="note">
          {whyNot}
        </p>
      )}
      {!whyNot && lockfile === false && (
        <p className="gfa-notice" role="note">
          {t("plugins.where.setup")}
        </p>
      )}
      {done && (
        <p className="gfa-notice gfa-notice-success" role="status">
          {done.message}{" "}
          {done.url && (
            <a href={done.url} target="_blank" rel="noreferrer">
              {t("plugins.seeReview")}
            </a>
          )}
        </p>
      )}
      {recordError !== undefined && <ErrorMessage message={t("plugins.error.record")} error={recordError} />}

      <h2 className="gfa-section-title">{t("plugins.installed")}</h2>
      {!record && recordError === undefined ? (
        <p className="gfa-hint">{t("loading")}</p>
      ) : Object.keys(installed).length === 0 && inCode.length === 0 ? (
        <p className="gfa-hint">{t("plugins.noneInstalled")}</p>
      ) : (
        <ul className="gfa-block-list">
          {Object.entries(installed).map(([name, plugin]) => (
            <InstalledRow
              key={name}
              name={name}
              plugin={plugin}
              record={record?.text}
              canChange={canInstall}
              onOpen={() => setChosen(name)}
              onDone={onDone}
            />
          ))}
          {inCode.map((plugin) => (
            <li key={plugin.name} className="gfa-block-row">
              <span>
                <strong>{plugin.title}</strong> <span className="gfa-hint">{t("plugins.inCode")}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      {chosen && installed[chosen] && (
        <PluginDetails
          name={chosen}
          installed={installed[chosen]}
          record={record?.text}
          canInstall={canInstall}
          canInstallEarly={canInstall && canInstallEarly}
          onClose={() => setChosen(undefined)}
          onDone={onDone}
        />
      )}

      <h2 className="gfa-section-title">{t("plugins.find")}</h2>
      <form
        className="gfa-theme-search"
        onSubmit={(event) => {
          event.preventDefault();
          search(words);
        }}
      >
        <TextField label={t("plugins.search")} value={words} onChange={setWords} />
        <Button type="submit">{t("plugins.searchButton")}</Button>
      </form>
      {searchError !== undefined && (
        <ErrorMessage
          message={packageProblem(t, searchError)}
          error={searchError}
          action={<Button onClick={() => search(searched)}>{t("action.tryAgain")}</Button>}
        />
      )}
      {!found && searchError === undefined && <p className="gfa-hint">{t("plugins.loading")}</p>}
      {found && found.length === 0 && <p className="gfa-hint">{t("plugins.noneFound")}</p>}
      {found && found.length > 0 && (
        <ul className="gfa-block-grid">
          {found.map((listing) => (
            <li key={listing.name} className="gfa-block-card">
              <div className="gfa-block-text">
                <h3 className="gfa-block-title">
                  {pluginLabel(listing.name)}
                  {installed[listing.name] && <span className="gfa-badge">{t("plugins.installedBadge")}</span>}
                </h3>
                {listing.description && <p className="gfa-hint">{listing.description}</p>}
                <p className="gfa-hint">
                  {listing.publisher
                    ? t("plugins.byPublisher", { name: listing.name, publisher: listing.publisher })
                    : listing.name}
                </p>
              </div>
              <Button
                aria-label={t("plugins.showLabel", { name: pluginLabel(listing.name) })}
                onClick={() => setChosen(listing.name)}
              >
                {t("plugins.show")}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {chosen && !installed[chosen] && (
        <PluginDetails
          name={chosen}
          record={record?.text}
          canInstall={canInstall}
          canInstallEarly={canInstall && canInstallEarly}
          onClose={() => setChosen(undefined)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

/** The newest release of a plugin that may be installed here, and why newer ones aren't. */
function useReleaseChoice(name: string) {
  const [choice, setChoice] = useState<ReleaseChoice>();
  const [error, setError] = useState<unknown>();
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void attempt;
    setChoice(undefined);
    setError(undefined);
    pluginReleases(name, { fetch: packageFetch }).then(
      (releases) => current && setChoice(chooseRelease(releases, GOODFELLOW_VERSION)),
      (problem: unknown) => current && setError(problem),
    );
    return () => {
      current = false;
    };
  }, [name, attempt]);
  return { choice, error, retry: () => setAttempt((count) => count + 1) };
}

/** Publishes a plan, or on a full-stack site submits it for review; says how it went. */
function useApply() {
  const { publish, pluginInstalls, account, state } = useAdmin();
  return async (
    plan: PluginPlan,
    message: string,
    description: string,
  ): Promise<{ ok: true; url?: string } | { ok: false; error?: unknown }> => {
    if (pluginInstalls === "review") {
      if (!account?.review || state.status !== "ready") return { ok: false };
      try {
        const { url } = await account.review(plan.changes, { title: message, description, from: state.revision });
        return { ok: true, url };
      } catch (error) {
        return { ok: false, error };
      }
    }
    const result = await publish(plan.changes, message, { checks: false });
    return result.ok ? { ok: true } : { ok: false, ...(result.reason !== "checks" && { error: result.error }) };
  };
}

/** The site's files an install changes, read at the loaded revision. */
function useInstallFiles() {
  const { versions, state } = useAdmin();
  const revision = state.status === "ready" ? state.revision : undefined;
  return useCallback(async () => {
    if (!versions || !revision) throw new Error("The site's files can't be read here.");
    const [packageJson, config] = await Promise.all([
      versions.readAt("package.json", revision),
      versions.readAt(CONFIG_FILE, revision),
    ]);
    if (packageJson === undefined || config === undefined) {
      throw new Error("The site's package.json or config is missing.");
    }
    return { packageJson, config };
  }, [versions, revision]);
}

function InstalledRow({
  name,
  plugin,
  record,
  canChange,
  onOpen,
  onDone,
}: {
  name: string;
  plugin: InstalledPlugin;
  record: string | undefined;
  canChange: boolean;
  onOpen: () => void;
  onDone: (message: string, url?: string) => void;
}) {
  const t = useStrings();
  const { pluginInstalls } = useAdmin();
  const { content } = useSiteContent();
  const { choice } = useReleaseChoice(name);
  const readFiles = useInstallFiles();
  const apply = useApply();
  const [removing, setRemoving] = useState<{ plan?: PluginPlan; uses: string[]; keepsMedia?: boolean }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const title = plugin.manifest.title;
  const newer =
    choice?.release && compareReleases(choice.release.version, plugin.release) > 0 ? choice.release : undefined;

  const askRemove = async () => {
    setError(undefined);
    // Content refers to blocks by name, so a plugin whose blocks are used stays.
    const uses = (plugin.manifest.blocks ?? []).flatMap((block) =>
      blockUses(content, block).length > 0 ? [block] : [],
    );
    if (uses.length > 0) return setRemoving({ uses });
    // Pages show the media it keeps from its storage, which a developer could still remove it from the config without losing.
    const storage = content.mediaStorage;
    if (storage?.plugin === name && Object.keys(storage.files).length > 0) {
      return setRemoving({ uses: [], keepsMedia: true });
    }
    try {
      const { packageJson } = await readFiles();
      setRemoving({ plan: planPluginRemove({ packageJson, record }, name), uses: [] });
    } catch (problem) {
      setError(problem);
    }
  };
  const remove = async () => {
    if (!removing?.plan) return;
    setBusy(true);
    const result = await apply(
      removing.plan,
      t("plugins.removeMessage", { title }),
      t("plugins.removeMessage", { title }),
    );
    setBusy(false);
    setRemoving(undefined);
    if (result.ok) onDone(result.url ? t("plugins.submitted", { title }) : t("plugins.removed", { title }), result.url);
    else if (result.error !== undefined) setError(result.error);
  };

  return (
    <li className="gfa-block-row gfa-theme-installed">
      <span>
        <strong>{title}</strong> <span className="gfa-hint">{t("plugins.release", { version: plugin.release })}</span>
        {newer && <span className="gfa-badge">{t("plugins.updateAvailable", { version: newer.version })}</span>}
      </span>
      <span className="gfa-dialog-actions">
        <Button variant={newer ? "primary" : "ghost"} onClick={onOpen}>
          {newer ? t("plugins.seeVersion", { version: newer.version }) : t("plugins.show")}
        </Button>
        {canChange && (
          <Button variant="ghost" onClick={() => void askRemove()}>
            {t("plugins.remove")}
          </Button>
        )}
      </span>
      {error !== undefined && <ErrorMessage message={installProblem(t, error) ?? t("publish.error")} error={error} />}
      {removing && (
        <Dialog title={t("plugins.removeTitle", { title })} onClose={() => setRemoving(undefined)}>
          {removing.uses.length > 0 ? (
            <p>{t("plugins.removeUsed", { blocks: removing.uses.join(", ") })}</p>
          ) : removing.keepsMedia ? (
            <p>
              {t("plugins.removeKeepsMedia", { title })} <AppLink href="#/media">{t("nav.media")}</AppLink>
            </p>
          ) : (
            <p>{t("plugins.removeBody")}</p>
          )}
          <div className="gfa-dialog-actions">
            <Button onClick={() => setRemoving(undefined)}>{t("action.cancel")}</Button>
            {removing.plan && (
              <Button variant="primary" disabled={busy} onClick={() => void remove()}>
                {busy
                  ? t("publish.publishing")
                  : pluginInstalls === "review"
                    ? t("plugins.removeReview")
                    : t("plugins.remove")}
              </Button>
            )}
          </div>
        </Dialog>
      )}
    </li>
  );
}

/** A plugin's newest release that may be installed: what it asks to do, what its code could do, and Install or Update. */
function PluginDetails({
  name,
  installed,
  record,
  canInstall,
  canInstallEarly = false,
  onClose,
  onDone,
}: {
  name: string;
  installed?: InstalledPlugin;
  record: string | undefined;
  canInstall: boolean;
  canInstallEarly?: boolean;
  onClose: () => void;
  onDone: (message: string, url?: string) => void;
}) {
  const t = useStrings();
  const { site, pluginInstalls } = useAdmin();
  const { choice, error: choiceError, retry } = useReleaseChoice(name);
  const readFiles = useInstallFiles();
  const apply = useApply();
  const [plugin, setPlugin] = useState<PluginPackage>();
  const [pluginError, setPluginError] = useState<unknown>();
  const [reviews, setReviews] = useState<PackageReview[]>([]);
  const [reviewed, setReviewed] = useState(false);
  const [confirming, setConfirming] = useState<PluginPlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  // Where the newer release waiting could be installed now: built where the release installed was.
  const [offer, setOffer] = useState<ProvenanceSource>();
  const [early, setEarly] = useState<ProvenanceSource>();
  const waiting = choice?.waiting;
  useEffect(() => {
    setOffer(undefined);
    setEarly(undefined);
    if (!waiting || !installed || !canInstallEarly) return;
    let current = true;
    const options = { fetch: packageFetch };
    Promise.all([
      // Sites that installed it before provenance was recorded read it from npm once, and record it.
      installed.provenance ?? readProvenanceSource(name, installed.release, options),
      readProvenanceSource(name, waiting.version, options),
    ]).then(([was, next]) => {
      if (!current) return;
      const decision = mayInstallEarly(
        { release: installed.release, ...(was && { provenance: was }) },
        { version: waiting.version, ...(next && { provenance: next }) },
      );
      setOffer(decision.early ? decision.source : undefined);
    });
    return () => {
      current = false;
    };
  }, [name, installed, waiting, canInstallEarly]);
  const release = early ? waiting : choice?.release;
  const sameRelease = installed?.release === release?.version;

  useEffect(() => {
    if (!release) return;
    let current = true;
    setPlugin(undefined);
    setPluginError(undefined);
    setReviews([]);
    setReviewed(false);
    fetchPluginPackage(name, release, { fetch: packageFetch }).then(
      async (read) => {
        if (!current) return;
        setPlugin(read);
        // What its packages' code could do, read as soon as it's known, since installing waits for it. Packages
        // the site has already are left out.
        const known = await readFiles().then(
          ({ packageJson }) => Object.keys((JSON.parse(packageJson) as { dependencies?: object }).dependencies ?? {}),
          () => [],
        );
        await reviewPluginPackages(name, release, {
          fetch: packageFetch,
          known: [...known, ...KNOWN_PACKAGES],
          onPackage: (review) => current && setReviews((before) => [...before, review]),
        }).catch(() => undefined);
        if (current) setReviewed(true);
      },
      (problem: unknown) => current && setPluginError(problem),
    );
    return () => {
      current = false;
    };
  }, [name, release, readFiles]);

  const changes = useMemo<PermissionChange[]>(
    () => (installed && plugin ? permissionChanges(installed.manifest, plugin.manifest) : []),
    [installed, plugin],
  );
  const title = plugin?.manifest.title ?? installed?.manifest.title ?? pluginLabel(name);
  const asks = plugin ? asksFor(t, plugin.manifest) : [];

  const askInstall = async () => {
    if (!plugin) return;
    setError(undefined);
    try {
      const files = await readFiles();
      const blocks = Object.keys(site.description.blocks);
      const plugins = (site.description.plugins ?? []).map((described) => described.name);
      // Where it was built, for the record, which later updates installed early are checked against.
      const provenance = await readProvenanceSource(name, plugin.release.version, { fetch: packageFetch });
      setConfirming(
        planPluginInstall({ ...files, ...(record !== undefined && { record }), blocks, plugins }, plugin, {
          today: new Date().toISOString().slice(0, 10),
          ...(provenance && { provenance }),
          ...(early && { early }),
        }),
      );
    } catch (problem) {
      setError(problem);
    }
  };
  const install = async () => {
    if (!confirming || !plugin) return;
    setBusy(true);
    const version = plugin.release.version;
    const message = installed
      ? t("plugins.updateMessage", { title, version })
      : t("plugins.installMessage", { title, version });
    const description = [t("plugins.reviewIntro", { name, version }), ...asks.map((line) => `- ${line}`)].join("\n");
    const result = await apply(confirming, message, description);
    setBusy(false);
    setConfirming(undefined);
    if (result.ok) {
      onDone(
        result.url
          ? t("plugins.submitted", { title })
          : installed
            ? t("plugins.updated", { title, version })
            : t("plugins.installedNotice", { title }),
        result.url,
      );
    } else if (result.error !== undefined) {
      setError(result.error);
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
          message={packageProblem(t, choiceError)}
          error={choiceError}
          action={<Button onClick={retry}>{t("action.tryAgain")}</Button>}
        />
      )}
      {!choice && choiceError === undefined && <p className="gfa-hint">{t("loading")}</p>}
      {choice && !release && (
        <p className="gfa-notice" role="note">
          {choice.waiting
            ? t("plugins.tooNew", { days: String(RELEASE_AGE_DAYS) })
            : t("plugins.notCompatible", { version: GOODFELLOW_VERSION })}
        </p>
      )}
      {offer && !early && waiting && installed && (
        <div className="gfa-notice" role="note">
          <p>
            {t("plugins.early", {
              version: waiting.version,
              installed: installed.release,
              source: offer.repository,
            })}
          </p>
          <Button onClick={() => setEarly(offer)}>{t("plugins.installNow", { version: waiting.version })}</Button>
        </div>
      )}
      {release && (
        <>
          {plugin?.manifest.description && <p>{plugin.manifest.description}</p>}
          <p className="gfa-hint">
            {t("plugins.releaseDetails", {
              name,
              version: release.version,
              date: new Date(release.published).toLocaleDateString(),
            })}
          </p>
          <p className="gfa-hint">
            {release.provenance && release.repository
              ? t("plugins.provenance", { source: release.repository })
              : t("plugins.noProvenance")}
          </p>
          {choice?.waiting && !early && (
            <p className="gfa-hint">
              {t("plugins.waiting", { version: choice.waiting.version, days: String(RELEASE_AGE_DAYS) })}
            </p>
          )}
          {early && waiting && installed && (
            <p className="gfa-notice" role="note">
              {t("plugins.earlyNotice", {
                version: waiting.version,
                days: String(RELEASE_AGE_DAYS),
                installed: installed.release,
              })}
            </p>
          )}
          {choice?.incompatible && (
            <p className="gfa-hint">
              {t("plugins.incompatible", { version: choice.incompatible.version, goodfellow: GOODFELLOW_VERSION })}
            </p>
          )}
        </>
      )}
      {pluginError !== undefined && <ErrorMessage message={packageProblem(t, pluginError)} error={pluginError} />}
      {release && !plugin && pluginError === undefined && <p className="gfa-hint">{t("loading")}</p>}
      {plugin && (
        <>
          <h3 className="gfa-section-title">{t("plugins.asks")}</h3>
          <ul className="gfa-plugin-asks">
            {asks.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="gfa-hint">{t("plugins.asks.always")}</p>
          {changes.some((change) => change.change === "added") && (
            <div className="gfa-notice" role="note">
              <p>{t("plugins.asks.new")}</p>
              <ul>
                {changes
                  .filter((change) => change.change === "added")
                  .map((change) => (
                    <li key={`${change.key} ${change.value}`}>
                      <code>{change.value}</code>
                    </li>
                  ))}
              </ul>
            </div>
          )}

          <h3 className="gfa-section-title">{t("plugins.code")}</h3>
          <p className="gfa-hint">{t("plugins.code.intro")}</p>
          <CodeReview reviews={reviews} />
          {!reviewed && (
            <p className="gfa-hint" role="status">
              {t("plugins.code.reading")}
            </p>
          )}

          {error !== undefined && (
            <ErrorMessage
              message={installProblem(t, error, plugin.release.version) ?? t("publish.error")}
              error={error}
            />
          )}
          {canInstall && (
            <div className="gfa-dialog-actions">
              <Button variant="primary" disabled={!reviewed || busy || sameRelease} onClick={() => void askInstall()}>
                {sameRelease
                  ? t("plugins.upToDate")
                  : installed
                    ? t("plugins.updateTo", { version: plugin.release.version })
                    : t("plugins.install")}
              </Button>
            </div>
          )}
        </>
      )}
      {confirming && plugin && (
        <Dialog title={t("plugins.confirmTitle", { title })} onClose={() => setConfirming(undefined)}>
          <p>{t("plugins.confirmIntro", { name, version: plugin.release.version })}</p>
          {early && installed && (
            <p className="gfa-notice" role="note">
              {t("plugins.earlyNotice", {
                version: plugin.release.version,
                days: String(RELEASE_AGE_DAYS),
                installed: installed.release,
              })}
            </p>
          )}
          <ul>
            {asks.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p>{noteSummary(t, reviews)}</p>
          {confirming.configChanged && <p className="gfa-hint">{t("plugins.confirmConfig")}</p>}
          <p className="gfa-hint">
            {pluginInstalls === "review" ? t("plugins.confirmReview") : t("plugins.confirmBuild")}
          </p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setConfirming(undefined)}>{t("action.cancel")}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void install()}>
              {busy
                ? t("publish.publishing")
                : pluginInstalls === "review"
                  ? t("plugins.submit")
                  : t("plugins.confirmInstall")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/** Packages every site has, which reviews leave out: Goodfellow's own, React and Puck. */
const KNOWN_PACKAGES = [
  "react",
  "react-dom",
  "@puckeditor/core",
  "@goodfellow-cms/core",
  "@goodfellow-cms/react",
  "@goodfellow-cms/blocks",
  "@goodfellow-cms/admin",
];

const NOTE_KINDS = ["network", "programs", "eval", "native", "install-script"] as const;

/** One sentence on what the packages read could do, for the confirmation. */
function noteSummary(t: Translate, reviews: readonly PackageReview[]): string {
  const kinds = NOTE_KINDS.filter((kind) => reviews.some((review) => (review.counts[kind] ?? 0) > 0));
  const unread = reviews.filter((review) => review.unread).length;
  const parts = [
    kinds.length > 0
      ? t("plugins.code.summary", { list: kinds.map((kind) => t(`plugins.note.${kind}`)).join("; ") })
      : t("plugins.code.nothing"),
    ...(unread > 0 ? [t("plugins.code.unreadSummary", { count: String(unread) })] : []),
  ];
  return parts.join(" ");
}

/** What each package's code could do, as the review found it. */
function CodeReview({ reviews }: { reviews: readonly PackageReview[] }) {
  const t = useStrings();
  return (
    <ul className="gfa-plugin-review">
      {reviews.map((review) => {
        const kinds = NOTE_KINDS.filter((kind) => (review.counts[kind] ?? 0) > 0);
        return (
          <li key={`${review.name}@${review.version}`}>
            <p>
              <code>
                {review.name} {review.version}
              </code>{" "}
              {review.via.length > 0 && (
                <span className="gfa-hint">{t("plugins.code.via", { via: review.via.join(" → ") })}</span>
              )}
            </p>
            {kinds.length === 0 && !review.unread && <p className="gfa-hint">{t("plugins.code.none")}</p>}
            {kinds.map((kind) => (
              <details key={kind}>
                <summary>
                  {t(`plugins.note.${kind}`)} ({review.counts[kind]})
                </summary>
                <ul>
                  {review.notes
                    .filter((note) => note.kind === kind)
                    .map((note) => (
                      <li key={`${note.file}:${note.line ?? 0}:${note.excerpt}`}>
                        <span className="gfa-hint">
                          {note.file}
                          {note.line ? `:${note.line}` : ""}
                        </span>{" "}
                        <code>{note.excerpt}</code>
                      </li>
                    ))}
                </ul>
              </details>
            ))}
            {review.unread && <p className="gfa-hint">{t(`plugins.unread.${review.unread}`)}</p>}
          </li>
        );
      })}
    </ul>
  );
}
