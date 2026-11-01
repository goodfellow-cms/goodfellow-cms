import {
  checkRecords,
  type DnsFetch,
  type DnsRecord,
  DomainError,
  domainZone,
  normalizeDomain,
  type PagesDomainStatus,
  type PagesSite,
  type RecordCheck,
  recordsInPlace,
  registrarName,
} from "@goodfellow-cms/core";
import { useCallback, useEffect, useState } from "react";
import { AdminAddressSection } from "./admin-address.js";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { siteSettingsFileChange } from "./changes.js";
import { OwnerTokenActive, OwnerTokenForm } from "./owner-token.js";
import { useOutsideHost } from "./site-host.js";
import { useStrings } from "./strings.js";
import { Button, Dialog, ErrorMessage, TextField } from "./ui.js";

/** How often the screen checks again on its own while the domain isn't working yet. */
const CHECK_INTERVAL = 30_000;

/** Registrars' own help on adding DNS records. Their names aren't translated. */
const REGISTRAR_GUIDES = [
  { name: "Cloudflare", url: "https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/" },
  { name: "GoDaddy", url: "https://www.godaddy.com/help/add-an-a-record-19238" },
  {
    name: "Namecheap",
    url: "https://www.namecheap.com/support/knowledgebase/article.aspx/319/2237/how-can-i-set-up-an-a-address-record-for-my-domain/",
  },
  { name: "Porkbun", url: "https://kb.porkbun.com/article/231-how-to-add-dns-records-on-porkbun" },
  { name: "Squarespace", url: "https://support.squarespace.com/hc/en-us/articles/360002101888" },
];

const dnsFetch: DnsFetch = (url, init) => window.fetch(url, init);

