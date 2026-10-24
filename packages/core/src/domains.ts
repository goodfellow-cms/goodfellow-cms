/**
 * Custom domains for sites published with their git host's own Pages: the
 * records to add at the domain's registrar, checking them, and what each
 * backend's `pages` capability does. Checks use Google Public DNS's JSON API,
 * which answers browsers (CORS) and sees what the rest of the world sees.
 */

/** A DNS record the site's owner adds at the domain's registrar. */
export interface DnsRecord {
  type: "A" | "AAAA" | "CNAME" | "TXT";
  /** The record's full name, such as `example.org` or `www.example.org`. */
  name: string;
  value: string;
  /**
   * What it's for: pointing the domain at the site, proving it's yours to the
   * host, or making `www.` go to the site too. `optional` records help but
   * aren't needed, such as IPv6 addresses.
   */
  purpose: "site" | "verification" | "www";
  optional?: boolean;
}

/** Where the git host's Pages publishes the site. */
export interface PagesSite {
  /** The site's address on the host, such as `https://name.github.io/site/`. */
  url?: string;
  /** The custom domain the host serves the site on, if one is connected. */
  domain?: string;
}

/** What the git host says about a connected domain. */
export interface PagesDomainStatus {
  /** Whether the host has checked that the domain is the owner's. Hosts that don't check say `true`. */
  verified: boolean;
  /** The HTTPS certificate: being issued once the records are in place, ready, or failed. */
  certificate: "pending" | "ready" | "failed";
  /** Whether visitors are always sent to the `https://` address. */
  httpsOnly: boolean;
  /** Whether the host sends visitors from the site's other addresses, its own included, to this domain. */
  primary: boolean;
}

export interface ConnectDomainOptions {
  /** Whether the domain is its zone's apex (`example.org`), which needs A records rather than a CNAME. */
  apex: boolean;
  /** For an apex domain, also send `www.` to the site. */
  www?: boolean;
}

/**
 * A git host's own Pages, as a backend's optional `pages` capability: what it
 * can do with a custom domain. Sites published elsewhere, such as Vercel,
 * connect their domain there.
 */
export interface PagesDomains {
  /**
   * Whether the host serves a site on more than one domain, such as an admin
   * address beside the site's own (GitLab Pages). GitHub Pages serves one,
   * and its `www.`.
   */
  severalDomains: boolean;
  /** Where Pages publishes the site, or `undefined` if Pages doesn't publish it. */
  site(): Promise<PagesSite | undefined>;
  /** Connects the domain to the site on the host, and returns the records to add at the registrar. */
  connect(domain: string, options: ConnectDomainOptions): Promise<DnsRecord[]>;
  /** The records a connected domain needs, as `connect()` returned them. */
  records(domain: string, options: ConnectDomainOptions): Promise<DnsRecord[]>;
  /** Asks the host how the domain is doing, asking it to check the records again first where it needs to. */
  status(domain: string): Promise<PagesDomainStatus>;
  /**
   * Once the certificate is ready: sends visitors to `https://`, and, unless
   * `primary` is `false`, as for an admin address, to this domain from the
   * site's other addresses, the host's own included.
   */
  secure(domain: string, options?: { primary?: boolean }): Promise<void>;
  /** Stops serving the site on the domain. */
  disconnect(domain: string): Promise<void>;
}

/** Why a domain couldn't be connected, in a form the admin panel turns into plain words. */
export type DomainProblem =
  /** The sign-in can't change the host's Pages settings (see the backend's `ownerAccess`). */
  | "not-allowed"
  /** Another site on the host already uses the domain. */
  | "taken"
  /** The host doesn't accept it as a domain. */
  | "invalid"
  /** The certificate isn't ready yet, so HTTPS can't be required. */
  | "not-ready";

export class DomainError extends Error {
  override name = "DomainError";
  constructor(
    readonly problem: DomainProblem,
    message: string,
  ) {
    super(message);
  }
}

/**
 * A domain from what someone typed, such as `https://www.Example.org/` →
 * `www.example.org`, or `undefined` if it isn't one.
 */
