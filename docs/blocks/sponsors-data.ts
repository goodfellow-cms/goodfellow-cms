import { SPONSORS_RAW_URL, SPONSORS_VERSION } from "../scripts/sponsors-list.mjs";

/** A sponsor shown by name. */
export interface NamedSponsor {
  name: string;
  url: string;
}

/** A sponsor shown by logo. */
export interface LogoSponsor extends NamedSponsor {
  logo: string;
}

/** `.github/sponsors.json`, as `sponsorsList()` writes it. */
export interface SponsorsFile {
  patrons: LogoSponsor[];
  organizations: LogoSponsor[];
  backers: NamedSponsor[];
}

const address = (value: unknown, secureOnly = false): string | undefined => {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || (!secureOnly && url.protocol === "http:")) return url.href;
  } catch {}
  return undefined;
};

const named = (value: unknown): NamedSponsor | undefined => {
  const item = value as Record<string, unknown> | null;
  const name = typeof item?.name === "string" ? item.name.trim() : "";
  const url = address(item?.url);
  return name && url ? { name, url } : undefined;
};

const withLogo = (value: unknown): LogoSponsor | undefined => {
  const sponsor = named(value);
  const logo = address((value as Record<string, unknown> | null)?.logo, true);
  return sponsor && logo ? { ...sponsor, logo } : undefined;
};

const listOf = <T>(value: unknown, read: (item: unknown) => T | undefined): T[] =>
  Array.isArray(value) ? value.map(read).filter((item): item is T => item !== undefined) : [];

/**
 * The list from `.github/sponsors.json` as the page can show it: only names,
 * web addresses and `https://` logos, whatever the file holds. A file of
 * another version shows nobody.
 */
export function cleanSponsors(value: unknown): SponsorsFile {
  const file = value as Record<string, unknown> | null;
  if (file?.version !== SPONSORS_VERSION) return { patrons: [], organizations: [], backers: [] };
  return {
    patrons: listOf(file.patrons, withLogo),
    organizations: listOf(file.organizations, withLogo),
    backers: listOf(file.backers, named),
  };
}

/** Whether anyone is listed. */
export function anySponsors(list: SponsorsFile): boolean {
  return list.patrons.length + list.organizations.length + list.backers.length > 0;
}

/** Classes the block and its script both give what they draw, written out whole so Tailwind finds them. */
export const SPONSOR_CLASSES = {
  logos: "flex flex-wrap items-center justify-center gap-6",
  patron: "size-32 rounded-lg",
  organization: "size-16 rounded-lg",
  backers: "flex flex-wrap justify-center gap-x-4 gap-y-1 text-muted-foreground",
  link: "underline-offset-2 hover:underline",
};

/** The attribute the list's element carries, holding the list it shows, which the script compares with the live one. */
export const SPONSORS_ATTRIBUTE = "data-gf-sponsors";

/**
 * The script that brings the list up to date from `master` as the page
 * loads, so a new sponsor shows within minutes, without a release. It draws
 * only what `cleanSponsors()` would keep, with the DOM's own methods, and
 * shows the section once anyone is listed.
 */
export function sponsorsScript(): string {
  const settings = JSON.stringify({ url: SPONSORS_RAW_URL, version: SPONSORS_VERSION, classes: SPONSOR_CLASSES });
  return `(()=>{const s=${settings.replaceAll("<", "\\u003c")};const section=document.currentScript&&document.currentScript.previousElementSibling;if(!section||!section.hasAttribute("${SPONSORS_ATTRIBUTE}"))return;const web=(v,secure)=>{if(typeof v!=="string")return;try{const u=new URL(v);if(u.protocol==="https:"||(!secure&&u.protocol==="http:"))return u.href}catch{}};const named=(v)=>{const name=v&&typeof v.name==="string"?v.name.trim():"";const url=web(v&&v.url);return name&&url?{name,url}:undefined};const logo=(v)=>{const n=named(v);const l=web(v&&v.logo,true);return n&&l?{...n,logo:l}:undefined};const list=(v,read)=>Array.isArray(v)?v.map(read).filter(Boolean):[];fetch(s.url,{cache:"no-cache"}).then((r)=>r.ok?r.json():undefined).then((file)=>{if(!file||file.version!==s.version)return;const data={patrons:list(file.patrons,logo),organizations:list(file.organizations,logo),backers:list(file.backers,named)};const text=JSON.stringify(data);if(text===section.getAttribute("${SPONSORS_ATTRIBUTE}"))return;const body=section.querySelector("[data-gf-sponsors-list]");if(!body)return;const link=(url,className)=>{const a=document.createElement("a");a.href=url;a.className=className;return a};const logos=(items,className)=>{const row=document.createElement("div");row.className=s.classes.logos;for(const item of items){const a=link(item.url,"");const img=document.createElement("img");img.src=item.logo;img.alt=item.name;img.className=className;img.loading="lazy";a.append(img);row.append(a)}return row};body.replaceChildren();if(data.patrons.length)body.append(logos(data.patrons,s.classes.patron));if(data.organizations.length)body.append(logos(data.organizations,s.classes.organization));if(data.backers.length){const ul=document.createElement("ul");ul.className=s.classes.backers;for(const item of data.backers){const li=document.createElement("li");const a=link(item.url,s.classes.link);a.textContent=item.name;li.append(a);ul.append(li)}body.append(ul)}section.setAttribute("${SPONSORS_ATTRIBUTE}",text);section.hidden=!(data.patrons.length+data.organizations.length+data.backers.length)}).catch(()=>{})})();`;
}
