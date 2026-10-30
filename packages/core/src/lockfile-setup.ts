/**
 * The parts of sites' workflows that write `package-lock.json` when
 * `package.json` names packages it doesn't have, such as a plugin installed
 * from the admin panel: `npm install --package-lock-only --ignore-scripts`,
 * which installs nothing and runs none of the packages' code, and takes only
 * releases at least `RELEASE_AGE_DAYS` old for what it adds. The starters'
 * workflows have them as written here, which a test checks.
 */
import { RELEASE_AGE_DAYS } from "./npm-packages.js";

/** The job that writes the lockfile, and the job that publishes it without running any of the site's code. */
export const LOCKFILE_JOB = "lockfile";
export const PUBLISH_LOCKFILE_JOB = "publish-lockfile";

/**
 * A Node.js script that exits with 1 when `package.json` names packages, or
 * ranges, that `package-lock.json` doesn't have, as `npm ci` would refuse:
 * read before anything's installed, on one line, with no single quotes.
 */
export const LOCKFILE_CHECK =
  'const fs = require("fs"); const read = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return undefined; } }; const site = read("package.json") || {}; const root = ((read("package-lock.json") || {}).packages || {})[""]; const same = (a, b) => JSON.stringify(Object.entries(a || {}).sort()) === JSON.stringify(Object.entries(b || {}).sort()); process.exit(root && ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].every((key) => same(site[key], root[key])) ? 0 : 1);';

/** Writes the lockfile, taking only releases at least `RELEASE_AGE_DAYS` old for the packages it adds. */
export const LOCKFILE_COMMAND = `npm install --package-lock-only --ignore-scripts --no-audit --no-fund --before="$(date -u -d '${RELEASE_AGE_DAYS} days ago' +%Y-%m-%dT%H:%M:%SZ)"`;

/**
 * A Node.js script, on one line with no single quotes, that exits with 1 when
 * a plugin's record says it was installed before it was `RELEASE_AGE_DAYS`
 * old (`early`), so the lockfile is written by `EARLY_COMMAND` instead.
 */
export const EARLY_CHECK =
  'const fs = require("fs"); let record; try { record = JSON.parse(fs.readFileSync("plugins/installed/installed.json", "utf8")); } catch { process.exit(0); } process.exit(Object.values(record.plugins || {}).some((plugin) => plugin && plugin.early) ? 1 : 0);';

/**
 * A Node.js script, on one line with no single quotes, that prints the
 * release of `@goodfellow-cms/core` the site's `package.json` names, such as
 * `^0.9.0`, and exits with 1 for anything else: a URL, a git repository or an
 * alias there would have npm install whatever it names, where jobs run
 * Goodfellow's own commands from npm rather than the site's packages.
 */
export const CORE_RELEASE = String.raw`const release = (require("./package.json").dependencies || {})["@goodfellow-cms/core"]; if (!/^[~^]?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(release || "")) { console.error("package.json names @goodfellow-cms/core as " + JSON.stringify(release) + ", which is not a release from npm."); process.exit(1); } console.log(release);`;

/** Sets `core` to `CORE_RELEASE`'s release, stopping the job where there's none: a command of its own, since `&&` wouldn't. */
export const CORE_RELEASE_COMMAND = `core=$(node -e '${CORE_RELEASE}') || exit 1`;

/**
 * Writes the lockfile where a plugin was installed early, once its provenance
 * checks out (`goodfellow-early`, `writeEarlyLockfile()`), failing otherwise:
 * run from npm at the release of `@goodfellow-cms/core` the site names, never
 * from the site's own packages, which the lockfile isn't written for yet.
 */
export const EARLY_COMMAND = `${CORE_RELEASE_COMMAND}; npm exec --yes --package="@goodfellow-cms/core@$core" -- goodfellow-early`;

const COMMIT_AS = '-c user.name="Goodfellow" -c user.email=lockfile@goodfellow.invalid';
const COMMIT_MESSAGE = "Write package-lock.json for the packages package.json names";

/**
 * The GitHub jobs: `lockfile` writes it, with a token that can only read,
 * and `publish-lockfile` publishes it and gives its `sha`, which the build
 * then checks out. A push with the workflow's own token starts no other run.
 */
