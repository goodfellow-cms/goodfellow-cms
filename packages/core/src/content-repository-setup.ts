/**
 * The setup files of a site whose content is kept in a repository of its own:
 * each repository's builds, nightly updates and rebuilds, for each host.
 * `planSite()` uses them for new sites, so `create-goodfellow` and the setup
 * page make the same ones.
 */
import { CONTENT_REPOSITORY_DIR } from "./content/paths.js";
import type { Host } from "./site-setup.js";

/** Which repository the host builds the site from. */
export const CONTENT_BUILDS = {
  content: {
    label: "The content repository",
    description:
      "Builds check out the code without being able to change it, so the admin panel shows when changes are live.",
  },
  code: {
    label: "The code repository",
    description:
      "Builds check out the content with a token that can only read it. For sites whose build has secrets, such as a full-stack site's.",
  },
} as const;

export type ContentBuild = keyof typeof CONTENT_BUILDS;

/** Where a site's content is kept when it has a repository of its own. */
export interface SeparateContent {
  /** The content repository, on the same host as the code: `owner/name`, or a GitLab project's path. */
  repo: string;
  /** Which repository the host builds the site from. */
  build: ContentBuild;
}

/**
 * The name of the job, and of the GitHub workflow file, that only asks
 * another host (Vercel) to rebuild the site. It says nothing about when the
 * site is live, so backends leave it out of deploy status.
 */
export const REBUILD_JOB = "rebuild";

/** Where each host can build a site from: GitHub Pages and GitLab Pages publish the repository that builds. */
export function contentBuildsFor(host: Host): ContentBuild[] {
  return host === "vercel" ? ["code", "content"] : ["content"];
}

export interface SeparateSetup {
  git: "github" | "gitlab";
  host: Host;
  build: ContentBuild;
  /** The code repository. */
  code: string;
  /** The content repository. */
  content: string;
  /** Whether the site is a Next.js app, which builds with `npm run build` into `out/`. */
  next: boolean;
}

/** Each repository's setup files, by path. */
export interface SeparateSetupFiles {
  code: Map<string, string>;
  content: Map<string, string>;
}

const GITHUB_PAGES_WORKFLOW = ".github/workflows/deploy.yml";
const GITHUB_UPDATE_WORKFLOW = ".github/workflows/update.yml";
const GITHUB_REBUILD_WORKFLOW = `.github/workflows/${REBUILD_JOB}.yml`;
const GITLAB_CI = ".gitlab-ci.yml";
const VERCEL_CONFIG = "vercel.ts";

/** The files the template's own setup has, which a site with separate content replaces. */
export const SINGLE_REPOSITORY_SETUP_FILES = [GITHUB_PAGES_WORKFLOW, GITLAB_CI, VERCEL_CONFIG];

/** Comment lines, wrapped at about 80 columns. */
function comment(text: string, prefix = "# "): string {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line && line.length + word.length + 1 > 78 - prefix.length) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines.map((line) => `${prefix}${line}`.trimEnd()).join("\n");
}

function commands(setup: SeparateSetup) {
  const cli = setup.next ? "goodfellow-next" : "goodfellow";
  return {
    copy: `npx ${cli} content copy`,
    update: `npx ${cli} update`,
    output: setup.next ? "out" : "dist",
  };
}

/** A clone address that uses a token from `variable` when it's set, for repositories that aren't public. */
function cloneUrl(setup: SeparateSetup, repo: string, variable: string): string {
  const user = setup.git === "github" ? "x-access-token" : "oauth2";
  const host = setup.git === "github" ? "github.com" : "gitlab.com";
  return `https://\${${variable}:+${user}:$${variable}@}${host}/${repo}.git`;
}

