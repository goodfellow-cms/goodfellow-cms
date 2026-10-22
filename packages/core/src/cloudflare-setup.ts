/**
 * The setup files of a site Cloudflare Pages serves. Cloudflare builds the site
 * itself whenever its repository changes, but can't build on a schedule, so a
 * GitHub workflow or GitLab pipeline runs the nightly update and the checks for
 * scheduled changes, and asks Cloudflare to rebuild the site through the Pages
 * project's deploy hook when there's nothing new for it to build.
 * `planSite()` writes them for new sites, so `create-goodfellow` and the setup
 * page make the same ones.
 */

/** The secret (GitHub) or variable (GitLab) that holds the Pages project's deploy hook. */
export const CLOUDFLARE_DEPLOY_HOOK = "CLOUDFLARE_DEPLOY_HOOK";

/** Where Cloudflare's own settings for the project are: what the README and the setup files' comments point to. */
export const CLOUDFLARE_BUILD_SETTINGS = {
  /** No framework preset: the build command is the site's own. */
  preset: "None",
  command: "npm run build",
  output: (next: boolean) => (next ? "out" : "dist"),
};

export interface CloudflareSetup {
  /** Where the site's repository is, or both when it isn't known yet. */
  git?: "github" | "gitlab";
  /** Whether the site is a Next.js app, whose commands are `goodfellow-next`'s. */
  next: boolean;
}

const GITHUB_WORKFLOW = ".github/workflows/deploy.yml";
const GITHUB_SCHEDULED_WORKFLOW = ".github/workflows/scheduled.yml";
const GITLAB_CI = ".gitlab-ci.yml";

/** Comment lines, wrapped at about 80 columns. */
function comment(text: string): string {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(" ")) {
      if (line && line.length + word.length + 1 > 76) {
        lines.push(line);
        line = word;
      } else line = line ? `${line} ${word}` : word;
    }
    lines.push(line);
  }
  return lines.map((line) => `# ${line}`.trimEnd()).join("\n");
}

const HOOK_WHERE =
  "the Pages project's deploy hook (in Cloudflare, the project's Settings → Builds → Add deploy hook, for the main branch), which can only start builds";

/** The nightly update and rebuild on GitHub, which `scheduled.yml` also starts when a scheduled change comes due. */
function githubWorkflow({ next }: CloudflareSetup): string {
  const cli = next ? "goodfellow-next" : "goodfellow";
  return `${comment(
    `Cloudflare Pages builds and publishes the site whenever the main branch changes (including every Publish in the admin panel). This workflow keeps it current: each night it installs Goodfellow's newest fixes, and publishes them only if the site still builds with them, unless content/updates.json turns automatic updates off. When there's nothing new to publish, it asks Cloudflare to rebuild the site instead, so date-based content stays current. scheduled.yml also starts it when a page or item scheduled to be shown or hidden comes due.
It asks Cloudflare through ${HOOK_WHERE}: add it here as the ${CLOUDFLARE_DEPLOY_HOOK} secret (Settings → Secrets and variables → Actions). See README.md.`,
  )}
name: Update and rebuild on Cloudflare Pages

on:
  schedule:
    - cron: "17 4 * * *"
  workflow_dispatch:
    inputs:
      update:
        description: "Update Goodfellow first: fixes, latest, or a release such as 0.5.0 (an older one goes back to it). Leave empty to only rebuild."
        required: false
        default: ""

permissions:
  contents: read

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  update:
    # Each night, and when the admin panel's Updates screen asks.
    if: github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.update != '')
    runs-on: ubuntu-latest
    permissions:
      contents: write
    outputs:
      sha: \${{ steps.update.outputs.sha }}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - id: update
        env:
          TO: \${{ inputs.update || 'automatic' }}
        run: npx ${cli} update --publish --to "$TO"

  rebuild:
    needs: update
    # Cloudflare builds an update that was published by itself, so this is for when there wasn't one.
    if: \${{ !cancelled() && needs.update.outputs.sha == '' }}
    runs-on: ubuntu-latest
    steps:
      - env:
          HOOK: \${{ secrets.${CLOUDFLARE_DEPLOY_HOOK} }}
        run: |
          if [ -z "$HOOK" ]; then
            echo "Add the Cloudflare Pages project's deploy hook as this repository's ${CLOUDFLARE_DEPLOY_HOOK} secret."
            exit 1
          fi
          curl --fail --silent --show-error --request POST "$HOOK"
`;
}

/** The hourly check on GitHub, which starts the rebuild once a scheduled change has come due. */
function githubScheduledWorkflow({ next }: CloudflareSetup): string {
  const cli = next ? "goodfellow-next" : "goodfellow";
  return `${comment(
    `Checks each hour whether a page or item scheduled to be shown or hidden has come due since the last check, and if one has, starts the "Update and rebuild on Cloudflare Pages" workflow (deploy.yml), which asks Cloudflare to rebuild the site, so the change goes live within the hour.
On a private repository each check counts as a minute of GitHub Actions, about 720 a month of the free plan's 2,000. Delete this file to have scheduled changes go live with the nightly rebuild instead. See README.md.`,
  )}
name: Scheduled changes

