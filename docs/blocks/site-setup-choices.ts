/**
 * The setup page's choices, shared by its two steps: choosing what kind of
 * site (`/new-site/`), then signing in and creating it (`/new-site/create/`),
 * which gets the choices in its address. Defaults, recommendations and
 * warnings are worked out here, so both steps say the same.
 */
import {
  allowsAdminAddress,
  BLOCK_CHOICES,
  type BlockChoice,
  type BrokerHost,
  brokerHostsFor,
  CONTENT_BUILDS,
  type ContentBuild,
  contentBuildsFor,
  HOSTS,
  type Host,
  hostsFor,
  TEMPLATES,
  type TemplateName,
} from "@goodfellow-cms/core";

export type Purpose = "personal" | "group" | "business";
export type GitHostName = "github" | "gitlab";
export type Visibility = "public" | "private";
export type ContentPlace = "together" | "separate";
export type SignInPlace = "admin-panel" | "admin-address" | "broker";

export interface Choices {
  purpose: Purpose;
  template: TemplateName;
  blocks: BlockChoice;
  git: GitHostName;
  host: Host;
  visibility: Visibility;
  /** Whether the content is kept in a repository of its own, beside the code's. */
  content: ContentPlace;
  /** With the content kept apart, which repository the host builds the site from. */
  build: ContentBuild;
  /** Whether the owner has a domain for the site, such as example.org, which an admin address needs. */
  domain: boolean;
  /** Where editors sign in: the admin panel itself, an admin address of its own, or a token broker. */
  signIn: SignInPlace;
  /** With an admin address, the address, such as `https://admin.example.org`. */
  admin: string;
  /** With a token broker, where it's put online. */
  brokerHost: BrokerHost;
  /** With a token broker, its own domain, which GitHub Pages needs. */
  brokerDomain: string;
}

/** The two steps' addresses on the docs site. */
export const CHOOSE_PATH = "/new-site/";
export const CREATE_PATH = "/new-site/create/";

export const PURPOSES: Record<Purpose, { label: string; description: string }> = {
  personal: { label: "Personal, or a hobby", description: "A site of your own, with nobody paid to make it." },
  group: { label: "A church, charity, school or club", description: "A nonprofit group, run by volunteers." },
  business: {
    label: "A business",
    description: "Or any site that sells things, advertises products or services for sale, or shows ads.",
  },
};

export const GIT_HOSTS: Record<GitHostName, { label: string; description: string }> = {
  github: {
    label: "GitHub",
    description:
      "Free. GitHub Pages needs a public repository and isn't for business sites on the free plan, and editors sign in with a token or a sign-in service you run.",
  },
  gitlab: {
    label: "GitLab",
    description:
      "Free, with GitLab Pages for public and private sites, business ones included. Editors sign in with GitLab. The free plan has 400 build minutes a month, and a private group can have up to 5 people.",
  },
};

export const VISIBILITIES: Record<Visibility, { label: string; description: string }> = {
  public: {
    label: "Public",
    description:
      "Anyone can see the site's files, as they can see the site. Editors' accounts and their changes are listed too.",
  },
  private: {
    label: "Private",
    description: "Only the people you invite can see the files. The site itself is public either way.",
  },
};

export const CONTENT_PLACES: Record<ContentPlace, { label: string; description: string }> = {
  together: {
    label: "With the code",
    description: "One repository holds the whole site. It's the simplest, and editors' sign-in can change all of it.",
  },
  separate: {
    label: "In a repository of its own",
    description:
      "Two repositories: editors' sign-in reaches only the content's, so editors can change the site's content but never its code. For organizations with a developer to look after the code.",
  },
};

/** The content repository's name, beside the code's. */
export const contentName = (name: string) => `${name}-content`;

/** The token broker's repository's name, beside the site's. */
export const brokerName = (name: string) => `${name}-signin`;