/** GitHub Pages, built from the content repository: its workflow checks out the code, then the content inside it. */
function githubPagesContentWorkflow(setup: SeparateSetup): string {
  const { copy, output } = commands(setup);
  const build = setup.next
    ? `      - run: npm run build
        env:
          GOODFELLOW_BASE: \${{ steps.pages.outputs.base_path }}/`
    : `      - run: npx goodfellow build --base "\${{ steps.pages.outputs.base_path }}/"`;
  return `${comment(
    `Builds the site and publishes it with GitHub Pages whenever its content changes (including every Publish in the admin panel), once a night so date-based content stays current, and when ${setup.code}, which holds the site's code, asks after a change to it. This repository holds only the site's content.
In this repository's Settings → Pages, set "Source" to "GitHub Actions".
If ${setup.code} is private, this workflow needs a deploy key to read it: add its public half to ${setup.code} (Settings → Deploy keys, without write access), and its private half here as the GOODFELLOW_CODE_KEY secret (Settings → Secrets and variables → Actions).`,
  )}
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  schedule:
    - cron: "17 4 * * *"
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # The site's code, with this repository's content in ${CONTENT_REPOSITORY_DIR}/, as on a developer's computer.
      - uses: actions/checkout@v5
        with:
          repository: ${setup.code}
          ssh-key: \${{ secrets.GOODFELLOW_CODE_KEY }}
      - uses: actions/checkout@v5
        with:
          path: ${CONTENT_REPOSITORY_DIR}
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - id: pages
        uses: actions/configure-pages@v5
      - run: npm ci
      - run: ${copy}
      # Project sites live in a subfolder (/repository-name/); user and organization sites don't.
${build}
      - uses: actions/upload-pages-artifact@v4
        with:
          path: ${output}

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`;
}

/** The code repository's nightly update on GitHub, which then asks the content repository to build. */
function githubUpdateWorkflow(setup: SeparateSetup): string {
  const { copy, update } = commands(setup);
  return `${comment(
    `Installs Goodfellow's newest fixes each night, and publishes them only if the site still builds with them, unless content/updates.json in ${setup.content}, which holds the site's content, turns automatic updates off. The site is built and published from ${setup.content}: after each change to the code here, including updates, this starts its build, if this repository has a GOODFELLOW_BUILD_TOKEN secret (a fine-grained token for ${setup.content} only, with Actions read and write). Without it, changes to the code go live with that repository's nightly build.
If ${setup.content} is private, this workflow needs a deploy key to read it: add its public half to ${setup.content} (Settings → Deploy keys, without write access), and its private half here as the GOODFELLOW_CONTENT_KEY secret (Settings → Secrets and variables → Actions).`,
  )}
name: Update Goodfellow

on:
  push:
    branches: [main]
  schedule:
    - cron: "7 4 * * *"
  workflow_dispatch:
    inputs:
      update:
        description: "Update Goodfellow: fixes, latest, or a release such as 0.5.0 (an older one goes back to it). Leave empty to only rebuild the site."
        required: false
        default: ""

permissions:
  contents: read

jobs:
  update:
    if: github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.update != '')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    outputs:
      sha: \${{ steps.update.outputs.sha }}
    steps:
      - uses: actions/checkout@v5
      # The site's content, which the update builds the site with to check it still works.
      - uses: actions/checkout@v5
        with:
          repository: ${setup.content}
          path: ${CONTENT_REPOSITORY_DIR}
          ssh-key: \${{ secrets.GOODFELLOW_CONTENT_KEY }}
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: ${copy}
      - id: update
        env:
          TO: \${{ inputs.update || 'automatic' }}
        run: ${update} --publish --to "$TO"

  build:
    needs: update
    # After a change to the code, or an update that was published.
    if: \${{ !cancelled() && (github.event_name != 'schedule' || needs.update.outputs.sha != '') }}
    runs-on: ubuntu-latest
    steps:
      - env:
          GH_TOKEN: \${{ secrets.GOODFELLOW_BUILD_TOKEN }}
        run: |
          if [ -z "$GH_TOKEN" ]; then
            echo "There's no GOODFELLOW_BUILD_TOKEN secret, so the site gets this with ${setup.content}'s nightly build."
            exit 0
          fi
          gh workflow run deploy.yml --repo ${setup.content}
`;
}

