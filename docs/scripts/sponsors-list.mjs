/**
 * Who goes in Goodfellow's Sponsors list, worked out from GitHub Sponsors with
 * no network or disk access, so it's tested on its own. `sponsors.mjs` asks
 * GitHub and writes what this gives into `.github/sponsors.json` and the
 * README; the docs site's Sponsors block shows the same file.
 *
 * The tiers (set up on GitHub Sponsors itself, which has no API for them):
 * Supporter ($5 a month) gets GitHub's badge and isn't listed; Backer ($25 a
 * month, or a one-time gift of $50 or more, for a year after it) is listed by
 * name; Organization ($100 a month) by logo; Patron ($500 a month) by a bigger
 * logo. Sponsorships their sponsors made private are never listed.
 */

/** The account people sponsor, and its page. */
export const SPONSORED = "goodfellow-cms";
export const SPONSOR_PAGE = `https://github.com/sponsors/${SPONSORED}`;

/** Where the list is kept, from the repository's root, and where browsers read it on `master`. */
export const SPONSORS_FILE = ".github/sponsors.json";
export const SPONSORS_RAW_URL = `https://raw.githubusercontent.com/goodfellow-cms/goodfellow-cms/master/${SPONSORS_FILE}`;

/** Changes to what GitHub says about someone, by their GitHub name: `name`, `url`, `logo`, or `hide`. */
export const OVERRIDES_FILE = ".github/sponsor-overrides.json";

/** The least each tier gives, in dollars a month, and the least a one-time gift lists someone for. */
export const TIERS = { patron: 500, organization: 100, backer: 25 };
export const ONE_TIME_BACKER = 50;
/** How long a one-time gift keeps someone listed. */
export const ONE_TIME_DAYS = 365;

/** The `.github/sponsors.json` file's version, for the docs site's block and anything else that reads it. */
export const SPONSORS_VERSION = 1;

const DAY = 24 * 60 * 60 * 1000;

/** The GraphQL query for a page of the account's sponsorships, past ones included, which one-time gifts are. */
export const SPONSORS_QUERY = `query Sponsors($login: String!, $after: String) {
  organization(login: $login) {
    sponsorshipsAsMaintainer(first: 100, after: $after, activeOnly: false, includePrivate: false) {
      pageInfo { hasNextPage endCursor }
      nodes {
        createdAt
        tierSelectedAt
        isActive
        isOneTimePayment
        privacyLevel
        tier { monthlyPriceInDollars isOneTime }
        sponsorEntity {
          ... on User { login name url websiteUrl avatarUrl(size: 256) }
          ... on Organization { login name url websiteUrl avatarUrl(size: 256) }
        }
      }
    }
  }
}`;

/** An empty list, as `.github/sponsors.json` starts. */
export function emptySponsors() {
  return { version: SPONSORS_VERSION, patrons: [], organizations: [], backers: [] };
}

/** A web address as people put it in their profile (`example.org` too), or nothing for anything but http(s). */
export function webAddress(value) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return undefined;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/** GitHub's own picture addresses, the only logos listed without an override. */
function githubPicture(value) {
  const url = webAddress(value);
  return url && new URL(url).hostname === "avatars.githubusercontent.com" ? url : undefined;
}

/** What a sponsorship lists someone as, or nothing, on the day `now`. */
function rankOf(sponsorship, now) {
  if (sponsorship.privacyLevel === "PRIVATE") return undefined;
  const amount = Number(sponsorship.tier?.monthlyPriceInDollars ?? 0);
  if (sponsorship.isOneTimePayment || sponsorship.tier?.isOneTime) {
    const given = Date.parse(sponsorship.tierSelectedAt ?? sponsorship.createdAt ?? "");
    const recent = Number.isFinite(given) && now - given < ONE_TIME_DAYS * DAY;
    return amount >= ONE_TIME_BACKER && recent ? "backer" : undefined;
  }
  if (!sponsorship.isActive) return undefined;
  if (amount >= TIERS.patron) return "patron";
  if (amount >= TIERS.organization) return "organization";
  if (amount >= TIERS.backer) return "backer";
  return undefined;
}

const ORDER = ["patron", "organization", "backer"];

