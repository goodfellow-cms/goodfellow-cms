import {
  type AvailableUpdates,
  availableUpdates,
  compareReleases,
  type GitBackend,
  NPM_REGISTRY,
  parseUpdateSettings,
  releaseVersions,
  siteVersion,
  UPDATES_FILE,
  type UpdateRun,
  type UpdateSettings,
  UpdatesError,
  type UpdatesSetup,
  VERSION_PACKAGE,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { updateSettingsFileChange } from "./changes.js";
import { OwnerTokenActive, OwnerTokenForm } from "./owner-token.js";
import { SettingsTabs } from "./settings-screen.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, ErrorMessage } from "./ui.js";

/** Where each release's changes are described. */
const RELEASES_URL = "https://github.com/goodfellow-cms/goodfellow-cms/releases";
/** How often the screen checks on an update while one is running. */
const CHECK_INTERVAL = 15_000;
/** How many versions of `package.json` to look through for the release before this one. */
const HISTORY_DEPTH = 30;

const STEP_TEXT: Record<string, StringKey> = {
  build: "updates.failed.build",
  install: "updates.failed.install",
  blocks: "updates.failed.blocks",
  publish: "updates.failed.publish",
};

/** The update settings couldn't be published. */
class SaveError extends Error {
  override name = "SaveError";
  constructor(override readonly cause: unknown) {
    super("The update settings couldn't be published.");
  }
}

function formatDate(date: string | undefined): string {
  const parsed = date ? new Date(date) : undefined;
  return parsed && !Number.isNaN(parsed.getTime())
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(parsed)
    : "";
}

/** The newest release the site had before `current` that's older than it, from `package.json`'s history. */
async function previousRelease(
  versions: Pick<GitBackend, "history" | "readAt">,
  current: string,
): Promise<string | undefined> {
  const history = await versions.history("package.json", { perPage: HISTORY_DEPTH });
  for (const { revision } of history) {
    const version = siteVersion((await versions.readAt("package.json", revision)) ?? "");
    if (version && compareReleases(version, current) < 0) return version;
  }
  return undefined;
}

/** The site's Goodfellow release, the fixes and releases it can update to, and its nightly update job. */
export function UpdatesScreen() {
  const t = useStrings();
  const { updates, demo, contentOnly } = useAdmin();

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.title")}</h1>
      </div>
      <SettingsTabs tab="updates" />
      <div className="gfa-form">
        <p>{t("updates.intro")}</p>
        {demo ? (
          <p>{t("updates.demo")}</p>
        ) : contentOnly && !updates ? (
          <p>{t("updates.contentOnly")}</p>
        ) : updates ? (
          <UpdatesPanel />
        ) : (
          <p>{t("updates.local")}</p>
        )}
      </div>
    </div>
  );
}

interface Loaded {
  current?: string;
  /** The release before it, which an owner can go back to. */
  previous?: string;
  settings: UpdateSettings;
  available: AvailableUpdates;
  setup: UpdatesSetup;
  last?: UpdateRun;
  owner: boolean;
}