/** GitLab Pages, built from the content project: its pipeline clones the code, then copies the content into it. */
function gitlabPagesContentPipeline(setup: SeparateSetup): string {
  const { output } = commands(setup);
  const cli = setup.next ? "goodfellow-next" : "goodfellow";
  return `${comment(
    `Builds the site and publishes it with GitLab Pages whenever its content changes (including every Publish in the admin panel), and when ${setup.code}, which holds the site's code, starts it: after each change to the code, and on its scheduled pipelines, which keep date-based content current. This project holds only the site's content.
If ${setup.code} is private, add this project to its job token allowlist: ${setup.code}'s Settings → CI/CD → Job token permissions.`,
  )}
pages:
  image: node:22
  cache:
    key: npm
    paths: [.npm/]
  script:
    # The site's code, in site/, with this project's content copied into it.
    - git clone --depth 1 "https://gitlab-ci-token:\${CI_JOB_TOKEN}@\${CI_SERVER_FQDN:-$CI_SERVER_HOST}/${setup.code}.git" site
    - cd site
    - npm ci --cache ../.npm --prefer-offline
    - npx ${cli} content copy ..
    # Pages may serve the site from a subfolder, such as https://group.gitlab.io/site/.
    - export GOODFELLOW_BASE="$(node -e 'console.log(new URL(process.env.CI_PAGES_URL).pathname)')"
    - ${setup.next ? "npm run build" : "npx goodfellow build"}
  pages:
    publish: site/${output}
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`;
}

/** The code project's pipeline on GitLab: nightly updates, then the content project's build. */
function gitlabCodePipeline(setup: SeparateSetup): string {
  const { copy, update } = commands(setup);
  return `${comment(
    `On scheduled pipelines (set one up to run each night under Build → Pipeline schedules), installs Goodfellow's newest fixes, unless content/updates.json in ${setup.content}, which holds the site's content, turns automatic updates off (or the release GOODFELLOW_UPDATE names), and publishes them only if the site still builds with them. That needs "Allow Git push requests to the repository" under Settings → CI/CD → Job token permissions, and, if ${setup.content} is private, this project in its job token allowlist.
The site is built and published by ${setup.content}: after every change to the code, and each scheduled pipeline, this starts its pipeline.`,
  )}
update:
  image: node:22
  cache:
    key:
      files: [package-lock.json]
    paths: [.npm/]
  script:
    - git clone --depth 1 "https://gitlab-ci-token:\${CI_JOB_TOKEN}@\${CI_SERVER_FQDN:-$CI_SERVER_HOST}/${setup.content}.git" ${CONTENT_REPOSITORY_DIR}
    - npm ci --cache .npm --prefer-offline
    - ${copy}
    - git remote set-url origin "https://gitlab-ci-token:\${CI_JOB_TOKEN}@\${CI_SERVER_FQDN:-$CI_SERVER_HOST}/\${CI_PROJECT_PATH}.git"
    - ${update} --publish --to "\${GOODFELLOW_UPDATE:-automatic}" || echo "The update wasn't published; building the site as it is."
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && ($CI_PIPELINE_SOURCE == "schedule" || $GOODFELLOW_UPDATE)

build:
  needs:
    - job: update
      optional: true
  trigger:
    project: ${setup.content}
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`;
}

/** Asks Vercel to rebuild the site when this repository changes, through the Vercel project's deploy hook. */
function rebuildOnVercel(setup: SeparateSetup, other: string, what: "content" | "code"): string {
  const intro = `Vercel builds the site from ${other}, so this asks it to rebuild the site whenever this repository's ${what} changes${what === "content" ? " (including every Publish in the admin panel)" : ""}, and each night so date-based content stays current. It uses the Vercel project's deploy hook (Settings → Git → Deploy Hooks), which can only start builds:`;
  if (setup.git === "github") {
    return `${comment(`${intro} add it here as the VERCEL_DEPLOY_HOOK secret (Settings → Secrets and variables → Actions).`)}
