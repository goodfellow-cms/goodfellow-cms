import {
  type ConnectDomainOptions,
  type DnsRecord,
  DomainError,
  GitApiError,
  type PagesDomainStatus,
  type PagesDomains,
} from "@goodfellow-cms/core";
import { type ApiOptions, gitlabJson, gitlabRequest } from "./api.js";

/** GitLab.com Pages' addresses for an apex domain, from GitLab's documentation. */
const PAGES_IPV4 = "35.185.44.232";
const PAGES_IPV6 = "2600:1901:0:7b8a::";

interface PagesResponse {
  url?: string;
  is_unique_domain_enabled?: boolean;
  force_https?: boolean;
  primary_domain?: string | null;
}

interface DomainResponse {
  domain: string;
  verified: boolean;
  verification_code?: string;
  certificate?: { expired?: boolean } | null;
}

/** The domains `connect()` adds: the domain, and `www.` for an apex domain that wants it. */
function domainsFor(domain: string, { apex, www }: ConnectDomainOptions): string[] {
  return apex && www ? [domain, `www.${domain}`] : [domain];
}

/**
 * The records GitLab Pages needs: its address for an apex domain, or an alias
 * of the namespace's gitlab.io otherwise, and a TXT record per domain that
 * proves it's the owner's, with the codes GitLab gave.
 */
export function gitlabPagesRecords(
  project: string,
  domain: string,
  options: ConnectDomainOptions,
  codes: Record<string, string>,
): DnsRecord[] {
  const target = `${(project.split("/")[0] ?? "").toLowerCase()}.gitlab.io`;
  const site: DnsRecord[] = options.apex
    ? [
        { type: "A", name: domain, value: PAGES_IPV4, purpose: "site" },
        { type: "AAAA", name: domain, value: PAGES_IPV6, purpose: "site", optional: true },
      ]
    : [{ type: "CNAME", name: domain, value: target, purpose: "site" }];
  const www: DnsRecord[] =
    options.apex && options.www
      ? [{ type: "CNAME", name: `www.${domain}`, value: target, purpose: "www", optional: true }]
      : [];
  const verification = domainsFor(domain, options).flatMap((name): DnsRecord[] => {
    const code = codes[name];
    if (!code) return [];
    const value = code.startsWith("gitlab-pages-verification-code=") ? code : `gitlab-pages-verification-code=${code}`;
    return [
      {
        type: "TXT",
        name: `_gitlab-pages-verification-code.${name}`,
        value,
        purpose: "verification",
        optional: name !== domain,
      },
    ];
  });
  return [...site, ...www, ...verification];
}

