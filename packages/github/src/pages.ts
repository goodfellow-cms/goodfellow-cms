import {
  type ConnectDomainOptions,
  type DnsRecord,
  DomainError,
  GitApiError,
  type PagesDomainStatus,
  type PagesDomains,
} from "@goodfellow-cms/core";
import { type ApiOptions, githubJson, githubRequest } from "./api.js";

/** GitHub Pages' addresses for an apex domain, from GitHub's documentation. */
const PAGES_IPV4 = ["185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"];
const PAGES_IPV6 = ["2606:50c0:8000::153", "2606:50c0:8001::153", "2606:50c0:8002::153", "2606:50c0:8003::153"];

/** Certificate states in which GitHub serves the domain over HTTPS. */
const READY = new Set(["approved", "issued", "uploaded"]);
const FAILED = new Set(["errored", "bad_authz", "authorization_revoked"]);

interface PagesResponse {
  html_url?: string;
  cname?: string | null;
  https_enforced?: boolean;
  https_certificate?: { state?: string } | null;
}

/** The records GitHub Pages needs: its addresses for an apex domain, or an alias of the owner's github.io. */
export function githubPagesRecords(repo: string, domain: string, { apex, www }: ConnectDomainOptions): DnsRecord[] {
  const target = `${(repo.split("/")[0] ?? "").toLowerCase()}.github.io`;
  if (!apex) return [{ type: "CNAME", name: domain, value: target, purpose: "site" }];
  return [
    ...PAGES_IPV4.map((value): DnsRecord => ({ type: "A", name: domain, value, purpose: "site" })),
    ...PAGES_IPV6.map((value): DnsRecord => ({ type: "AAAA", name: domain, value, purpose: "site", optional: true })),
    // GitHub sends www. to the domain itself once it points at Pages too.
    ...(www ? [{ type: "CNAME", name: `www.${domain}`, value: target, purpose: "www", optional: true } as const] : []),
  ];
}

/**
 * GitHub Pages, for a site's repository: where it's published, and its custom
 * domain. `api` gives the owner token when one is in use (see `ownerAccess`).
 */
export function githubPages(api: () => ApiOptions, repo: string): PagesDomains {
  const path = `/repos/${repo}/pages`;

  async function pages(): Promise<PagesResponse | undefined> {
    const response = await githubRequest(api(), path, { allow: [404] });
    return response.status === 404 ? undefined : ((await response.json()) as PagesResponse);
  }

  async function update(body: Record<string, unknown>): Promise<void> {
    try {
      await githubRequest(api(), path, { method: "PUT", body });
    } catch (error) {
      if (error instanceof GitApiError && (error.status === 403 || error.status === 404)) {
        throw new DomainError("not-allowed", "This sign-in can't change the site's GitHub Pages settings.");
      }
      if (error instanceof GitApiError && (error.status === 400 || error.status === 422)) {
        if (/taken|already/i.test(error.message)) {
          throw new DomainError("taken", "Another GitHub Pages site already uses this domain.");
        }
        if ("https_enforced" in body) throw new DomainError("not-ready", "The domain's certificate isn't ready yet.");
        throw new DomainError("invalid", "GitHub Pages doesn't accept this domain.");
      }
      throw error;
    }
  }

  /**
   * GitHub's Pages settings change the site's one domain whatever it's called, so securing or removing one goes ahead
   * only while it's still the domain named, which is what the person approved. GitHub has no conditional write, so a
   * change made between this read and the write still wins: a moment's window, where before it was the whole question.
   */
  async function mustBeTheDomain(domain: string): Promise<void> {
    const found = await pages();
    if ((found?.cname ?? undefined) !== domain) {
      throw new DomainError("changed", "The site's domain isn't the one named any more.");
    }
  }

  return {
    // GitHub Pages serves a site on one domain, and its www., so it can't have an admin address.
    severalDomains: false,
    async site() {
      const found = await pages();
      return found && { url: found.html_url, domain: found.cname ?? undefined };
    },
    async connect(domain, options) {
      await update({ cname: domain });
      return githubPagesRecords(repo, domain, options);
    },
    async records(domain, options) {
      return githubPagesRecords(repo, domain, options);
    },
    async status(domain): Promise<PagesDomainStatus> {
      const found = await githubJson<PagesResponse>(api(), path);
      const state = found.https_certificate?.state ?? "";
      return {
        // GitHub doesn't ask to verify a site's domain; owners can verify theirs in their account's settings.
        verified: true,
        certificate: READY.has(state) ? "ready" : FAILED.has(state) ? "failed" : "pending",
        httpsOnly: found.https_enforced === true,
        // GitHub sends the github.io address to the custom domain as soon as it's set.
        primary: found.cname === domain,
      };
    },
    async secure(domain) {
      await mustBeTheDomain(domain);
      // GitHub already sends the github.io address to the custom domain.
      await update({ https_enforced: true });
    },
    async disconnect(domain) {
      await mustBeTheDomain(domain);
      await update({ cname: null });
    },
  };
}