/**
 * The list from GitHub's sponsorships (`SPONSORS_QUERY`'s nodes) on the day
 * `now`, with `overrides` applied: each sponsor once, in their highest tier,
 * those who've sponsored longest first.
 */
export function sponsorsList(sponsorships, now = Date.now(), overrides = {}) {
  const best = new Map();
  for (const sponsorship of sponsorships) {
    const sponsor = sponsorship.sponsorEntity;
    const login = typeof sponsor?.login === "string" ? sponsor.login : undefined;
    const rank = rankOf(sponsorship, now);
    if (!login || !rank) continue;
    const since = Date.parse(sponsorship.createdAt ?? "") || now;
    const known = best.get(login);
    if (!known || ORDER.indexOf(rank) < ORDER.indexOf(known.rank)) {
      best.set(login, { rank, since: Math.min(since, known?.since ?? since), sponsor });
    } else {
      known.since = Math.min(known.since, since);
    }
  }
  const list = emptySponsors();
  const sorted = [...best.entries()].sort(([a, x], [b, y]) => x.since - y.since || a.localeCompare(b));
  for (const [login, { rank, sponsor }] of sorted) {
    const override = overrides[login] ?? {};
    if (override.hide) continue;
    const name = (typeof override.name === "string" && override.name.trim()) || sponsor.name?.trim() || login;
    const url =
      webAddress(override.url) ??
      webAddress(sponsor.websiteUrl) ??
      webAddress(sponsor.url) ??
      `https://github.com/${login}`;
    if (rank === "backer") {
      list.backers.push({ login, name, url });
      continue;
    }
    const logo = webAddress(override.logo) ?? githubPicture(sponsor.avatarUrl);
    if (!logo) continue;
    list[rank === "patron" ? "patrons" : "organizations"].push({ login, name, url, logo });
  }
  return list;
}

/** Whether anyone is listed. */
export function hasSponsors(list) {
  return list.patrons.length + list.organizations.length + list.backers.length > 0;
}

/** The README's marks around the list, which `withReadmeSponsors()` writes between. */
export const README_START = "<!-- sponsors:start -->";
export const README_END = "<!-- sponsors:end -->";

const escapeHtml = (text) =>
  text.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

const escapeMarkdown = (text) => text.replace(/[\\`*_{}[\]()<>#+!|~]/g, "\\$&");

/** A logo as the README shows it: a picture `size` pixels wide, linking to the sponsor's website. */
function readmeLogo({ name, url, logo }, size) {
  const src = new URL(logo);
  if (src.hostname === "avatars.githubusercontent.com") src.searchParams.set("s", String(size * 2));
  return `<a href="${escapeHtml(url)}"><img src="${escapeHtml(src.href)}" width="${size}" height="${size}" alt="${escapeHtml(name)}"></a>`;
}

/** What goes between the README's marks: nothing until someone is listed. */
export function readmeSponsors(list) {
  if (!hasSponsors(list)) return "";
  const parts = ["### Sponsors", "", "Thank you to everyone who sponsors Goodfellow."];
  if (list.patrons.length) parts.push("", list.patrons.map((sponsor) => readmeLogo(sponsor, 128)).join(" "));
  if (list.organizations.length) parts.push("", list.organizations.map((sponsor) => readmeLogo(sponsor, 64)).join(" "));
  if (list.backers.length) {
    parts.push(
      "",
      list.backers.map(({ name, url }) => `[${escapeMarkdown(name)}](<${url.replaceAll(">", "%3E")}>)`).join(" · "),
    );
  }
  return parts.join("\n");
}

/** The README with the list between its marks, which must be there. */
export function withReadmeSponsors(readme, list) {
  const start = readme.indexOf(README_START);
  const end = readme.indexOf(README_END);
  if (start === -1 || end < start) throw new Error(`The README has no ${README_START} and ${README_END} marks.`);
  const section = readmeSponsors(list);
  return `${readme.slice(0, start + README_START.length)}\n${section ? `${section}\n` : ""}${readme.slice(end)}`;
}

/** `.github/sponsors.json`'s text: two spaces, a stable order and a newline at the end, so it only changes with the list. */
export function sponsorsFileText(list) {
  return `${JSON.stringify(list, null, 2)}\n`;
}