/** GitLab Pages, for a site's project: where it's published, and its custom domains. */
export function gitlabPages(api: ApiOptions, project: string): PagesDomains {
  const id = encodeURIComponent(project);
  const pagesPath = `/projects/${id}/pages`;
  const domainPath = (domain: string) => `${pagesPath}/domains/${encodeURIComponent(domain)}`;

  function notAllowed(error: unknown): never {
    if (error instanceof GitApiError && (error.status === 401 || error.status === 403)) {
      throw new DomainError("not-allowed", "Connecting a domain on GitLab needs the Maintainer role in the project.");
    }
    throw error;
  }

  async function pages(): Promise<PagesResponse | undefined> {
    const response = await gitlabRequest(api, pagesPath, { allow: [404] }).catch(notAllowed);
    return response.ok ? ((await response.json()) as PagesResponse) : undefined;
  }

  async function codes(domains: string[]): Promise<Record<string, string>> {
    const found = await Promise.all(
      domains.map(async (domain) => {
        const response = await gitlabRequest(api, domainPath(domain), { allow: [404] });
        if (!response.ok) return [domain, ""] as const;
        return [domain, ((await response.json()) as DomainResponse).verification_code ?? ""] as const;
      }),
    );
    return Object.fromEntries(found);
  }

  async function verified(domain: string): Promise<DomainResponse> {
    const found = await gitlabJson<DomainResponse>(api, domainPath(domain)).catch(notAllowed);
    if (found.verified) return found;
    // GitLab checks the TXT record now and then; asking checks it at once.
    const response = await gitlabRequest(api, `${domainPath(domain)}/verify`, {
      method: "PUT",
      allow: [400, 404, 422],
    });
    return response.ok ? ((await response.json()) as DomainResponse) : found;
  }

  return {
    severalDomains: true,
    async site() {
      const found = await pages();
      if (!found) return undefined;
      const domains = await gitlabJson<{ domain: string }[]>(api, `${pagesPath}/domains`).catch(() => []);
      const names = domains.map((entry) => entry.domain);
      const domain =
        (found.primary_domain && names.includes(found.primary_domain) ? found.primary_domain : undefined) ??
        names.sort((a, b) => a.length - b.length)[0];
      return { url: found.url, domain };
    },
    async connect(domain, options) {
      const found = await pages();
      // A custom domain serves the site from its root, so the gitlab.io address must too, or the
      // build's base path, which follows it, would be wrong. Unique domains are served from the root.
      if (found && found.is_unique_domain_enabled === false) {
        await gitlabRequest(api, pagesPath, { method: "PATCH", body: { pages_unique_domain_enabled: true } }).catch(
          notAllowed,
        );
      }
      for (const name of domainsFor(domain, options)) {
        try {
          await gitlabRequest(api, `${pagesPath}/domains`, {
            method: "POST",
            body: { domain: name, auto_ssl_enabled: true },
          });
        } catch (error) {
          if (error instanceof GitApiError && error.status === 400) {
            if (/taken/i.test(error.message)) {
              // Adding the same domain to this project again is fine; another project's is not.
              const own = await gitlabRequest(api, domainPath(name), { allow: [404] });
              if (own.ok) continue;
              throw new DomainError("taken", "Another GitLab Pages site already uses this domain.");
            }
            throw new DomainError("invalid", "GitLab Pages doesn't accept this domain.");
          }
          notAllowed(error);
        }
      }
      return gitlabPagesRecords(project, domain, options, await codes(domainsFor(domain, options)));
    },
    async records(domain, options) {
      return gitlabPagesRecords(project, domain, options, await codes(domainsFor(domain, options)));
    },
    async status(domain): Promise<PagesDomainStatus> {
      const found = await verified(domain);
      const www = await gitlabRequest(api, domainPath(`www.${domain}`), { allow: [404] });
      if (www.ok && !((await www.json()) as DomainResponse).verified) await verified(`www.${domain}`);
      const settings = await pages();
      return {
        verified: found.verified,
        certificate: found.certificate && !found.certificate.expired ? "ready" : "pending",
        httpsOnly: settings?.force_https === true,
        // GitLab before 17.8 has no primary domain, and sends nobody anywhere.
        primary: settings?.primary_domain === undefined || settings.primary_domain === domain,
      };
    },
    async secure(domain, { primary = true } = {}) {
      const found = await gitlabJson<DomainResponse>(api, domainPath(domain)).catch(notAllowed);
      if (!found.verified || !found.certificate) {
        throw new DomainError("not-ready", "The domain's certificate isn't ready yet.");
      }
      // An admin address serves the admin panel, and never takes visitors from the site's own.
      if (!primary) {
        await gitlabRequest(api, pagesPath, { method: "PATCH", body: { pages_https_only: true } }).catch(notAllowed);
        return;
      }
      // The primary domain is where GitLab sends visitors to every other address of the site, gitlab.io's included.
      try {
        await gitlabRequest(api, pagesPath, {
          method: "PATCH",
          body: { pages_https_only: true, pages_primary_domain: domain },
        });
      } catch (error) {
        // GitLab before 17.8 has no primary domain: requiring HTTPS still works.
        if (!(error instanceof GitApiError && error.status === 400)) notAllowed(error);
        await gitlabRequest(api, pagesPath, { method: "PATCH", body: { pages_https_only: true } }).catch(notAllowed);
      }
    },
    async disconnect(domain) {
      for (const name of [domain, `www.${domain}`]) {
        await gitlabRequest(api, domainPath(name), { method: "DELETE", allow: [404] }).catch(notAllowed);
      }
    },
  };
}
