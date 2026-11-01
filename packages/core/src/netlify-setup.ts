/**
 * The setup files of a site Netlify serves. Netlify builds the site itself
 * whenever its repository changes, as Cloudflare Pages does, so it gets the
 * same GitHub workflows or GitLab pipeline for the nightly update and
 * scheduled changes, which ask Netlify to rebuild through a build hook, and
 * `netlify.toml`, Netlify's own settings, which never builds drafts or
 * plugins' tasks. `planSite()` writes them for new sites.
 */

import { type CloudflareSetup, type HookHost, hookHostSetupFiles } from "./cloudflare-setup.js";

/** The secret (GitHub) or variable (GitLab) that holds the site's Netlify build hook. */
export const NETLIFY_BUILD_HOOK = "NETLIFY_BUILD_HOOK";

/** Netlify's settings file, at the site's root. */
export const NETLIFY_TOML = "netlify.toml";

/** Netlify, as the setup files name it. */
export const NETLIFY_HOOK_HOST: HookHost = {
  label: "Netlify",
  short: "Netlify",
  hook: NETLIFY_BUILD_HOOK,
  hookWhere:
    "the site's build hook (in Netlify, the site's Project configuration → Build & deploy → Build hooks, for the main branch), which can only start builds",
  hookName: "the Netlify site's build hook",
};

/**
 * Branches Netlify never builds: drafts waiting for review and plugins'
 * tasks, since a deploy preview would build what's submitted with the site's
 * environment variables.
 */
export const NETLIFY_SKIPPED_BRANCHES = ["goodfellow-draft-*", "goodfellow-task-*"];

/**
 * `netlify.toml`: the build command and folder, Node 22, the branches it
 * leaves alone, and, for a Next.js site, no Netlify Next.js runtime, since the
 * site is exported as static files.
 */
export function netlifyToml({ next }: Pick<CloudflareSetup, "next">): string {
  const cli = next ? "goodfellow-next" : "goodfellow";
  return `# Netlify's settings for this site. Netlify builds and publishes it whenever the
# main branch changes (including every Publish in the admin panel); see README.md.
[build]
  command = "npm run build"
  publish = "${next ? "out" : "dist"}"
  # Never builds drafts waiting for review or plugins' tasks, which a deploy
  # preview would build with the site's environment variables. Exiting 0 skips
  # the build; anything else builds.
  ignore = 'case "$BRANCH" in ${NETLIFY_SKIPPED_BRANCHES.join("|")}) exit 0;; *) exit 1;; esac'

[build.environment]
  NODE_VERSION = "22"
  # Tells \`${cli} build\` the site is on Netlify, so its header rules suit Netlify.
  GOODFELLOW_HOST = "netlify"${
    next
      ? `
  # The site is exported as static files, so it needs no Netlify Next.js runtime.
  NETLIFY_NEXT_PLUGIN_SKIP = "true"`
      : ""
  }
`;
}

/** The setup files a site Netlify serves gets, by path, in place of the template's hosts' ones. */
export function netlifySetupFiles(setup: CloudflareSetup): Map<string, string> {
  const files = hookHostSetupFiles(setup, NETLIFY_HOOK_HOST);
  files.set(NETLIFY_TOML, netlifyToml(setup));
  return files;
}