export function githubLockfileJobs(): string {
  return `  ${LOCKFILE_JOB}:
    # When package.json names packages package-lock.json doesn't have, such as a plugin installed from the
    # admin panel: writes package-lock.json, installing nothing and running none of the packages' code, with
    # releases at least ${RELEASE_AGE_DAYS} days old for what it adds. ${PUBLISH_LOCKFILE_JOB} publishes it.
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      changed: \${{ steps.lockfile.outputs.changed }}
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          check-latest: true
      - id: lockfile
        env:
          CHECK: '${LOCKFILE_CHECK}'
          EARLY: '${EARLY_CHECK}'
        run: |
          if node -e "$CHECK"; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
          elif node -e "$EARLY"; then
            ${LOCKFILE_COMMAND}
            echo "changed=true" >> "$GITHUB_OUTPUT"
          else
            # A plugin installed before it was ${RELEASE_AGE_DAYS} days old, which only its provenance allows:
            # checked first, and if it doesn't check out the job fails, publishing nothing.
            ${EARLY_COMMAND}
            echo "changed=true" >> "$GITHUB_OUTPUT"
          fi
      - if: steps.lockfile.outputs.changed == 'true'
        uses: actions/upload-artifact@v4
        with:
          name: lockfile
          path: package-lock.json
          retention-days: 1

  ${PUBLISH_LOCKFILE_JOB}:
    # Publishes the lockfile, without running any of the site's code.
    needs: ${LOCKFILE_JOB}
    if: needs.${LOCKFILE_JOB}.outputs.changed == 'true'
    runs-on: ubuntu-latest
    permissions:
      contents: write
    outputs:
      sha: \${{ steps.publish.outputs.sha }}
    steps:
      - uses: actions/checkout@v5
      - uses: actions/download-artifact@v4
        with:
          name: lockfile
      - id: publish
        run: |
          git add package-lock.json
          git ${COMMIT_AS} commit -m "${COMMIT_MESSAGE}"
          git push origin "HEAD:$GITHUB_REF_NAME"
          echo "sha=$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
`;
}

/** What GitLab's jobs need for `gitlabLockfileScript()`: the check, as a variable. */
export const GITLAB_LOCKFILE_VARIABLES = `variables:
  LOCKFILE_CHECK: '${LOCKFILE_CHECK}'
  EARLY_CHECK: '${EARLY_CHECK}'
`;

/**
 * The GitLab script, before `npm ci`: writes the lockfile and publishes it
 * with the job's token, which needs "Allow Git push requests to the
 * repository", as updates do; where it can't, the job carries on with the
 * lockfile it wrote. `skipPipeline` publishes it without starting a pipeline,
 * for jobs that build the site with it themselves.
 */
export function gitlabLockfileScript({ skipPipeline }: { skipPipeline: boolean }): string {
  return `    # When package.json names packages package-lock.json doesn't have, such as a plugin installed from the
    # admin panel: writes package-lock.json, installing nothing and running none of the packages' code, with
    # releases at least ${RELEASE_AGE_DAYS} days old for what it adds, and publishes it.
    - |
      if ! node -e "$LOCKFILE_CHECK"; then
        # A plugin installed before it was ${RELEASE_AGE_DAYS} days old is checked against its provenance first,
        # and the job fails if it doesn't check out.
        if node -e "$EARLY_CHECK"; then ${LOCKFILE_COMMAND}; else ${EARLY_COMMAND}; fi
        git remote set-url origin "https://gitlab-ci-token:\${CI_JOB_TOKEN}@\${CI_SERVER_FQDN:-$CI_SERVER_HOST}/\${CI_PROJECT_PATH}.git"
        git ${COMMIT_AS} commit -m "${COMMIT_MESSAGE}" package-lock.json
        git push${skipPipeline ? " -o ci.skip" : ""} origin "HEAD:$CI_COMMIT_BRANCH" || echo "package-lock.json wasn't published: turn on \\"Allow Git push requests to the repository\\" under Settings → CI/CD → Job token permissions."
      fi
`;
}
