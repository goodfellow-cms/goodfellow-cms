/**
 * Site Settings' Visit counts screen: counting visits with Plausible, Umami or
 * GoatCounter, without cookies. It publishes `content/site.json`'s `stats`
 * (`readStatsCode()` reads what the owner pastes) and links to the service's
 * dashboard, in a tab of its own, since the counts are kept there.
 */
import {
  readStatsCode,
  STATS_SERVICES,
  type StatsService,
  type StatsSettings,
  statsDashboard,
  statsElements,
} from "@goodfellow-cms/core";
import { useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { siteSettingsFileChange } from "./changes.js";
import { type Failure, PublishFailure } from "./publish-failure.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, Dialog, Field, TextField } from "./ui.js";

/** The services' names, which are theirs in every language. */
const SERVICE_NAMES: Record<StatsService, string> = {
  plausible: "Plausible",
  umami: "Umami",
  goatcounter: "GoatCounter",
};

const PASTE_HINTS: Record<StatsService, StringKey> = {
  plausible: "stats.paste.plausible",
  umami: "stats.paste.umami",
  goatcounter: "stats.paste.goatcounter",
};

/** Publishes the visit counts' settings, or none, as one change to `content/site.json`. */
function usePublishStats() {
  const { publish } = useAdmin();
  const { content } = useSiteContent();
  return async (stats: StatsSettings | undefined, message: string) => {
    const { stats: _old, ...settings } = content.settings;
    return publish([siteSettingsFileChange(stats ? { ...settings, stats } : settings)], message, { checks: false });
  };
}

export function StatsScreen() {
  const t = useStrings();
  const { content } = useSiteContent();
  const stats = content.settings.stats;
  const [changing, setChanging] = useState(false);

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.tab.stats")}</h1>
      </div>
      <p>{t("stats.intro")}</p>
      {stats && !changing ? (
        <StatsState stats={stats} onChange={() => setChanging(true)} />
      ) : (
        <StatsForm initial={stats} onDone={() => setChanging(false)} />
      )}
    </div>
  );
}

/** How visits are counted now, with the service's dashboard. */
function StatsState({ stats, onChange }: { stats: StatsSettings; onChange: () => void }) {
  const t = useStrings();
  const { content } = useSiteContent();
  const publishStats = usePublishStats();
  const [stopping, setStopping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);
  const dashboard = statsDashboard(stats);
  const asks = content.settings.consent !== undefined;

  const run = async (next: StatsSettings | undefined, message: string) => {
    setBusy(true);
    setFailure(null);
    const result = await publishStats(next, message);
    setBusy(false);
    if (!result.ok) setFailure(result);
    return result.ok;
  };

  return (
    <section className="gfa-form" aria-labelledby="gfa-stats-state">
      <h2 className="gfa-section-title" id="gfa-stats-state">
        {t("stats.state.title")}
      </h2>
      <p>{t("stats.state.counting", { service: SERVICE_NAMES[stats.service] })}</p>
      {dashboard && (
        <p>
          <a className="gfa-button gfa-button-primary" href={dashboard} target="_blank" rel="noopener noreferrer">
            {t("stats.dashboard", { service: SERVICE_NAMES[stats.service] })}
          </a>
        </p>
      )}
      <label className="gfa-checkbox">
        <input
          type="checkbox"
          checked={stats.purpose !== "needed"}
          disabled={busy}
          onChange={(event) => {
            const { purpose: _old, ...rest } = stats;
            void run(
              event.target.checked ? rest : { ...rest, purpose: "needed" },
              t(event.target.checked ? "stats.consent.onMessage" : "stats.consent.offMessage"),
            );
          }}
        />
        {t("stats.consent.label")}
      </label>
      <p className="gfa-hint">{t(asks ? "stats.consent.hint" : "stats.consent.notAsking")}</p>
      <PublishFailure failure={failure} />
      <div className="gfa-dialog-actions">
        <Button onClick={onChange} disabled={busy}>
          {t("stats.change")}
        </Button>
        <Button variant="danger" onClick={() => setStopping(true)} disabled={busy}>
          {t("stats.stop")}
        </Button>
      </div>
      {stopping && (
        <Dialog title={t("stats.stop.title")} onClose={() => setStopping(false)}>
          <p>{t("stats.stop.body", { service: SERVICE_NAMES[stats.service] })}</p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setStopping(false)}>{t("action.cancel")}</Button>
            <Button
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (await run(undefined, t("stats.stop.message"))) setStopping(false);
              }}
            >
              {t("stats.stop")}
            </Button>
          </div>
        </Dialog>
      )}
    </section>
  );
}