export const SIGN_IN_PLACES: Record<SignInPlace, { label: string; description: string }> = {
  "admin-panel": {
    label: "In the admin panel, at the site's address",
    description:
      "The simplest, but the least safe. Editors' sign-in is kept in their browser where the site's own pages could reach it, so code added to the site, such as on Site Settings' Code tab, could act as them, and blocks from other registries and plugins can't be added in the admin panel.",
  },
  "admin-address": {
    label: "At an admin address of its own",
    description:
      "Such as admin.example.org, on a domain you have: the site's pages can't reach editors' sign-in there. The usual choice where you have a domain, and nothing more to put online.",
  },
  broker: {
    label: "At a sign-in page of its own",
    description:
      "A token broker: a second repository, put online at an address that serves nothing else, where editors sign in. Nothing on the site can reach their sign-in or AI keys. No domain needed on GitLab, Cloudflare Pages or Vercel.",
  },
};

export const BROKER_HOSTS: Record<BrokerHost, { label: string; description: string }> = {
  "github-pages": {
    label: "GitHub Pages, at a domain of yours",
    description: "GitHub Pages' own addresses are shared by every site in the same account, so it needs a domain.",
  },
  "gitlab-pages": {
    label: "GitLab Pages, at an address GitLab gives it",
    description: "GitLab gives the project an address of its own, which nothing else shares.",
  },
  "cloudflare-pages": {
    label: "Cloudflare Pages",
    description: "Free, with an address of its own. You connect the repository to Cloudflare Pages once it's created.",
  },
  vercel: {
    label: "Vercel",
    description: "Free for non-commercial sites. You import the repository into Vercel once it's created.",
  },
};

/**
 * Where editors' sign-in is safest for this site: an admin address of its own
 * where the owner has a domain and the host can serve one, else a sign-in page
 * of its own, which works with every host.
 */
export function recommendedSignIn(choices: Pick<Choices, "domain" | "host">): SignInPlace {
  return choices.domain && allowsAdminAddress(choices.host) ? "admin-address" : "broker";
}

/** An admin address the setup can use: https:// and a domain, nothing after it. */
export function validAdmin(address: string): boolean {
  return /^https:\/\/([a-z0-9-]+\.)+[a-z]{2,}$/i.test(address);
}

/** A domain of the owner's for the broker alone. */
export function validBrokerDomain(domain: string): boolean {
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(domain) && !/(^|\.)(github|gitlab)\.io$/i.test(domain);
}

/**
 * Where to keep a site's files: GitLab, whatever the site is for. Editors sign
 * in with GitLab without a sign-in service, GitLab Pages publishes business and
 * private sites with no other account, and scheduled changes go live on time.
 */
export const RECOMMENDED_GIT: GitHostName = "gitlab";

/**
 * The host whose free plan allows a site like this, for the git host chosen.
 * A business site, or a private repository, on GitHub goes on Cloudflare
 * Pages, since GitHub Pages allows neither on its free plan.
 */
export function recommendedHost(choices: Pick<Choices, "purpose" | "git" | "visibility">): Host | undefined {
  if (choices.git === "gitlab") return "gitlab-pages";
  return choices.purpose === "business" || choices.visibility === "private" ? "cloudflare-pages" : "github-pages";
}

