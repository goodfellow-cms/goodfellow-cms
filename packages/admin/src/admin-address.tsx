/**
 * The Domain screen's admin address: an address of its own for the admin
 * panel, such as `admin.example.org`, which the site's pages can't reach. It
 * takes two publishes of the config's `admin` line (`withAdminConfig()`):
 * the address, which builds guard every page against and the sign-in worker
 * gives tokens to; then, once the admin panel has checked a site page at that
 * address, from that address, `checked`, from which it starts only there.
 */
import {
  type AdminAddress,
  adminOrigin,
  configAdmin,
  type DnsFetch,
  domainZone,
  normalizeDomain,
  startsWithGuard,
  withAdminConfig,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { ConnectedDomain, DomainProblem } from "./domain-screen.js";
import { useStrings } from "./strings.js";
import { Button, Dialog, TextField } from "./ui.js";

/** The config file the admin address is written in. */
export const CONFIG_FILE = "goodfellow.config.tsx";

const dnsFetch: DnsFetch = (url, init) => window.fetch(url, init);

/** What checking the admin address found. */
type AddressCheck = "ok" | "no-guard" | "no-sandbox" | "failed";

/**
 * Checks the admin address from the admin address itself, the only place
 * that can read its pages: the site's home page must start with the guard,
 * and, where the host sends headers, be sandboxed or sent away.
 */
async function checkAddress(home: string, headers: boolean): Promise<AddressCheck> {
  try {
    const response = await window.fetch(home, { cache: "no-store" });
    if (response.redirected && new URL(response.url).origin !== location.origin) return "ok";
    if (!startsWithGuard(await response.text(), "html")) return "no-guard";
    const policy = response.headers.get("content-security-policy") ?? "";
    if (headers && !/(^|[;,])\s*sandbox(\s|;|,|$)/i.test(policy)) return "no-sandbox";
    return "ok";
  } catch {
    return "failed";
  }
}

export function AdminAddressSection({ outside }: { outside: "cloudflare-pages" | "vercel" | null | undefined }) {
  const t = useStrings();
  const { pages, versions, state, publish, contentOnly, siteUrl, account } = useAdmin();
  const { content } = useSiteContent();
  const host =
    outside === "cloudflare-pages" ? "Cloudflare Pages" : outside === "vercel" ? "Vercel" : (account?.hostName ?? "");
  const revision = state.status === "ready" ? state.revision : undefined;
  // The config as it is now, which a publish changes before the site is rebuilt with it.
  const [config, setConfig] = useState<string | null>();

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
    async (admin: AdminAddress | undefined, message: string) => {
      if (config === undefined || config === null) return;
      const next = withAdminConfig(config, admin);
      if (next === undefined) throw new Error(`${CONFIG_FILE} has no defineConfig({ to put the admin address in.`);
      const result = await publish([{ path: CONFIG_FILE, content: next }], message, { checks: false });
      if (!result.ok) throw result.error;
      setConfig(next);
    },
    [config, publish],
  );

  // Hosts that serve a site on more than one domain: GitLab Pages, and Cloudflare Pages and Vercel, outside the git host.
  const supported = outside === "cloudflare-pages" || outside === "vercel" || pages?.severalDomains === true;
  let body: React.ReactNode;
  if (!versions || outside === undefined || config === undefined) body = null;
  else if (contentOnly) body = <p>{t("domain.admin.contentOnly")}</p>;
  else if (!supported) body = <p>{t("domain.admin.unsupported", { host })}</p>;
  else if (config === null || withAdminConfig(config, { url: "https://admin.example.org" }) === undefined) {
    body = <p>{t("domain.admin.noConfig", { file: CONFIG_FILE })}</p>;
  } else if (!content.settings.url) body = <p>{t("domain.admin.noSiteAddress")}</p>;
  else {
    const admin = configAdmin(config);
    body = admin ? (
      <AdminAddressState
        admin={admin}
        host={host}
        headers={outside !== null}
        onGitHost={outside === null}
        home={siteUrl}
        save={save}
      />
    ) : (
      <AdminAddressForm host={host} onGitHost={outside === null} save={save} />
    );
  }
  if (body === null) return null;

  return (
    <section className="gfa-form" aria-labelledby="gfa-admin-address">
      <h2 className="gfa-section-title" id="gfa-admin-address">
        {t("domain.admin.title")}
      </h2>
      <p>{t("domain.admin.intro")}</p>
      {body}
    </section>
  );
}