name: Rebuild on Vercel

on:
  push:
    branches: [main]
  schedule:
    - cron: "17 4 * * *"
  workflow_dispatch:

permissions: {}

jobs:
  ${REBUILD_JOB}:
    runs-on: ubuntu-latest
    steps:
      - env:
          HOOK: \${{ secrets.VERCEL_DEPLOY_HOOK }}
        run: |
          if [ -z "$HOOK" ]; then
            echo "Add the Vercel project's deploy hook as this repository's VERCEL_DEPLOY_HOOK secret."
            exit 1
          fi
          curl --fail --silent --show-error --request POST "$HOOK"
`;
  }
  return `${comment(`${intro} add it here as the VERCEL_DEPLOY_HOOK variable (Settings → CI/CD → Variables, masked), and set up a pipeline schedule to run each night under Build → Pipeline schedules.`)}
${REBUILD_JOB}:
  image: node:22
  script:
    - |
      if [ -z "$VERCEL_DEPLOY_HOOK" ]; then
        echo "Add the Vercel project's deploy hook as this project's VERCEL_DEPLOY_HOOK variable."
        exit 1
      fi
    - curl --fail --silent --show-error --request POST "$VERCEL_DEPLOY_HOOK"
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`;
}

/** Replaces a string property of the starter's `vercel.ts` config. */
function setConfigValue(source: string, key: string, value: string | null): string {
  const pattern = new RegExp(`^(\\s*)${key}: .*,$`, "m");
  if (!pattern.test(source)) throw new Error(`The template's vercel.ts has no ${key} to change.`);
  return source.replace(pattern, `$1${key}: ${JSON.stringify(value)},`);
}

/** Vercel's settings where it builds from the code repository, which clones the content when it installs. */
function vercelCodeConfig(setup: SeparateSetup, template: string | undefined): string {
  const { copy } = commands(setup);
  const install = `npm ci && git clone --depth 1 "${cloneUrl(setup, setup.content, "GOODFELLOW_CONTENT_TOKEN")}" ${CONTENT_REPOSITORY_DIR} && ${copy}`;
  const note = comment(
    `The site's content is kept in ${setup.content}, which the install clones into ${CONTENT_REPOSITORY_DIR}/. If it isn't public, add a token that can only read it as this project's GOODFELLOW_CONTENT_TOKEN environment variable: ${setup.git === "github" ? `a fine-grained token for ${setup.content} with Contents read` : `a project access token for ${setup.content} with the Reporter role and the read_repository scope`}.`,
    "// ",
  );
  if (setup.next || template === undefined) {
    return `// Vercel's settings for this site, which Vercel reads when it builds the site.
${note}
// Next.js sends the site's redirects itself.
export const config = {
  framework: "nextjs",
  installCommand: ${JSON.stringify(install)},
};
`;
  }
  // The content isn't there yet when Vercel reads this file, so redirects are left to the pages the build writes.
  return `${note}
//
${setConfigValue(template, "installCommand", install)}`;
}

/** Vercel's settings where it builds from the content repository, which clones the code when it installs. */
function vercelContentConfig(setup: SeparateSetup, template: string | undefined): string {
  const { output } = commands(setup);
  const cli = setup.next ? "goodfellow-next" : "goodfellow";
  const install = `git clone --depth 1 "${cloneUrl(setup, setup.code, "GOODFELLOW_CODE_TOKEN")}" site && cd site && npm ci && npx ${cli} content copy ..`;
  const build = setup.next ? "cd site && npm run build" : "cd site && npx goodfellow build";
  const note = comment(
    `This repository holds only the site's content. Its code is in ${setup.code}, which the install clones into site/ and builds with this content. If it isn't public, add a token that can only read it as this project's GOODFELLOW_CODE_TOKEN environment variable: ${setup.git === "github" ? `a fine-grained token for ${setup.code} with Contents read` : `a project access token for ${setup.code} with the Reporter role and the read_repository scope`}.`,
    "// ",
  );
  if (setup.next || template === undefined) {
    return `// Vercel's settings for this site, which Vercel reads when it builds the site.
${note}
// Redirects are sent by the pages the build writes at old addresses.
export const config = {
  framework: null,
  installCommand: ${JSON.stringify(install)},
  buildCommand: ${JSON.stringify(build)},
  outputDirectory: ${JSON.stringify(`site/${output}`)},
};
`;
  }
  let config = setConfigValue(template, "installCommand", install);
  config = setConfigValue(config, "buildCommand", build);
  config = setConfigValue(config, "outputDirectory", `site/${output}`);
  return `${note}
//
${config}`;
}

