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
        run: |
          if node -e "$CHECK"; then
            echo "changed=false" >> "$GITHUB_OUTPUT"
          else
            ${LOCKFILE_COMMAND}
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
        ${LOCKFILE_COMMAND}
        git remote set-url origin "https://gitlab-ci-token:\${CI_JOB_TOKEN}@\${CI_SERVER_FQDN:-$CI_SERVER_HOST}/\${CI_PROJECT_PATH}.git"
        git ${COMMIT_AS} commit -m "${COMMIT_MESSAGE}" package-lock.json
        git push${skipPipeline ? " -o ci.skip" : ""} origin "HEAD:$CI_COMMIT_BRANCH" || echo "package-lock.json wasn't published: turn on \\"Allow Git push requests to the repository\\" under Settings → CI/CD → Job token permissions."
      fi
`;
}