function AdminAddressForm({
  host,
  onGitHost,
  save,
}: {
  host: string;
  onGitHost: boolean;
  save: (admin: AdminAddress | undefined, message: string) => Promise<void>;
}) {
  const t = useStrings();
  const { pages } = useAdmin();
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const connect = async () => {
    const domain = normalizeDomain(input);
    if (!domain) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      // On the git host's own Pages, the host serves the site there too; elsewhere its owner adds it there.
      if (onGitHost && pages) {
        const apex = (await domainZone(domain, dnsFetch)) === domain;
        await pages.connect(domain, { apex, www: false });
      }
      await save({ url: `https://${domain}` }, t("domain.admin.message", { domain }));
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
        void connect();
      }}
    >
      <TextField
        label={t("domain.admin.field")}
        hint={t("domain.admin.fieldHint")}
        placeholder="admin.example.org"
        value={input}
        error={invalid ? t("domain.invalid") : undefined}
        onChange={(value) => {
          setInput(value);
          setInvalid(false);
        }}
      />
      {!onGitHost && <p className="gfa-hint">{t("domain.admin.elsewhere", { host })}</p>}
      {error !== undefined && <DomainProblem error={error} onRetry={() => setError(undefined)} />}
      <div>
        <Button variant="primary" type="submit" disabled={busy || !input.trim()}>
          {busy ? t("domain.connecting") : t("domain.admin.connect")}
        </Button>
      </div>
    </form>
  );
}

function AdminAddressState({
  admin,
  host,
  headers,
  onGitHost,
  home,
  save,
}: {
  admin: AdminAddress;
  host: string;
  /** Whether the host sends headers, and so sandboxes the site's pages at the admin address. */
  headers: boolean;
  onGitHost: boolean;
  /** The site's home page, from the admin panel's address. */
  home: string;
  save: (admin: AdminAddress | undefined, message: string) => Promise<void>;
}) {
  const t = useStrings();
  const { pages } = useAdmin();
  const origin = adminOrigin(admin) ?? admin.url;
  const domain = new URL(origin).host;
  const here = location.origin === origin;
  const [check, setCheck] = useState<AddressCheck>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const [confirmStop, setConfirmStop] = useState(false);

  const runCheck = useCallback(async () => {
    setCheck(undefined);
    setCheck(await checkAddress(home, headers));
  }, [home, headers]);

  useEffect(() => {
    if (here && !admin.checked) void runCheck();
  }, [here, admin.checked, runCheck]);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await action();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  const stop = () =>
    act(async () => {
      if (onGitHost && pages) await pages.disconnect(domain);
      await save(undefined, t("domain.admin.stopMessage", { domain }));
      setConfirmStop(false);
    });

  return (
    <div className="gfa-form">
      {admin.checked ? (
        <p className="gfa-notice gfa-notice-success" role="status">
          {t("domain.admin.using", { address: origin })}
        </p>
      ) : here ? (
        <>
          {check === undefined ? (
            <p role="status">{t("domain.admin.checking", { address: origin })}</p>
          ) : (
            <p role="status" className={check === "ok" ? "gfa-notice gfa-notice-success" : "gfa-notice"}>
              {t(`domain.admin.check.${check}`, { host })}
            </p>
          )}
          <div className="gfa-header-actions">
            {check === "ok" ? (
              <Button
                variant="primary"
                disabled={busy}
                onClick={() =>
                  void act(() => save({ ...admin, checked: true }, t("domain.admin.useMessage", { domain })))
                }
              >
                {t("domain.admin.use", { address: origin })}
              </Button>
            ) : (
              <Button disabled={check === undefined} onClick={() => void runCheck()}>
                {t("domain.check")}
              </Button>
            )}
          </div>
        </>
      ) : (
        <>
          <p>{t("domain.admin.pending", { address: origin })}</p>
          <p>
            <a
              className="gfa-button gfa-button-secondary"
              href={`${origin}${new URL(home, location.href).pathname}admin/#/settings/domain`}
            >
              {t("domain.admin.open", { address: origin })}
            </a>
          </p>
          <p className="gfa-hint">{t("domain.admin.signInAgain")}</p>
        </>
      )}
      {!onGitHost && !admin.checked && <p className="gfa-hint">{t("domain.admin.elsewhere", { host })}</p>}
      {error !== undefined && <DomainProblem error={error} onRetry={() => setError(undefined)} />}

      {/* The git host's own Pages: its records, the host's checks and HTTPS, as for the site's own domain. */}
      {onGitHost && !admin.checked && (
        <ConnectedDomain
          admin
          domain={domain}
          onRemoved={() => save(undefined, t("domain.admin.stopMessage", { domain }))}
        />
      )}

      {(admin.checked || !onGitHost) && (
        <div>
          <Button variant="ghost" onClick={() => setConfirmStop(true)}>
            {t("domain.admin.stop")}
          </Button>
        </div>
      )}
      {confirmStop && (
        <Dialog title={t("domain.admin.stop")} onClose={() => setConfirmStop(false)}>
          <p>{t("domain.admin.stopBody")}</p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setConfirmStop(false)}>{t("action.cancel")}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void stop()}>
              {t("domain.admin.stop")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