/**
 * Each repository's setup files for a site whose content is kept in a
 * repository of its own. `vercelTemplate` is the template's `vercel.ts`, whose
 * redirects the Vercel setups keep where they can.
 */
export function separateSetupFiles(setup: SeparateSetup, vercelTemplate?: string): SeparateSetupFiles {
  const code = new Map<string, string>();
  const content = new Map<string, string>();
  if (!contentBuildsFor(setup.host).includes(setup.build)) {
    throw new Error(`${setup.host} can only build the site from the content repository.`);
  }
  if (setup.host === "github-pages") {
    content.set(GITHUB_PAGES_WORKFLOW, githubPagesContentWorkflow(setup));
    code.set(GITHUB_UPDATE_WORKFLOW, githubUpdateWorkflow(setup));
  } else if (setup.host === "gitlab-pages") {
    content.set(GITLAB_CI, gitlabPagesContentPipeline(setup));
    code.set(GITLAB_CI, gitlabCodePipeline(setup));
  } else {
    const [builds, other] = setup.build === "code" ? [code, content] : [content, code];
    builds.set(
      VERCEL_CONFIG,
      setup.build === "code" ? vercelCodeConfig(setup, vercelTemplate) : vercelContentConfig(setup, vercelTemplate),
    );
    const rebuild = rebuildOnVercel(
      setup,
      setup.build === "code" ? setup.code : setup.content,
      setup.build === "code" ? "content" : "code",
    );
    other.set(setup.git === "github" ? GITHUB_REBUILD_WORKFLOW : GITLAB_CI, rebuild);
  }
  return { code, content };
}

/** One of a separate site's two repositories. */
export type SiteRepository = "code" | "content";

/** A repository whose builds or updates read the other one, which has to let it in where it isn't public. */
export interface RepositoryRead {
  reader: SiteRepository;
  read: SiteRepository;
  /** On GitHub, the secret in `reader` that holds the private half of `read`'s deploy key. */
  secret?: string;
}

/** What connects a separate site's repositories, besides their setup files, for the setup page to set up. */
export interface SeparateSetupLinks {
  /** Which repository reads which: with a deploy key on GitHub, where it's private, or the job token on GitLab. */
  reads: RepositoryRead[];
  /** Repositories whose pipelines need a schedule to run each night (GitLab: GitHub's workflows have their own). */
  nightly: SiteRepository[];
  /** The repository whose job token publishes Goodfellow's updates (GitLab). */
  updates?: SiteRepository;
}

/**
 * What connects the repositories that `separateSetupFiles()` sets up, as each
 * setup file's comments describe it. Vercel reads the other repository with
 * a token in its own settings, which only the person can add there.
 */
export function separateSetupLinks(setup: Pick<SeparateSetup, "git" | "host" | "build">): SeparateSetupLinks {
  if (setup.host === "vercel") {
    // The repository Vercel doesn't build from asks it to rebuild each night.
    return { reads: [], nightly: setup.git === "gitlab" ? [setup.build === "code" ? "content" : "code"] : [] };
  }
  const gitlab = setup.git === "gitlab";
  return {
    reads: [
      { reader: "content", read: "code", ...(!gitlab && { secret: "GOODFELLOW_CODE_KEY" }) },
      { reader: "code", read: "content", ...(!gitlab && { secret: "GOODFELLOW_CONTENT_KEY" }) },
    ],
    nightly: gitlab ? ["code"] : [],
    updates: "code",
  };
}