/** Whether the site answers at an address. Browsers don't let pages read other sites' answers, but they say whether one came. */
async function answers(address: string): Promise<boolean> {
  try {
    await window.fetch(address, { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

interface Progress {
  zone: string;
  records: DnsRecord[];
  checks?: RecordCheck[];
  host?: PagesDomainStatus;
  reachable?: boolean;
  checkFailed?: boolean;
}

/** Connects a custom domain to a site published with its git host's own Pages, and follows it until it works. */
export function DomainScreen() {
  const t = useStrings();
  const { pages, account, demo, publish, site: about } = useAdmin();
  const { content } = useSiteContent();
  const host = account?.hostName ?? "";
  const outside = useOutsideHost();
  const [site, setSite] = useState<PagesSite | null>();
  const [error, setError] = useState<unknown>();

  const loadSite = useCallback(() => {
    if (!pages) return;
    setError(undefined);
    pages.site().then((found) => setSite(found ?? null), setError);
  }, [pages]);

  useEffect(() => loadSite(), [loadSite]);

  const saveAddress = useCallback(
    async (url: string | undefined, message: string) => {
      const result = await publish([siteSettingsFileChange({ ...content.settings, url })], message, { checks: false });
      if (!result.ok) throw result.error;
    },
    [publish, content.settings],
  );

  let body: React.ReactNode;
  if (demo) body = <p>{t("domain.demo")}</p>;
  else if (!pages) body = <p>{t("domain.local")}</p>;
  else if (error) body = <DomainProblem error={error} onRetry={loadSite} />;
  else if (site === undefined) body = <p role="status">{t("domain.loading")}</p>;
  else if (site === null) {
    body = (
      <>
        <p>{t("domain.elsewhere", { host })}</p>
        {/* Only the host the site's setup files name, or every one where they name none. */}
        {(!outside || outside === "cloudflare-pages") && <p>{t("domain.elsewhere.cloudflare")}</p>}
        {(!outside || outside === "netlify") && <p>{t("domain.elsewhere.netlify")}</p>}
        {(!outside || outside === "vercel") && <p>{t("domain.elsewhere.vercel")}</p>}
        {!outside && <p>{t("domain.elsewhere.other")}</p>}
      </>
    );
  } else if (site.domain) {
    body = (
      <ConnectedDomain
        domain={site.domain}
        onRemoved={async () => {
          const after = await pages.site();
          await saveAddress(after?.url?.replace(/\/$/, ""), t("domain.removeMessage", { domain: site.domain ?? "" }));
          setSite(after ?? null);
        }}
      />
    );
  } else {
    body = (
      <ConnectForm
        current={site.url}
        onConnected={async (domain) => {
          await saveAddress(`https://${domain}`, t("domain.message", { domain }));
          setSite({ ...site, domain });
        }}
      />
    );
  }

  return (
    <div className="gfa-screen">
      <div className="gfa-screen-header">
        <h1>{t("settings.tab.domain")}</h1>
      </div>
      <div className="gfa-form">
        <p>{t("domain.intro")}</p>
        {about.copy?.url && <p className="gfa-hint">{t("domain.copy", { address: about.copy.url })}</p>}
        <OwnerTokenActive onForget={loadSite} />
        {body}
        {!demo && (pages || outside) && <AdminAddressSection outside={outside} />}
      </div>
    </div>
  );
}

/** Explains a problem with the domain; where an owner token would let it work, asks for one, then calls `onRetry`. */
export function DomainProblem({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useStrings();
  const { ownerAccess, account } = useAdmin();
  const host = account?.hostName ?? "";
  if (!(error instanceof DomainError)) return <ErrorMessage message={t("domain.error.other")} error={error} />;
  if (error.problem === "not-allowed" && ownerAccess && !ownerAccess.active) {
    return <OwnerTokenForm onReady={onRetry} />;
  }
  return <ErrorMessage message={t(`domain.error.${error.problem}`, { host })} />;
}

function ConnectForm({ current, onConnected }: { current?: string; onConnected: (domain: string) => Promise<void> }) {
  const t = useStrings();
  const { pages } = useAdmin();
  const [input, setInput] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();

  const connect = async () => {
    const domain = normalizeDomain(input);
    if (!domain || !pages) {
      setInvalid(true);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const apex = (await domainZone(domain, dnsFetch)) === domain;
      await pages.connect(domain, { apex, www: apex });
      await onConnected(domain);
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
      {current && <p>{t("domain.current", { address: current })}</p>}
      <TextField
        label={t("domain.field")}
        hint={t("domain.fieldHint")}
        placeholder="example.org"
        value={input}
        error={invalid ? t("domain.invalid") : undefined}
        onChange={(value) => {
          setInput(value);
          setInvalid(false);
        }}
      />
      <p className="gfa-hint">{t("domain.warning")}</p>
      {error !== undefined && <DomainProblem error={error} onRetry={() => setError(undefined)} />}
      <div>
        <Button variant="primary" type="submit" disabled={busy || !input.trim()}>
          {busy ? t("domain.connecting") : t("domain.connect")}
        </Button>
      </div>
    </form>
  );
}

/**
 * A connected domain's records, what the host says about it, and whether the
 * site answers there, until it works. An `admin` domain is the admin panel's
 * address: it gets HTTPS but never takes visitors from the site's own address.
 */
export function ConnectedDomain({
  domain,
  onRemoved,
  admin = false,
}: {
  domain: string;
  onRemoved: () => Promise<void>;
  admin?: boolean;
}) {
  const t = useStrings();
  const { pages, account } = useAdmin();
  const host = account?.hostName ?? "";
  const address = `https://${domain}`;
  const [progress, setProgress] = useState<Progress>();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>();
  const [removing, setRemoving] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);

  const check = useCallback(async () => {
    if (!pages) return;
    setChecking(true);
    try {
      const zone = await domainZone(domain, dnsFetch);
      const apex = zone === domain;
      const records = await pages.records(domain, { apex, www: apex });
      setProgress((previous) => ({ ...previous, zone, records }));
      const [checks, hostStatus, reachable] = await Promise.all([
        checkRecords(records, dnsFetch),
        pages.status(domain),
        answers(`${address}/`),
      ]);
      setProgress({ zone, records, checks, host: hostStatus, reachable });
    } catch (caught) {
      if (caught instanceof DomainError) setError(caught);
      else setProgress((previous) => previous && { ...previous, checkFailed: true });
    } finally {
      setChecking(false);
    }
  }, [pages, domain, address]);

  const working =
    progress?.checks !== undefined &&
    recordsInPlace(progress.checks) &&
    progress.host?.certificate === "ready" &&
    progress.reachable === true;
  const done = working && progress?.host?.httpsOnly === true && (admin || progress.host.primary);

  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    if (done) return;
    const timer = setInterval(() => void check(), CHECK_INTERVAL);
    return () => clearInterval(timer);
  }, [check, done]);

  const secure = async () => {
    if (!pages) return;
    setError(undefined);
    try {
      await pages.secure(domain, { primary: !admin });
      await check();
    } catch (caught) {
      setError(caught);
    }
  };

  const remove = async () => {
    if (!pages) return;
    setRemoving(true);
    try {
      await pages.disconnect(domain);
      await onRemoved();
    } catch (caught) {
      setError(caught);
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  const hostState = !progress?.host
    ? undefined
    : !progress.host.verified
      ? t("domain.host.unverified", { host })
      : t(`domain.host.${progress.host.certificate}`, { host });

  return (
    <div className="gfa-form">
      <p>
        <strong>{t(admin ? "domain.admin.connected" : "domain.connected", { domain })}</strong>
      </p>
      {account?.redirectAddressesListed && (
        <p className="gfa-notice">{t("domain.signIn", { host, address: `${address}/admin/` })}</p>
      )}
      {done && (
        <p className="gfa-notice gfa-notice-success" role="status">
          {t(admin ? "domain.admin.ready" : "domain.done", { address })}
        </p>
      )}
      {error !== undefined && (
        <DomainProblem
          error={error}
          onRetry={() => {
            setError(undefined);
            void check();
          }}
        />
      )}

      <h2 className="gfa-section-title">{t("domain.records.title")}</h2>
      <p className="gfa-hint">{t("domain.records.hint")}</p>
      {progress && (
        <table className="gfa-table gfa-records">
          <thead>
            <tr>
              <th>{t("domain.records.type")}</th>
              <th>{t("domain.records.name")}</th>
              <th>{t("domain.records.value")}</th>
              <th>{t("domain.records.state")}</th>
            </tr>
          </thead>
          <tbody>
            {progress.records.map((record, index) => {
              const found = progress.checks?.[index];
              return (
                <tr key={`${record.type} ${record.name} ${record.value}`}>
                  <td>{record.type}</td>
                  <td>
                    <code>{registrarName(record, progress.zone)}</code>
                  </td>
                  <td>
                    <code className="gfa-record-value">{record.value}</code>
                    <div className="gfa-hint">
                      {t(`domain.purpose.${record.purpose}`, { host })}
                      {record.optional && ` (${t("domain.records.optional")})`}
                    </div>
                  </td>
                  <td>
                    {found &&
                      (found.state === "wrong"
                        ? t("domain.records.wrong", { found: found.found.join(", ") })
                        : t(`domain.records.${found.state}`))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      <p className="gfa-hint">
        {t("domain.guides")}{" "}
        {REGISTRAR_GUIDES.map((guide, index) => (
          <span key={guide.name}>
            {index > 0 && ", "}
            <a href={guide.url} target="_blank" rel="noreferrer">
              {guide.name}
            </a>
          </span>
        ))}
        . {t("domain.cloudflare", { host })}
      </p>

      <h2 className="gfa-section-title">{t("domain.host.title", { host })}</h2>
      {hostState && <p>{hostState}</p>}

      <h2 className="gfa-section-title">{t("domain.site.title", { address })}</h2>
      {progress?.reachable !== undefined && (
        <p>{progress.reachable ? t("domain.site.ok") : t("domain.site.waiting")}</p>
      )}
      {progress?.checkFailed && <p className="gfa-hint">{t("domain.checkFailed")}</p>}

      {working && !done && (
        <div>
          <Button variant="primary" onClick={() => void secure()}>
            {t("domain.secure", { address })}
          </Button>
          {!admin && <p className="gfa-hint">{t("domain.secureHint")}</p>}
        </div>
      )}
      <div className="gfa-header-actions">
        <Button disabled={checking} onClick={() => void check()}>
          {checking ? t("domain.checking") : t("domain.check")}
        </Button>
        <Button variant="ghost" onClick={() => setConfirmRemove(true)}>
          {t("domain.remove")}
        </Button>
      </div>
      {confirmRemove && (
        <Dialog title={t("domain.removeTitle", { domain })} onClose={() => setConfirmRemove(false)}>
          <p>{t("domain.removeBody", { host })}</p>
          <div className="gfa-dialog-actions">
            <Button onClick={() => setConfirmRemove(false)}>{t("action.cancel")}</Button>
            <Button variant="danger" disabled={removing} onClick={() => void remove()}>
              {t("domain.remove")}
            </Button>
          </div>
        </Dialog>
      )}
    </div>
  );
}
