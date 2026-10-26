/**
 * **Add a token broker** on Site Settings' Security tab: creates the broker's
 * repository from Goodfellow's released page (`fetchBrokerRelease()`,
 * `planBroker()`) with a token the owner pastes (`Account.setup`), and turns on
 * its host's Pages where the host publishes it. The broker's address is
 * published in the config afterwards, on the same tab, once it's online.
 */
import {
  type BrokerHost,
  brokerReleaseUrl,
  type CreatedSiteRepository,
  fetchBrokerRelease,
  planBroker,
  SetupError,
  type SetupHost,
} from "@goodfellow-cms/core";
import { useMemo, useState } from "react";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { REGISTRY_VERSION } from "./registry-version.js";
import { type StringKey, useStrings } from "./strings.js";
import { Button, ErrorMessage, TextField } from "./ui.js";

/** Where the broker goes online: a host, and whether it's at a domain of the owner's. */
type Place = "gitlab-pages" | "gitlab-domain" | "github-domain" | "cloudflare-pages" | "vercel";

const PLACE_HOSTS: Record<Place, BrokerHost> = {
  "gitlab-pages": "gitlab-pages",
  "gitlab-domain": "gitlab-pages",
  "github-domain": "github-pages",
  "cloudflare-pages": "cloudflare-pages",
  vercel: "vercel",
};

/** The places a broker can go for a site kept on this host, the usual one first. */
function placesFor(host: string): Place[] {
  if (host === "GitLab") return ["gitlab-pages", "gitlab-domain", "cloudflare-pages", "vercel"];
  // Bitbucket has no Pages with domains of their own, and Cloudflare Pages doesn't build from it.
  if (host === "Bitbucket") return ["vercel"];
  return ["github-domain", "cloudflare-pages", "vercel"];
}

/** A domain of the owner's for the broker alone: never a host's shared Pages domain, or the site's own. */
function domainProblem(domain: string, siteUrl: string | undefined): StringKey | undefined {
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    return "security.add.problem.domain";
  }
  if (/(^|\.)(github|gitlab)\.io$/.test(domain)) return "security.add.problem.shared";
  try {
    if (siteUrl && new URL(siteUrl).hostname === domain) return "security.add.problem.site";
  } catch {
    // A Site address that isn't one can't be the broker's.
  }
  return undefined;
}

/** The site's repository's name, from its config's backend, for naming the broker's beside it. */
function siteRepoName(options: Record<string, unknown> | undefined): string {
  const repo = options?.repo ?? options?.project;
  return typeof repo === "string" ? (repo.split("/").at(-1) ?? "site") : "site";
}

function siteOwner(options: Record<string, unknown> | undefined): string | undefined {
  const repo = options?.repo ?? options?.project;
  return typeof repo === "string" && repo.includes("/") ? repo.slice(0, repo.lastIndexOf("/")) : undefined;
}

export interface AddedBroker {
  created: CreatedSiteRepository;
  host: BrokerHost;
  /** Its address, where it's known already: its own domain. */
  address?: string;
}