function repoUrl(setup: SeparateSetup, repo: string): string {
  return `https://${setup.git === "github" ? "github.com" : "gitlab.com"}/${repo}`;
}

/** How the site is built, for the READMEs. */
function buildNote(setup: SeparateSetup): string {
  const rebuild = setup.git === "github" ? GITHUB_REBUILD_WORKFLOW : GITLAB_CI;
  if (setup.host === "github-pages") {
    return `The site is built and published with GitHub Pages from the content repository, by its \`${GITHUB_PAGES_WORKFLOW}\`, which checks out the code: turn GitHub Pages on there (Settings → Pages, with "GitHub Actions" as the source). The code's \`${GITHUB_UPDATE_WORKFLOW}\` installs Goodfellow's fixes each night and asks the content repository to rebuild the site after each change to the code.`;
  }
  if (setup.host === "gitlab-pages") {
    return `The site is built and published with GitLab Pages from the content project, by its \`${GITLAB_CI}\`, which clones the code. The code's \`${GITLAB_CI}\` installs Goodfellow's fixes on scheduled pipelines and starts the content project's pipeline after each change to the code: set up a pipeline schedule there to run each night.`;
  }
  return setup.build === "code"
    ? `Vercel builds the site from the code repository: its \`${VERCEL_CONFIG}\` clones the content when it installs. The content repository's \`${rebuild}\` asks Vercel to rebuild the site whenever the content changes.`
    : `Vercel builds the site from the content repository: its \`${VERCEL_CONFIG}\` clones the code when it installs, so the admin panel can show when changes are live. The code's \`${rebuild}\` asks Vercel to rebuild the site whenever the code changes.`;
}

/** The section the code's README gets, saying where the content is and how to work with it. */
export function codeReadmeSection(setup: SeparateSetup): string {
  const cli = setup.next ? "goodfellow-next" : "goodfellow";
  return `## Content in a repository of its own

This site's content (\`content/\` and \`public/media/\`) is kept in [${setup.content}](${repoUrl(setup, setup.content)}), and its code here. Editors' sign-in and publishing reach only the content repository, so they can change the site's content but never its code.

To work on the site, clone the content repository into \`${CONTENT_REPOSITORY_DIR}/\` and link it, so \`npm run dev\` reads and saves its files:

\`\`\`sh
git clone ${repoUrl(setup, setup.content)}.git ${CONTENT_REPOSITORY_DIR}
npx ${cli} content link
\`\`\`

\`${CONTENT_REPOSITORY_DIR}/\` is a repository of its own, where content changes are committed. This one ignores it, and \`content/\` and \`public/media/\`, which link to it. Adding and removing blocks, which changes code, is done here, in the admin panel of \`npm run dev\`.

${buildNote(setup)} Each setup file says what it needs where a repository isn't public. See [Content in a repository of its own](https://goodfellow-cms.github.io/goodfellow-cms/docs/content-repository).
`;
}

/** The content repository's README. */
export function contentReadme(setup: SeparateSetup, name: string): string {
  const cli = setup.next ? "goodfellow-next" : "goodfellow";
  return `# ${name}: content

This repository holds the content of a [Goodfellow](https://goodfellow-cms.github.io/goodfellow-cms/) site: its pages, collections, settings and media, which editors change in the site's admin panel. The site's code is in [${setup.code}](${repoUrl(setup, setup.code)}).

${buildNote(setup)}

Developers clone this repository into the code's \`${CONTENT_REPOSITORY_DIR}/\` folder and run \`npx ${cli} content link\` there, as the code's README.md explains.
`;
}

/** The lines the code's `.gitignore` gets, so the content and its links stay out of the code. */
export const CODE_GITIGNORE = `
# The site's content, kept in a repository of its own in ${CONTENT_REPOSITORY_DIR}/, which content/ and public/media/ link to.
/${CONTENT_REPOSITORY_DIR}/
/content
/public/media
`;
