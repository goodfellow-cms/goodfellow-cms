/**
 * Parts of the GitHub workflows `planSite()` and `separateSetupFiles()` write,
 * kept as the starters' own `deploy.yml` has them: every job gets only the
 * permissions it needs, the jobs that run the site's code can only read the
 * repository and keep no credentials in it, and the jobs that publish run none
 * of the site's code.
 */

/** The job that publishes the update, which the job that builds the site with it can't. */
export const PUBLISH_UPDATE_JOB = "publish-update";

/** The steps that set up Node.js and install the site's packages. */
export const GITHUB_INSTALL_STEPS = `      - uses: actions/setup-node@v5
        with:
          node-version: 22
          check-latest: true
          cache: npm
      - run: npm ci`;

export interface UpdateJobsOptions {
  /** The update command, such as `npx goodfellow update`. */
  update: string;
  /** Steps after the site's own checkout, such as checking out its content. */
  checkout?: string;
  /** Steps after installing its packages, such as copying its content in. */
  prepare?: string;
}

/**
 * The nightly update, in two jobs: `update` installs it and builds the site with
 * it, with a token that can only read the repository, and commits it without
 * publishing it; then `publish-update` publishes that commit, running none of
 * the site's code, and gives its `sha`.
 */
export function githubUpdateJobs({ update, checkout, prepare }: UpdateJobsOptions): string {
  return `  update:
    # Each night, and when the admin panel's Updates screen asks. It installs
    # the update and builds the site with it, but can't publish it: ${PUBLISH_UPDATE_JOB} does.
    if: github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.update != '')
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      commit: \${{ steps.update.outputs.commit }}
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
${checkout ? `${checkout}\n` : ""}${GITHUB_INSTALL_STEPS}
${prepare ? `${prepare}\n` : ""}      - id: update
        env:
          TO: \${{ inputs.update || 'automatic' }}
        run: ${update} --commit --to "$TO"
      - if: steps.update.outputs.commit == 'true'
        run: git format-patch --binary --stdout "$GITHUB_SHA" > update.patch
      - if: steps.update.outputs.commit == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: update
          path: update.patch
          retention-days: 1

  ${PUBLISH_UPDATE_JOB}:
    # Publishes the update the site built with, without running any of its code.
    needs: update
    if: needs.update.outputs.commit == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    outputs:
      sha: \${{ steps.publish.outputs.sha }}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/download-artifact@v4
        with:
          name: update
          path: \${{ runner.temp }}
      - id: publish
        run: |
          git -c user.name="Goodfellow updates" -c user.email=updates@goodfellow.invalid am "$RUNNER_TEMP/update.patch"
          git push origin "HEAD:$GITHUB_REF_NAME"
          echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
`;
}

/** A job that asks Cloudflare Pages to rebuild the site through its deploy hook, running none of the site's code. */
export function cloudflareRebuildSteps(hook: string): string {
  return `      - env:
          HOOK: \${{ secrets.${hook} }}
        run: |
          if [ -z "$HOOK" ]; then
            echo "Add the Cloudflare Pages project's deploy hook as this repository's ${hook} secret."
            exit 1
          fi
          curl --fail --silent --show-error --request POST "$HOOK"`;
}

/**
 * The hourly check for scheduled changes, in two jobs: `check` runs the site's
 * code to find whether one has come due, with a token that can only read, and
 * `start` runs `steps`, which start the build, without any of it.
 */
export function githubScheduledJobs(options: {
  due: string;
  checkout?: string;
  prepare?: string;
  start: string;
}): string {
  return `  check:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      actions: read
    outputs:
      due: \${{ steps.due.outputs.due }}
    steps:
${
  options.checkout ??
  `      - uses: actions/checkout@v5
        with:
          persist-credentials: false`
}
${GITHUB_INSTALL_STEPS}
${options.prepare ? `${options.prepare}\n` : ""}      # Since the last check that worked.
      - id: since
        env:
          GH_TOKEN: \${{ github.token }}
        run: echo "since=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow scheduled.yml --status success --limit 1 --json startedAt --jq '.[0].startedAt' || true)" >> "$GITHUB_OUTPUT"
      - id: due
        env:
          SINCE: \${{ steps.since.outputs.since }}
        run: ${options.due} --since "$SINCE"

  start:
    # Starts the build, without running any of the site's code.
    needs: check
    if: needs.check.outputs.due == 'true'
    runs-on: ubuntu-latest
${options.start}`;
}