/** Chooses a service and reads its code, then publishes it. */
function StatsForm({ initial, onDone }: { initial?: StatsSettings; onDone: () => void }) {
  const t = useStrings();
  const publishStats = usePublishStats();
  const [service, setService] = useState<StatsService>(initial?.service ?? "plausible");
  const [code, setCode] = useState("");
  const [domain, setDomain] = useState(initial?.service === "plausible" ? initial.domain : "");
  const [consent, setConsent] = useState(initial?.purpose !== "needed");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Failure>(null);

  const read = readStatsCode(service, code);
  // Plausible's site scripts don't say the domain, which its dashboard is named by.
  const settings: StatsSettings | undefined =
    read?.service === "plausible" ? { ...read, domain: domain.trim() || read.domain } : read;
  const usable = settings && statsElements(settings).length > 0 ? settings : undefined;
  const needsDomain = read?.service === "plausible" && !read.domain;
  const problem = code.trim() && !usable && !(needsDomain && !domain.trim()) ? t("stats.unreadable") : undefined;

  const save = async () => {
    if (!usable) return;
    setBusy(true);
    setFailure(null);
    const result = await publishStats(
      consent ? usable : { ...usable, purpose: "needed" },
      t("stats.message", { service: SERVICE_NAMES[usable.service] }),
    );
    setBusy(false);
    if (result.ok) onDone();
    else setFailure(result);
  };

  return (
    <form
      className="gfa-form"
      aria-labelledby="gfa-stats-form"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h2 className="gfa-section-title" id="gfa-stats-form">
        {t("stats.form.title")}
      </h2>
      <fieldset className="gfa-choice-group">
        <legend className="gfa-label">{t("stats.service")}</legend>
        {STATS_SERVICES.map((name) => (
          <label className="gfa-checkbox" key={name}>
            <input
              type="radio"
              name="stats-service"
              checked={service === name}
              onChange={() => {
                setService(name);
                setCode("");
              }}
            />
            {SERVICE_NAMES[name]}
          </label>
        ))}
      </fieldset>
      <Field label={t("stats.paste")} hint={t(PASTE_HINTS[service])} error={problem}>
        {(props) => (
          <textarea
            {...props}
            className="gfa-input gfa-code"
            rows={4}
            spellCheck={false}
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        )}
      </Field>
      {service === "plausible" && (needsDomain || initial?.service === "plausible") && (
        <TextField
          label={t("stats.domain")}
          hint={t("stats.domainHint")}
          placeholder="example.org"
          value={domain}
          onChange={setDomain}
        />
      )}
      <label className="gfa-checkbox">
        <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
        {t("stats.consent.label")}
      </label>
      <p className="gfa-hint">{t("stats.consent.hint")}</p>
      <PublishFailure failure={failure} />
      <div className="gfa-dialog-actions">
        {initial && (
          <Button onClick={onDone} disabled={busy}>
            {t("action.cancel")}
          </Button>
        )}
        <Button type="submit" variant="primary" disabled={!usable || busy}>
          {busy ? t("publish.publishing") : t("stats.publish")}
        </Button>
      </div>
    </form>
  );
}