export function AddBroker({ setup, onAdded }: { setup: () => SetupHost; onAdded: (added: AddedBroker) => void }) {
  const t = useStrings();
  const { site } = useAdmin();
  const { content } = useSiteContent();
  const host = useMemo(setup, [setup]);
  const places = placesFor(host.name);
  const [place, setPlace] = useState<Place>(places[0] ?? "cloudflare-pages");
  const [domain, setDomain] = useState("");
  const [name, setName] = useState(`${siteRepoName(site.backend?.options)}-signin`);
  const [token, setToken] = useState("");
  const [problem, setProblem] = useState<StringKey>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: StringKey; error?: unknown }>();
  const withDomain = place.endsWith("-domain");

  const create = async () => {
    const wanted = withDomain ? domain.trim().toLowerCase().replace(/\.$/, "") : undefined;
    const found = wanted === undefined ? undefined : domainProblem(wanted, content.settings.url);
    if (found) {
      setProblem(found);
      return;
    }
    if (!site.backend) return;
    setBusy(true);
    setError(undefined);
    try {
      const account = await host.signInWithToken(token.trim()).catch((caught: unknown) => {
        throw { message: "security.add.error.token", error: caught };
      });
      const owners = await account.owners();
      const owner = owners.find((candidate) => candidate.path === siteOwner(site.backend?.options)) ?? owners[0];
      if (!owner) throw { message: "security.add.error.owner" };
      if (!(await account.isAvailable(owner, name.trim()))) throw { message: "security.add.error.taken" };
      const release = await fetchBrokerRelease(brokerReleaseUrl(REGISTRY_VERSION), (url) => fetch(url)).catch(
        (caught: unknown) => {
          throw { message: "security.add.error.release", error: caught };
        },
      );
      const brokerHost = PLACE_HOSTS[place];
      const files = planBroker({
        release,
        site: site.backend,
        host: brokerHost,
        ...(wanted && { domain: wanted }),
        name: content.settings.title,
      });
      const created = await account.createSite({
        owner,
        name: name.trim(),
        private: false,
        description: t("security.add.description", { site: content.settings.title }),
        pages: brokerHost === "github-pages" || brokerHost === "gitlab-pages",
        ...(wanted && { domain: wanted }),
        files,
        message: t("security.add.message"),
      });
      const address = wanted && !created.warnings.includes("domain-unavailable") ? `https://${wanted}` : undefined;
      onAdded({ created, host: brokerHost, ...(address && { address }) });
    } catch (caught) {
      if (caught instanceof SetupError) {
        setError({ message: `security.add.error.${caught.problem}` as StringKey, error: caught });
      } else if (caught && typeof caught === "object" && "message" in caught && !(caught instanceof Error)) {
        setError(caught as { message: StringKey; error?: unknown });
      } else setError({ message: "security.add.error.other", error: caught });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="gfa-form"
      onSubmit={(event) => {
        event.preventDefault();
        void create();
      }}
    >
      <fieldset className="gfa-choice-group">
        <legend className="gfa-label">{t("security.add.place")}</legend>
        {places.map((choice) => (
          <label key={choice} className="gfa-checkbox">
            <input
              type="radio"
              name="broker-place"
              checked={place === choice}
              onChange={() => {
                setPlace(choice);
                setProblem(undefined);
              }}
            />
            {t(`security.add.place.${choice}` as StringKey)}
          </label>
        ))}
        <p className="gfa-hint">{t(`security.add.placeHint.${place}` as StringKey)}</p>
      </fieldset>
      {withDomain && (
        <TextField
          label={t("security.add.domain")}
          hint={t("security.add.domainHint")}
          placeholder="signin.example.org"
          value={domain}
          error={problem ? t(problem) : undefined}
          onChange={(value) => {
            setDomain(value);
            setProblem(undefined);
          }}
        />
      )}
      <TextField
        label={t("security.add.name", { host: host.name })}
        hint={t("security.add.nameHint", { host: host.name })}
        value={name}
        onChange={setName}
      />
      <TextField
        label={t("security.add.token", { host: host.name })}
        hint={t("security.add.tokenHint", { host: host.name })}
        type="password"
        autoComplete="off"
        value={token}
        onChange={setToken}
      />
      <ul className="gfa-hint">
        {host.tokenLinks.map((link) => (
          <li key={link.url}>
            <a href={link.url} target="_blank" rel="noreferrer">
              {t(link.label as StringKey, { host: host.name })}
            </a>
          </li>
        ))}
      </ul>
      {error && <ErrorMessage message={t(error.message, { host: host.name })} error={error.error} />}
      <div>
        <Button variant="primary" type="submit" disabled={busy || !token.trim() || !name.trim()}>
          {busy ? t("security.add.creating") : t("security.add.create")}
        </Button>
      </div>
    </form>
  );
}

/** What to do once the broker's repository is made, until it's online. */
export function AddedBrokerSteps({ added }: { added: AddedBroker }) {
  const t = useStrings();
  const { created, host, address } = added;
  return (
    <div className="gfa-notice gfa-notice-success" role="status">
      <p>
        {t("security.added.project")}{" "}
        <a href={created.webUrl} target="_blank" rel="noreferrer">
          {created.repo}
        </a>
      </p>
      <p>{t(`security.added.${host}` as StringKey)}</p>
      {created.warnings.includes("domain-unavailable") && <p>{t("security.added.domainUnavailable")}</p>}
      {created.warnings.includes("pages-unavailable") && <p>{t("security.added.pagesUnavailable")}</p>}
      <p>{address ? t("security.added.address", { address }) : t("security.added.then")}</p>
    </div>
  );
}