export function normalizeDomain(input: string): string | undefined {
  const domain = (
    input
      .trim()
      .toLowerCase()
      .replace(/^[a-z]+:\/\//, "")
      .split(/[/?#]/, 1)[0] ?? ""
  ).replace(/\.$/, "");
  const label = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  const labels = domain.split(".");
  return labels.length >= 2 && labels.every((part) => label.test(part)) && !/^\d+$/.test(labels.at(-1) ?? "")
    ? domain
    : undefined;
}

/**
 * What to type in a registrar's "Name" (or "Host") field for a record, since
 * most add the domain themselves: `@` for the domain itself, otherwise the
 * part before it, such as `www` or `_gitlab-pages-verification-code.www`.
 */
export function registrarName(record: DnsRecord, zone: string): string {
  if (record.name === zone) return "@";
  return record.name.endsWith(`.${zone}`) ? record.name.slice(0, -zone.length - 1) : record.name;
}

const TYPES = { A: 1, CNAME: 5, SOA: 6, TXT: 16, AAAA: 28 } as const;

/** The part of `fetch` that DNS lookups use, so core needs no DOM types. Pass the browser's `fetch`. */
export type DnsFetch = (
  url: string,
  init: { headers: Record<string, string>; cache: "no-store" },
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

interface DnsAnswer {
  name: string;
  type: number;
  data: string;
}

interface DnsResponse {
  Status: number;
  Answer?: DnsAnswer[];
  Authority?: DnsAnswer[];
}

/** Looks a name up with Google Public DNS. */
async function lookup(name: string, type: keyof typeof TYPES, fetcher: DnsFetch): Promise<DnsResponse> {
  const response = await fetcher(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, {
    headers: { accept: "application/dns-json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Couldn't look up ${name} (${response.status}).`);
  return (await response.json()) as DnsResponse;
}

function sameName(a: string, b: string): boolean {
  return a.replace(/\.$/, "").toLowerCase() === b.replace(/\.$/, "").toLowerCase();
}

/**
 * The zone a domain belongs to: the domain itself if it's an apex
 * (`example.org`, `example.co.uk`), otherwise the zone its registrar manages.
 */
export async function domainZone(domain: string, fetcher: DnsFetch): Promise<string> {
  const answer = await lookup(domain, "SOA", fetcher);
  if (answer.Answer?.some((record) => record.type === TYPES.SOA && sameName(record.name, domain))) return domain;
  const authority = answer.Authority?.find((record) => record.type === TYPES.SOA);
  const zone = authority?.name.replace(/\.$/, "").toLowerCase();
  if (zone && domain.endsWith(`.${zone}`)) return zone;
  // No answer that says, such as for a name that's an alias elsewhere: guess the part after the first label.
  return domain.split(".").slice(1).join(".");
}

/** How one record looks to the rest of the world. */
export interface RecordCheck {
  record: DnsRecord;
  /** In place, not there yet, or there with something else instead. */
  state: "ok" | "missing" | "wrong";
  /** What DNS answers instead, for `wrong`. */
  found: string[];
}

/**
 * Checks records as the rest of the world sees them. A and AAAA records are
 * checked together: every address answered must be one of the host's, so a
 * registrar's own "parked" address left in place counts as wrong.
 */
export async function checkRecords(records: DnsRecord[], fetcher: DnsFetch): Promise<RecordCheck[]> {
  const groups = new Map<string, DnsRecord[]>();
  for (const record of records) {
    const key = `${record.type} ${record.name}`;
    groups.set(key, [...(groups.get(key) ?? []), record]);
  }
  const checks = new Map<DnsRecord, RecordCheck>();
  await Promise.all(
    [...groups.values()].map(async (group) => {
      const first = group[0] as DnsRecord;
      const answer = await lookup(first.name, first.type, fetcher);
      const found = (answer.Answer ?? [])
        .filter((record) => record.type === TYPES[first.type] && sameName(record.name, first.name))
        .map((record) => (first.type === "TXT" ? record.data.replace(/^"|"$/g, "") : record.data.replace(/\.$/, "")));
      const expected = (value: string) => found.some((data) => data.toLowerCase() === value.toLowerCase());
      const others = found.filter((data) => !group.some((record) => record.value.toLowerCase() === data.toLowerCase()));
      for (const record of group) {
        // TXT records can sit beside others, such as for email; addresses and aliases can't.
        const state = expected(record.value)
          ? record.type === "TXT" || others.length === 0
            ? "ok"
            : "wrong"
          : found.length > 0 && record.type !== "TXT"
            ? "wrong"
            : "missing";
        checks.set(record, { record, state, found: state === "wrong" ? others : [] });
      }
    }),
  );
  return records.map((record) => checks.get(record) as RecordCheck);
}

/** Whether every record that's needed is in place. */
export function recordsInPlace(checks: RecordCheck[]): boolean {
  return checks.every((check) => check.state === "ok" || (check.record.optional && check.state === "missing"));
}