/** The choices people haven't made themselves: the defaults, and what follows from what they have made. */
export function withDefaults(chosen: Partial<Choices> & { purpose: Purpose }): Choices {
  const git = chosen.git ?? RECOMMENDED_GIT;
  const visibility = chosen.visibility ?? "public";
  const recommended = recommendedHost({ purpose: chosen.purpose, git, visibility });
  const usable = hostsFor(git);
  const host =
    chosen.host && usable.includes(chosen.host)
      ? chosen.host
      : recommended && usable.includes(recommended)
        ? recommended
        : (usable[0] ?? "github-pages");
  const build = chosen.build && contentBuildsFor(host).includes(chosen.build) ? chosen.build : "content";
  // Netlify can't build a site whose content is kept in a repository of its own yet.
  const content = host === "netlify" ? "together" : (chosen.content ?? "together");
  const domain = chosen.domain ?? false;
  // With a domain, the admin address is chosen for them: a sign-in page needs a second repository, so it's only offered.
  const fallback = domain && allowsAdminAddress(host) ? "admin-address" : "admin-panel";
  const signIn =
    chosen.signIn === "admin-address" && !allowsAdminAddress(host) ? fallback : (chosen.signIn ?? fallback);
  const brokerHosts = brokerHostsFor(git);
  const brokerHost =
    chosen.brokerHost && brokerHosts.includes(chosen.brokerHost) ? chosen.brokerHost : (brokerHosts[0] ?? "vercel");
  return {
    purpose: chosen.purpose,
    template: chosen.template ?? "starter",
    blocks: chosen.blocks ?? "recommended",
    git,
    host,
    visibility,
    content,
    build,
    domain,
    signIn,
    admin: chosen.admin ?? "",
    brokerHost,
    brokerDomain: chosen.brokerDomain ?? "",
  };
}

/** Why the sign-in choice can't be used yet, such as an address still to type, or `undefined`. */
export function signInProblem(choices: Choices): string | undefined {
  if (choices.signIn === "admin-address" && !validAdmin(choices.admin)) {
    return "Type the admin address as https:// and a domain of yours, such as https://admin.example.org.";
  }
  if (
    choices.signIn === "broker" &&
    choices.brokerHost === "github-pages" &&
    !validBrokerDomain(choices.brokerDomain)
  ) {
    return "Type the sign-in page's own domain, such as signin.example.org. github.io addresses are shared with other sites.";
  }
  return undefined;
}

/** Why a host's free plan may not allow this site, or `undefined` if it does. */
export function hostProblem(choices: Choices): string | undefined {
  if (choices.purpose === "business" && choices.host === "github-pages") {
    return "GitHub Pages isn't for running a business or a shop. Cloudflare Pages, or GitLab Pages for a site kept on GitLab, are free hosts for business sites.";
  }
  if (choices.purpose === "business" && choices.host === "vercel") {
    return "Vercel's free plan is for non-commercial sites only. Cloudflare Pages, or GitLab Pages for a site kept on GitLab, are free hosts for business sites.";
  }
  if (choices.host === "vercel" && choices.purpose === "group") {
    return "Vercel's free plan counts a site as commercial if anyone is paid to make or update it. A site kept by volunteers is fine.";
  }
  if (choices.visibility === "private" && choices.host === "github-pages") {
    return "GitHub Pages doesn't work with private repositories on GitHub's free plan, unless your account has GitHub Pro, Team or Enterprise. Publish the site with Cloudflare Pages instead, keep it on GitLab, or make the repository public.";
  }
  return undefined;
}

