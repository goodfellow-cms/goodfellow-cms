/**
 * The setup page's choices, shared by its two steps: choosing what kind of
 * site (`/new-site/`), then signing in and creating it (`/new-site/create/`),
 * which gets the choices in its address. Defaults, recommendations and
 * warnings are worked out here, so both steps say the same.
 */
import {
  BLOCK_CHOICES,
  type BlockChoice,
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
  return {
    purpose: chosen.purpose,
    template: chosen.template ?? "starter",
    blocks: chosen.blocks ?? "recommended",
    git,
    host,
    visibility,
    content: chosen.content ?? "together",
    build,
  };
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
  return `${files}, published with ${HOSTS[choices.host].label}, with ${blocks}, and the content kept ${content}${build}.`;
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
  });
}

/** Which of the choices someone made in the query, so changing another doesn't override them. */
export function chosenKeys(search: string): Array<keyof Choices> {
  const params = new URLSearchParams(search);
  return (["template", "blocks", "git", "host", "visibility", "content", "build"] as const).filter((key) =>
    params.has(key),
  );
}