function UpdatesPanel() {
  const t = useStrings();
  const { updates, versions, editors, ownerAccess, account, readFile, publish } = useAdmin();
  const { revision } = useSiteContent();
  const host = account?.hostName ?? "";
  const [loaded, setLoaded] = useState<Loaded>();
  const [error, setError] = useState<unknown>();
  const [problem, setProblem] = useState<unknown>();
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!updates) return;
    try {
      // Where the code is kept apart from the content, its package.json says which release the site uses.
      const code = updates.code;
      const [packageJson, settingsText, metadata, setup, last, people] = await Promise.all([
        code ? code.read("package.json").catch(() => undefined) : versions?.readAt("package.json", revision),
        readFile(UPDATES_FILE),
        window
          .fetch(`${NPM_REGISTRY}/${VERSION_PACKAGE}`, { headers: { accept: "application/vnd.npm.install-v1+json" } })
          .then((response) => (response.ok ? response.json() : undefined))
          .catch(() => undefined),
        updates.setup(),
        updates.lastRun(),
        editors?.list().catch(() => undefined),
      ]);
      const current = packageJson ? siteVersion(packageJson) : undefined;
      const settings = parseUpdateSettings(settingsText);
      const history = code ?? versions;
      const previous = current && history ? await previousRelease(history, current).catch(() => undefined) : undefined;
      setLoaded({
        current,
        previous,
        settings,
        available: current ? availableUpdates(current, releaseVersions(metadata), settings.skip) : {},
        setup,
        last,
        // Without a list of editors, the host decides who may update when asked.
        owner: people ? people.editors.some((editor) => editor.self && editor.role === "owner") : true,
      });
      setError(undefined);
    } catch (caught) {
      setError(caught);
    }
  }, [updates, versions, editors, readFile, revision]);

  useEffect(() => {
    void load();
  }, [load]);

  // While an update runs, check on it now and then.
  const running = started || loaded?.last?.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => void load(), CHECK_INTERVAL);
    return () => clearInterval(timer);
  }, [running, load]);
  useEffect(() => {
    if (started && loaded?.last && loaded.last.state !== "running") setStarted(false);
  }, [started, loaded]);

  const act = async (run: () => Promise<void>, after?: () => void) => {
    setBusy(true);
    setProblem(undefined);
    try {
      await run();
      after?.();
    } catch (caught) {
      setProblem(caught);
    }
    await load();
    setBusy(false);
  };
  const start = (target: string) =>
    act(
      () => updates?.start(target) ?? Promise.resolve(),
      () => setStarted(true),
    );
  /**
   * Goes back to an older release. Where the code is kept apart from the
   * content, the update can't change the content's settings, so the release
   * the site leaves is skipped here, as the update does elsewhere.
   */
  const goBack = (target: string, settings: UpdateSettings, current: string) =>
    act(
      async () => {
        await updates?.start(target);
        if (!updates?.code || settings.skip.includes(current)) return;
        const result = await publish(
          [updateSettingsFileChange({ ...settings, skip: [...settings.skip, current] })],
          t("updates.back.skip", { version: current }),
        );
        if (!result.ok) throw new SaveError(result.error);
      },
      () => setStarted(true),
    );
  // The settings are content, published like any other change; publishing reloads the site, and so this screen.
  const saveSettings = (settings: Pick<UpdateSettings, "automatic" | "skip">, message: string) =>
    act(async () => {
      const result = await publish([updateSettingsFileChange(settings)], message);
      if (!result.ok) throw new SaveError(result.error);
    });

  if (!updates) return null;
  if (error) return <ErrorMessage message={t("updates.error.load")} error={error} />;
  if (!loaded) return <p role="status">{t("updates.loading")}</p>;
  const { current, previous, settings, available, setup, last, owner } = loaded;
  const needsToken = problem instanceof UpdatesError && problem.problem === "not-allowed" && ownerAccess;

  return (
    <>
      {updates.code && (
        <p>
          {t("updates.code", { place: updates.code.repo })}{" "}
          <a href={updates.code.webUrl} target="_blank" rel="noreferrer">
            {t("updates.code.link", { host })}
          </a>
        </p>
      )}
      {setup === "no-access" ? (
        <p className="gfa-notice">{t("updates.noAccess", { place: updates.code?.repo ?? "" })}</p>
      ) : (
        <p>{current ? t("updates.current", { version: current }) : t("updates.unknownVersion")}</p>
      )}
      <OwnerTokenActive onForget={() => void load()} />

      {setup === "missing" && <p className="gfa-notice">{t("updates.missing")}</p>}
      {setup === "needs-setup" && (
        <div className="gfa-notice">
          <p>{t("updates.needsSetup", { host })}</p>
          {updates.enable && (
            <Button disabled={busy} onClick={() => void act(() => updates.enable?.() ?? Promise.resolve())}>
              {t("updates.enable")}
            </Button>
          )}
        </div>
      )}

      {current && setup !== "missing" && setup !== "no-access" && (
        <>
          <h2 className="gfa-section-title">{t("updates.fixes.title")}</h2>
          <label className="gfa-checkbox">
            <input
              type="checkbox"
              checked={settings.automatic}
              disabled={busy || !owner}
              onChange={(event) =>
                void saveSettings(
                  { ...settings, automatic: event.target.checked },
                  t(event.target.checked ? "updates.automatic.turnOn" : "updates.automatic.turnOff"),
                )
              }
            />
            {t("updates.automatic.label")}
          </label>
          <p className="gfa-hint">{t(owner ? "updates.automatic.hint" : "updates.automatic.onlyOwners")}</p>
          {available.fixes ? (
            <>
              <p>
                {t(settings.automatic ? "updates.fixes.ready" : "updates.fixes.readyPaused", {
                  version: available.fixes,
                })}
              </p>
              <div>
                <Button variant="primary" disabled={busy || running} onClick={() => void start("fixes")}>
                  {t("updates.fixes.now")}
                </Button>
              </div>
            </>
          ) : (
            <p>{t("updates.fixes.none")}</p>
          )}

          {available.newer && (
            <>
              <h2 className="gfa-section-title">{t("updates.newer.title", { version: available.newer })}</h2>
              <p>
                {t("updates.newer.body")}{" "}
                <a href={RELEASES_URL} target="_blank" rel="noreferrer">
                  {t("updates.newer.whatsNew")}
                </a>
              </p>
              {owner ? (
                <div>
                  <Button disabled={busy || running} onClick={() => void start(available.newer ?? "")}>
                    {t("updates.newer.install", { version: available.newer })}
                  </Button>
                </div>
              ) : (
                <p className="gfa-hint">{t("updates.newer.onlyOwners")}</p>
              )}
            </>
          )}

          {previous && owner && (
            <>
              <h2 className="gfa-section-title">{t("updates.back.title")}</h2>
              <p>{t("updates.back.body", { current, version: previous })}</p>
              <div>
                <Button
                  disabled={busy || running}
                  onClick={() => {
                    if (window.confirm(t("updates.back.confirm", { version: previous }))) {
                      void goBack(previous, settings, current ?? "");
                    }
                  }}
                >
                  {t("updates.back.button", { version: previous })}
                </Button>
              </div>
            </>
          )}

          {settings.skip.length > 0 && (
            <>
              <h2 className="gfa-section-title">{t("updates.skipped.title")}</h2>
              <p>{t("updates.skipped.body")}</p>
              <ul className="gfa-update-skipped">
                {settings.skip.map((version) => (
                  <li key={version} className="gfa-update-skip">
                    <span>{version}</span>
                    {owner && (
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          void saveSettings(
                            { ...settings, skip: settings.skip.filter((skipped) => skipped !== version) },
                            t("updates.skipped.allowMessage", { version }),
                          )
                        }
                      >
                        {t("updates.skipped.allow", { version })}
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {needsToken && <OwnerTokenForm onReady={() => setProblem(undefined)} />}
      {problem !== undefined && !needsToken && (
        <ErrorMessage
          message={t(
            problem instanceof UpdatesError
              ? `updates.error.${problem.problem}`
              : problem instanceof SaveError
                ? "updates.error.save"
                : "updates.error.other",
            { host },
          )}
          error={problem}
        />
      )}
      {started && last?.state !== "running" && <p role="status">{t("updates.started")}</p>}

      <h2 className="gfa-section-title">{t("updates.last.title")}</h2>
      <LastRun run={last} />
    </>
  );
}

function LastRun({ run }: { run?: UpdateRun }) {
  const t = useStrings();
  const { account } = useAdmin();
  const host = account?.hostName ?? "";
  if (!run) return <p>{t("updates.last.none")}</p>;
  const date = formatDate(run.date);
  const result = run.result;
  let message: string;
  if (run.state === "running") message = t("updates.last.running");
  else if (run.state === "updated") {
    message = result?.to
      ? t(result.rollback ? "updates.last.wentBack" : "updates.last.updated", { date, version: result.to })
      : t("updates.last.updatedSome", { date });
  } else if (run.state === "up-to-date") {
    message = t(result?.paused ? "updates.last.paused" : "updates.last.upToDate", { date });
  } else if (run.state === "failed") {
    const why = result?.step && STEP_TEXT[result.step];
    message = `${t("updates.last.failed", { date })}${why ? ` ${t(why, { version: result?.to ?? "" })}` : ""}`;
  } else message = t("updates.last.unknown", { date });
  const kept = result?.kept ?? [];
  const cause = result?.cause;

  return (
    <div className="gfa-form">
      <p role={run.state === "running" ? "status" : undefined}>{message}</p>
      {cause && (
        <details className="gfa-details">
          <summary>{t("details.show")}</summary>
          <pre>{[cause.file, cause.message].filter(Boolean).join("\n")}</pre>
        </details>
      )}
      {kept.length > 0 && (
        <>
          <p className="gfa-hint">{t("updates.kept")}</p>
          <ul>
            {kept.map((file) => (
              <li key={file}>
                <code>{file}</code>
              </li>
            ))}
          </ul>
        </>
      )}
      {run.detailsUrl && (
        <p>
          <a href={run.detailsUrl} target="_blank" rel="noreferrer">
            {t("updates.last.details", { host })}
          </a>
        </p>
      )}
    </div>
  );
}
