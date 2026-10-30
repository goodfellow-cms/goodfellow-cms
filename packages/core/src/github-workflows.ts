/**
 * Parts of the GitHub workflows `planSite()` and `separateSetupFiles()` write,
 * kept as the starters' own `deploy.yml` has them: every job gets only the
 * permissions it needs, the jobs that run the site's code can only read the
 * repository and keep no credentials in it, and the jobs that publish run none
 * of the site's code.
 */

/** The job that publishes the update, which the job that builds the site with it can't. */
export const PUBLISH_UPDATE_JOB = "publish-update";

/**
 * The files an update may change (`update()`: `package.json` and its lockfile,
 * the releases it skips, and the site files releases bring, such as the
 * Next.js starter's admin pages), and the folders registry blocks' updates
 * write into. `publish-update` publishes nothing else, since the job that made
 * the update ran the site's code, which could have changed any file.
 */
export const UPDATE_FILES: readonly string[] = [
  "package.json",
  "package-lock.json",
  "content/updates.json",
  "vercel.json",
  "app/admin/page.tsx",
  "app/admin/editor/page.tsx",
];
export const UPDATE_FOLDERS: readonly string[] = ["blocks/installed/", "components/", "lib/", "hooks/"];

/** Where an update's packages may come from. */
export const UPDATE_REGISTRY = "https://registry.npmjs.org/";

/**
 * A Node.js script, on one line with no single quotes, that exits with 1 when
 * the commits since `BASE` change anything but `UPDATE_FILES` and
 * `UPDATE_FOLDERS`' files, as plain files, or have `package-lock.json` take a
 * package from anywhere but npm's registry: run by `publish-update` before it
 * publishes, reading only git, never the site's packages.
 */
export const UPDATE_CHECK = [
  'const { execFileSync } = require("child_process");',
  'const git = (...args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });',
  `const files = ${JSON.stringify(UPDATE_FILES)};`,
  `const folders = ${JSON.stringify(UPDATE_FOLDERS)};`,
  "const refused = [];",
  'const raw = git("diff", "--no-renames", "--raw", "-z", process.env.BASE, "HEAD").split("\\0");',
  "for (let i = 0; i + 1 < raw.length; i += 2) {",
  'const mode = raw[i].split(" ")[1]; const path = raw[i + 1];',
  'const plain = ["000000", "100644", "100755"].includes(mode);',
  "const named = files.includes(path) || folders.some((folder) => path.startsWith(folder));",
  "if (!plain || !named) refused.push(path); }",
  'const found = (value, into) => { if (value && typeof value === "object") for (const [key, item] of Object.entries(value)) { if (key === "resolved") into.add(String(item)); else found(item, into); } return into; };',
  'const lock = (rev) => { try { return JSON.parse(git("show", rev + ":package-lock.json")); } catch { return undefined; } };',
  "const before = found(lock(process.env.BASE), new Set());",
  'for (const address of found(lock("HEAD"), new Set())) {',
  `if (!before.has(address) && !address.startsWith(${JSON.stringify(UPDATE_REGISTRY)})) refused.push("package-lock.json: " + address); }`,
  'for (const path of refused) console.log("::error::The update changed what an update never does, so it was not published: " + path);',
  "process.exit(refused.length > 0 ? 1 : 0);",
].join(" ");

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
  /**
   * The nightly check, such as `npx goodfellow nightly`, which a `check` job
   * runs first each night; without one, the update runs every night.
   */
  nightly?: string;
  /** Steps after the site's own checkout, such as checking out its content. */
  checkout?: string;
  /** Steps after installing its packages, such as copying its content in. */
  prepare?: string;
  /**
   * Whether the workflow has the lockfile jobs (`githubLockfileJobs()`):
   * the update then waits for them, and doesn't run while the lockfile is written.
   */
  lockfile?: boolean;
}

/**
 * The nightly update, in two jobs: `update` installs it and builds the site with
 * it, with a token that can only read the repository, and commits it without
 * publishing it; then `publish-update` publishes that commit, running none of
 * the site's code, and gives its `sha`.
 */
export function githubUpdateJobs({ update, nightly, checkout, prepare, lockfile }: UpdateJobsOptions): string {
  const checkJob = nightly
    ? `  check:
    # Each night, unless GOODFELLOW_NIGHTLY is "off": whether to build the site, and update Goodfellow first.
    if: github.event_name == 'schedule' && vars.GOODFELLOW_NIGHTLY != 'off'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      build: \${{ steps.nightly.outputs.build }}
      update: \${{ steps.nightly.outputs.update }}
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
${checkout ? `${checkout}\n` : ""}${GITHUB_INSTALL_STEPS}
${prepare ? `${prepare}\n` : ""}      - id: nightly
        env:
          GOODFELLOW_NIGHTLY: \${{ vars.GOODFELLOW_NIGHTLY }}
        run: ${nightly}

`
    : "";
  const lockfileWait = lockfile
    ? `
    # Not while the lockfile is being written: the next night's runs it.`
    : "";
  const lockfileCondition = lockfile ? " && needs.lockfile.outputs.changed != 'true'" : "";
  const when = nightly
    ? `    # When the nightly check finds one, and when the admin panel's Updates screen asks. It installs
    # the update and builds the site with it, but can't publish it: ${PUBLISH_UPDATE_JOB} does.${lockfileWait}
    needs: ${lockfile ? "[check, lockfile]" : "check"}
    if: \${{ !cancelled()${lockfileCondition} && ((github.event_name == 'schedule' && needs.check.outputs.update == 'true') || (github.event_name == 'workflow_dispatch' && inputs.update != '')) }}`
    : `    # Each night, and when the admin panel's Updates screen asks. It installs
    # the update and builds the site with it, but can't publish it: ${PUBLISH_UPDATE_JOB} does.
    if: github.event_name == 'schedule' || (github.event_name == 'workflow_dispatch' && inputs.update != '')`;
  return `${checkJob}  update:
${when}
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
        env:
          # The update was made where the site's code ran, so only what an update changes is published.
          CHECK: '${UPDATE_CHECK}'
        run: |
          base=$(git rev-parse HEAD)
          git -c user.name="Goodfellow updates" -c user.email=updates@goodfellow.invalid am "$RUNNER_TEMP/update.patch"
          BASE="$base" node -e "$CHECK"
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

/**
 * The condition of a job that builds the site, or asks a host to, after the
 * nightly check (`githubUpdateJobs({ nightly })`): at night only when the
 * check says so or couldn't tell, and otherwise always. `also` adds to it.
 */
export function nightlyBuildCondition(also = ""): string {
  return `\${{ !cancelled() && (github.event_name != 'schedule' || needs.check.outputs.build == 'true' || needs.check.result == 'failure')${also} }}`;
}