/** The note under "Where to keep the site's files" when they're kept on GitHub, saying what GitLab would give the site. */
export function gitNote(choices: Choices): string | undefined {
  if (choices.git !== "github") return undefined;
  const why =
    "On GitLab, editors sign in with GitLab without a sign-in service of your own, GitLab Pages publishes the site with no other account, and scheduled changes go live on time rather than within the hour.";
  if (choices.purpose === "business") {
    return `${why} GitHub's free hosting isn't for business sites, so a business site kept on GitHub is published with Cloudflare Pages, which needs a Cloudflare account.`;
  }
  if (choices.visibility === "private") {
    return `${why} GitHub Pages doesn't work with private repositories on GitHub's free plan, so a private site kept on GitHub is published with Cloudflare Pages, which needs a Cloudflare account.`;
  }
  return why;
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/** The advanced settings in one sentence, so what they're set to is never hidden. */
export function advancedSummary(choices: Choices): string {
  const files = choices.visibility === "private" ? "Private files" : "Public files";
  const blocks =
    choices.blocks === "recommended" ? "the recommended blocks" : lowerFirst(BLOCK_CHOICES[choices.blocks].label);
  const content = choices.content === "separate" ? "in a repository of its own" : "with the code";
  const build =
    choices.content === "separate" && contentBuildsFor(choices.host).length > 1
      ? `, built from ${lowerFirst(CONTENT_BUILDS[choices.build].label)}`
      : "";
  const signIn =
    choices.signIn === "admin-address"
      ? ` Editors sign in at ${choices.admin || "an admin address of its own"}.`
      : choices.signIn === "broker"
        ? ` Editors sign in at a sign-in page of its own, on ${BROKER_HOSTS[choices.brokerHost].label.split(",")[0]}.`
        : "";
  return `${files}, published with ${HOSTS[choices.host].label}, with ${blocks}, and the content kept ${content}${build}.${signIn}`;
}

/** The choices as the create step's query, so its address says what it creates. */
export function choicesQuery(choices: Choices): string {
  return new URLSearchParams({
    purpose: choices.purpose,
    template: choices.template,
    blocks: choices.blocks,
    git: choices.git,
    host: choices.host,
    visibility: choices.visibility,
    content: choices.content,
    ...(choices.content === "separate" && { build: choices.build }),
    ...(choices.domain && { domain: "1" }),
    ...(choices.signIn !== "admin-panel" && { signIn: choices.signIn }),
    ...(choices.signIn === "admin-address" && { admin: choices.admin }),
    ...(choices.signIn === "broker" && { brokerHost: choices.brokerHost }),
    ...(choices.signIn === "broker" && choices.brokerDomain && { brokerDomain: choices.brokerDomain }),
  }).toString();
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | undefined {
  return allowed.find((candidate) => candidate === value);
}

/**
 * The choices in an address's query, as far as they can be used: values that
 * aren't choices (such as from a link edited by hand) are left to the
 * defaults. `undefined` without a purpose, which everything else follows from.
 */
export function parseChoices(search: string): Choices | undefined {
  const params = new URLSearchParams(search);
  const purpose = oneOf(params.get("purpose"), Object.keys(PURPOSES) as Purpose[]);
  if (!purpose) return undefined;
  return withDefaults({
    purpose,
    template: oneOf(params.get("template"), Object.keys(TEMPLATES) as TemplateName[]),
    blocks: oneOf(params.get("blocks"), Object.keys(BLOCK_CHOICES) as BlockChoice[]),
    git: oneOf(params.get("git"), Object.keys(GIT_HOSTS) as GitHostName[]),
    host: oneOf(params.get("host"), Object.keys(HOSTS) as Host[]),
    visibility: oneOf(params.get("visibility"), Object.keys(VISIBILITIES) as Visibility[]),
    content: oneOf(params.get("content"), Object.keys(CONTENT_PLACES) as ContentPlace[]),
    build: oneOf(params.get("build"), Object.keys(CONTENT_BUILDS) as ContentBuild[]),
    ...(params.has("domain") && { domain: params.get("domain") === "1" }),
    signIn: oneOf(params.get("signIn"), Object.keys(SIGN_IN_PLACES) as SignInPlace[]),
    admin: params.get("admin") ?? undefined,
    brokerHost: oneOf(params.get("brokerHost"), Object.keys(BROKER_HOSTS) as BrokerHost[]),
    brokerDomain: params.get("brokerDomain") ?? undefined,
  });
}

/** Which of the choices someone made in the query, so changing another doesn't override them. */
export function chosenKeys(search: string): Array<keyof Choices> {
  const params = new URLSearchParams(search);
  return (
    [
      "template",
      "blocks",
      "git",
      "host",
      "visibility",
      "content",
      "build",
      "domain",
      "signIn",
      "admin",
      "brokerHost",
      "brokerDomain",
    ] as const
  ).filter((key) => params.has(key));
}
