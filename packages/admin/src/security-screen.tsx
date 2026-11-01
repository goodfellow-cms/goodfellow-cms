/**
 * Site Settings' Security tab: the site's token broker, a sign-in page on an
 * address of its own that keeps editors' sign-in and AI keys and shows the
 * admin panel in a frame. Owners publish its address in the config's `broker`
 * line (`withBrokerConfig()`), or remove it. Below it, how editors sign in:
 * the sign-in service or OAuth application (`SignInSection`).
 */
import {
  type BrokerAddress,
  brokerAddressProblem,
  brokerOrigin,
  configAdmin,
  configBroker,
  withBrokerConfig,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useState } from "react";
import { AddBroker, type AddedBroker, AddedBrokerSteps } from "./add-broker.js";
import { CONFIG_FILE } from "./admin-address.js";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { SignInSection } from "./sign-in-settings.js";
import { useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, TextField } from "./ui.js";

/**
 * Whether editors sign in where the site's own pages could reach their
 * sign-in: at the site's address, with neither an admin address of its own nor
 * a token broker. `"server"` on a full-stack site, whose sign-in is the site's
 * own and can't move, so there's nothing to suggest.
 */
export function useSignInExposed(): "site" | "server" | undefined {
  const { outOfReach, demo, account } = useAdmin();
  if (outOfReach || demo || !account) return undefined;
  return account.role ? "server" : "site";
}

export function SecurityScreen() {
  const t = useStrings();
  const { versions, state, publish, contentOnly, demo, account, site } = useAdmin();
  const { content } = useSiteContent();
  const exposed = useSignInExposed();
  const revision = state.status === "ready" ? state.revision : undefined;
  // The config as it is now, which a publish changes before the site is rebuilt with it.
  const [config, setConfig] = useState<string | null>();
  // A broker's repository made on this tab, until its address is published.
  const [added, setAdded] = useState<AddedBroker>();

  useEffect(() => {
    if (!versions || !revision) return;
    let current = true;
    versions.readAt(CONFIG_FILE, revision).then(
      (text) => current && setConfig(text ?? null),
      () => current && setConfig(null),
    );
    return () => {
      current = false;
    };
  }, [versions, revision]);

  const save = useCallback(
    async (broker: BrokerAddress | undefined, message: string) => {
      if (!config) return;
      const next = withBrokerConfig(config, broker);
      if (next === undefined) throw new Error(`${CONFIG_FILE} has no defineConfig({ to put the broker's address in.`);
      const result = await publish([{ path: CONFIG_FILE, content: next }], message, { checks: false });
      if (!result.ok) throw result.error;
      setConfig(next);
    },
    [config, publish],
  );

  const saveConfig = useCallback(
    async (next: string, message: string) => {
      const result = await publish([{ path: CONFIG_FILE, content: next }], message, { checks: false });
      if (!result.ok) throw result.error;
      setConfig(next);
    },
    [publish],
  );

  let body: React.ReactNode;
  if (demo) body = <p>{t("security.demo")}</p>;
  else if (!versions) body = <p>{t("security.local")}</p>;
  else if (contentOnly) body = <p>{t("security.contentOnly")}</p>;
  else if (config === undefined) body = <p role="status">{t("loading")}</p>;
  else if (config === null || withBrokerConfig(config, { url: "https://broker.example.org" }) === undefined) {
    body = <p>{t("domain.admin.noConfig", { file: CONFIG_FILE })}</p>;
  } else {
    const broker = configBroker(config);
    body = broker ? (
      <BrokerState broker={broker} running={site.broker !== undefined} save={save} />
    ) : (
      <>
        {added ? (
          <AddedBrokerSteps added={added} />
        ) : (
          account?.setup &&
          site.backend && (
            <section className="gfa-form" aria-labelledby="gfa-add-broker">
              <h3 className="gfa-section-title" id="gfa-add-broker">
                {t("security.add.title")}
              </h3>
              <p>{t("security.add.intro", { host: account.hostName })}</p>
              <AddBroker setup={account.setup} onAdded={setAdded} />
            </section>
          )
        )}
        <h3 className="gfa-section-title">{t("security.broker.useTitle")}</h3>
        <BrokerForm
          key={added?.address ?? ""}
          initial={added?.address ?? ""}
          check={(url) => brokerAddressProblem({ url }, { siteUrl: content.settings.url, admin: configAdmin(config) })}
          host={account?.hostName ?? ""}
          listed={account?.redirectAddressesListed === true}
          save={save}
        />
      </>
    );
  }

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.tab.security")}</h1>
      </div>
      <section className="gfa-form" aria-labelledby="gfa-broker">
        <h2 className="gfa-section-title" id="gfa-broker">
          {t("security.broker.title")}
        </h2>
        <p>{t("security.broker.intro")}</p>
        {exposed === "site" && (
          <p className="gfa-notice" role="note">
            {t("security.exposed")}
          </p>
        )}
        {body}
      </section>
      {/* Full-stack sites sign in with the site's own sign-in. */}
      {!demo && versions && config !== undefined && account?.role === undefined && (
        <SignInSection config={config} contentOnly={contentOnly} hostName={account?.hostName ?? ""} save={saveConfig} />
      )}
    </div>
  );
}