on:
  schedule:
    - cron: "47 * * * *"
  workflow_dispatch:

permissions:
  contents: read
  actions: write

concurrency:
  group: scheduled-changes
  cancel-in-progress: false

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      # Since the last check that worked.
      - id: due
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          since="$(gh run list --repo "$GITHUB_REPOSITORY" --workflow scheduled.yml --status success --limit 1 --json startedAt --jq '.[0].startedAt' || true)"
          npx ${cli} due --since "$since"
      - if: steps.due.outputs.due == 'true'
        env:
          GH_TOKEN: \${{ github.token }}
        run: gh workflow run deploy.yml --repo "$GITHUB_REPOSITORY" --ref "$GITHUB_REF_NAME"
`;
}

/** The nightly update and rebuild on GitLab, on scheduled pipelines and those the admin panel starts. */
function gitlabPipeline({ next }: CloudflareSetup): string {
  const cli = next ? "goodfellow-next" : "goodfellow";
  return `${comment(
    `Cloudflare Pages builds and publishes the site whenever the default branch changes (including every Publish in the admin panel). This pipeline keeps it current. On scheduled pipelines, which the admin panel's Updates screen sets up to run each night, it first installs Goodfellow's newest fixes, unless content/updates.json turns automatic updates off (or the release GOODFELLOW_UPDATE names), and publishes them only if the site still builds with them. That needs "Allow Git push requests to the repository" under Settings → CI/CD → Job token permissions, which the Updates screen turns on.
When there's nothing new to publish, it asks Cloudflare to rebuild the site instead, so date-based content stays current. The admin panel also adds a pipeline schedule for each time a page or item is scheduled to be shown or hidden, with GOODFELLOW_SCHEDULED_CHANGE set, which only rebuilds the site.
It asks Cloudflare through ${HOOK_WHERE}: add it here as the ${CLOUDFLARE_DEPLOY_HOOK} variable (Settings → CI/CD → Variables, masked). See README.md.`,
  )}
update:
  image: node:22
  cache:
    key:
      files: [package-lock.json]
    paths: [.npm/]
  script:
    - |
      if [ -z "$GOODFELLOW_SCHEDULED_CHANGE" ]; then
        npm ci --cache .npm --prefer-offline
        git remote set-url origin "https://gitlab-ci-token:\${CI_JOB_TOKEN}@\${CI_SERVER_FQDN:-$CI_SERVER_HOST}/\${CI_PROJECT_PATH}.git"
        npx ${cli} update --publish --to "\${GOODFELLOW_UPDATE:-automatic}" || echo "The update wasn't published; rebuilding the site as it is."
      fi
    # Cloudflare builds an update that was published by itself, so this is for when there wasn't one.
    - |
      if [ "$(git ls-remote origin "refs/heads/$CI_COMMIT_BRANCH" | cut -f1)" != "$CI_COMMIT_SHA" ]; then
        echo "Cloudflare builds the update that was published."
      elif [ -z "$${CLOUDFLARE_DEPLOY_HOOK}" ]; then
        echo "Add the Cloudflare Pages project's deploy hook as this project's ${CLOUDFLARE_DEPLOY_HOOK} variable."
        exit 1
      else
        curl --fail --silent --show-error --request POST "$${CLOUDFLARE_DEPLOY_HOOK}"
      fi
  rules:
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH && ($CI_PIPELINE_SOURCE == "schedule" || $GOODFELLOW_UPDATE)
`;
}

/** The setup files a site Cloudflare Pages serves gets, by path, in place of the template's hosts' ones. */
export function cloudflareSetupFiles(setup: CloudflareSetup): Map<string, string> {
  const files = new Map<string, string>();
  if (setup.git !== "gitlab") {
    files.set(GITHUB_WORKFLOW, githubWorkflow(setup));
    files.set(GITHUB_SCHEDULED_WORKFLOW, githubScheduledWorkflow(setup));
  }
  if (setup.git !== "github") files.set(GITLAB_CI, gitlabPipeline(setup));
  return files;
}

/** The setup files that name the host a site is built on, where it isn't the git host's own Pages. */
const OUTSIDE_HOST_FILES = [
  GITHUB_WORKFLOW,
  GITHUB_SCHEDULED_WORKFLOW,
  ".github/workflows/update.yml",
  ".github/workflows/rebuild.yml",
  GITLAB_CI,
  "vercel.ts",
];

/**
 * Which host outside GitHub and GitLab builds a site, as its setup files say:
 * Cloudflare Pages where they use its deploy hook, Vercel where they use its
 * own or the site has `vercel.ts`, or `undefined` for neither (or none known).
 */
export async function outsideHost(
  read: (path: string) => Promise<string | undefined>,
): Promise<"cloudflare-pages" | "vercel" | undefined> {
  const files = await Promise.all(OUTSIDE_HOST_FILES.map((path) => read(path).catch(() => undefined)));
  if (files.some((text) => text?.includes(CLOUDFLARE_DEPLOY_HOOK))) return "cloudflare-pages";
  const vercel = files.at(-1) !== undefined || files.some((text) => text?.includes("VERCEL_DEPLOY_HOOK"));
  return vercel ? "vercel" : undefined;
}