function BrokerForm({
  initial,
  check,
  host,
  listed,
  save,
}: {
  /** The address of a broker made on this tab, where it's known. */
  initial: string;
  check: (url: string) => string | undefined;
  host: string;
  /** Whether the host's sign-in comes back only to listed addresses, which the broker's then needs to be. */
  listed: boolean;
  save: (broker: BrokerAddress | undefined, message: string) => Promise<void>;
}) {
  const t = useStrings();
  const [input, setInput] = useState(initial);
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const submit = async () => {
    const url = input.trim().replace(/\/+$/, "");
    const found = check(url);
    if (found) {
      setProblem(found);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const origin = brokerOrigin({ url }) ?? url;
      await save({ url: origin }, t("security.broker.message", { address: origin }));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="gfa-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <TextField
        label={t("security.broker.field")}
        hint={t("security.broker.fieldHint")}
        placeholder="https://broker.example.org"
        value={input}
        error={problem ? t(`security.broker.problem.${problem}` as "security.broker.problem.invalid") : undefined}
        onChange={(value) => {
          setInput(value);
          setProblem(undefined);
        }}
      />
      {listed && <p className="gfa-hint">{t("security.broker.redirect", { host })}</p>}
      {error !== undefined && <ErrorMessage message={t("security.broker.error")} error={error} />}
      <div>
        <Button variant="primary" type="submit" disabled={busy || !input.trim()}>
          {t("security.broker.use")}
        </Button>
      </div>
    </form>
  );
}

function BrokerState({
  broker,
  running,
  save,
}: {
  broker: BrokerAddress;
  /** Whether this admin panel was built with the broker, so editors already sign in there. */
  running: boolean;
  save: (broker: BrokerAddress | undefined, message: string) => Promise<void>;
}) {
  const t = useStrings();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const address = brokerOrigin(broker) ?? broker.url;

  const stop = async () => {
    setBusy(true);
    setError(undefined);
    try {
      await save(undefined, t("security.broker.stopMessage", { address }));
      setConfirming(false);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gfa-form">
      <p className="gfa-notice gfa-notice-success" role="status">
        {t(running ? "security.broker.using" : "security.broker.pending", { address })}
      </p>
      {error !== undefined && <ErrorMessage message={t("security.broker.error")} error={error} />}
      <div>
        <Button variant="ghost" onClick={() => setConfirming(true)}>
          {t("security.broker.stop")}
        </Button>
      </div>
      {confirming && (
        <Dialog title={t("security.broker.stop")} onClose={() => setConfirming(false)}>
          <p>{t("security.broker.stopBody")}</p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setConfirming(false)}>{t("action.cancel")}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void stop()}>
              {t("security.broker.stop")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
