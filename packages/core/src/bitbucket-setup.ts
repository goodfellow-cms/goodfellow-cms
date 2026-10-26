/**
 * The setup file of a site stored on Bitbucket: `bitbucket-pipelines.yml`.
 * Bitbucket's own static websites have one address for each workspace and no
 * custom domains, and Cloudflare Pages doesn't build from Bitbucket, so Vercel
 * builds and serves the site, from its Bitbucket integration, whenever the
 * main branch changes. Vercel can't build on a schedule, so Bitbucket
 * Pipelines runs the nightly update, the check for scheduled changes
 * and plugins' tasks, and asks Vercel to rebuild the site through the
 * project's deploy hook when there's nothing new for it to build. Pipelines'
 * schedules can't be written in the file, so the admin panel's Updates screen
 * adds the nightly one (`BITBUCKET_SCHEDULES`); an hourly one uses more
 * build minutes than Bitbucket's free plan has, so owners add it themselves.
 * `planSite()` writes the file for new sites, so `create-goodfellow` makes the
 * same one every time.
 */

import { LOCKFILE_CHECK, LOCKFILE_COMMAND } from "./lockfile-setup.js";
import { RELEASE_AGE_DAYS } from "./npm-packages.js";
import { TASK_BRANCH_PREFIX, TASK_JOB, TASK_RESULT_FILE } from "./plugin-tasks.js";
import type { SiteCli } from "./task-setup.js";

/** Bitbucket Pipelines' setup file. */
export const BITBUCKET_PIPELINES = "bitbucket-pipelines.yml";

/** The repository variable that holds the Vercel project's deploy hook. */
export const VERCEL_DEPLOY_HOOK = "VERCEL_DEPLOY_HOOK";

/**
 * The custom pipelines the admin panel starts, and its schedules run: the
 * nightly update, which also rebuilds (`GOODFELLOW_REBUILD`) and updates to a
 * release (`GOODFELLOW_UPDATE`); the hourly check for scheduled changes; and
 * plugins' tasks.
 */
export const BITBUCKET_PIPELINE_NAMES = { update: "update", scheduled: "scheduled", task: TASK_JOB } as const;

/**
 * The pipelines' schedules, as Bitbucket's seven-field cron patterns, in UTC:
 * each night at the time the starters' GitHub workflow runs, which the
 * Updates screen adds, and each hour at the minute their hourly check does,
 * which owners add themselves where they have the build minutes.
 */
export const BITBUCKET_SCHEDULES = {
  update: "0 17 4 * * ? *",
  scheduled: "0 47 * * * ? *",
} as const;

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

const COMMIT_AS = '-c user.name="Goodfellow" -c user.email=lockfile@goodfellow.invalid';

/** Asks Vercel to rebuild the site, or says how to give the pipeline the hook. */
const REBUILD = `if [ -z "$${VERCEL_DEPLOY_HOOK}" ]; then
                echo "Add the Vercel project's deploy hook as the repository variable ${VERCEL_DEPLOY_HOOK}."
                exit 1
              fi
              curl --fail --silent --show-error --request POST "$${VERCEL_DEPLOY_HOOK}"`;

/** The setup file of a site stored on Bitbucket and built by Vercel. */
export function bitbucketPipelines(cli: SiteCli): string {
  const { update, scheduled, task } = BITBUCKET_PIPELINE_NAMES;
  return `${comment(
    `Vercel builds and publishes the site whenever the main branch changes (including every Publish in the admin panel). These pipelines keep it current, and run plugins' tasks. The first runs only when package.json changes, and the others only when started: the admin panel's Updates screen adds a schedule for "${update}" each night (Pipelines → Schedules), and starts "${update}" and "${task}" when an owner or editor asks. Each run takes about a minute of Bitbucket's build minutes, of which the free plan has 50 a month.
"${update}" checks whether the site needs building: when Goodfellow has new fixes, which it installs and publishes only if the site still builds with them, unless content/updates.json turns automatic updates off; when something the site shows by today's date, such as an event, has changed; or when the live site isn't the newest build. When it needs building but there's no update to publish, it asks Vercel to rebuild the site. The repository variable GOODFELLOW_NIGHTLY, which the Updates screen sets, can make it rebuild every night ("always") or not at all ("off"). "${scheduled}" asks Vercel to rebuild the site when a page or item scheduled to be shown or hidden has come due. Without a schedule of its own, scheduled changes go live with the nightly rebuild; with one each hour (Pipelines → Schedules → New schedule, the "${scheduled}" pipeline, hourly), they go live within the hour, which uses about 720 build minutes a month, more than the free plan has.
They ask Vercel through the project's deploy hook (in Vercel, the project's Settings → Git → Deploy Hooks, for the main branch), which can only start builds: add it as the secured repository variable ${VERCEL_DEPLOY_HOOK} (Repository settings → Pipelines → Repository variables). Pipelines must be turned on (Repository settings → Pipelines → Settings). Every step gets the repository's variables and can publish to it, so keep only what the site needs there. See README.md.`,
  )}
image: node:22

definitions:
  caches:
    npm: ~/.npm

pipelines:
  branches:
    # The main branch, which the site is built from: rename this if yours is called something else.
    main:
      - step:
          name: Lockfile
          # Only when package.json changed, since a skipped step uses no build minutes.
          condition:
            changesets:
              includePaths:
                - package.json
          script:
            # When package.json names packages package-lock.json doesn't have, such as a plugin installed from the
            # admin panel: writes package-lock.json, installing nothing and running none of the packages' code,
            # with releases at least ${RELEASE_AGE_DAYS} days old for what it adds, and publishes it, which Vercel
            # then builds.
            - |
              if node -e '${LOCKFILE_CHECK}'; then
                echo "package-lock.json has every package package.json names."
              else
                ${LOCKFILE_COMMAND}
                git ${COMMIT_AS} commit -m "Write package-lock.json for the packages package.json names" package-lock.json
                git push origin "HEAD:$BITBUCKET_BRANCH"
              fi

  custom:
    ${update}:
      - variables:
          - name: GOODFELLOW_UPDATE
            default: ""
          - name: GOODFELLOW_REBUILD
            default: ""
      - step:
          name: Update and rebuild
          caches: [npm]
          script:
            - |
              build=true
              update=false
              if [ -n "$GOODFELLOW_UPDATE" ]; then
                update=true
              elif [ -z "$GOODFELLOW_REBUILD" ]; then
                npm ci --prefer-offline
                # Sets build and update; where it can't tell, the site is updated and rebuilt as before.
                npx ${cli} nightly --output nightly.env && . ./nightly.env || update=true
              fi
            - |
              if [ "$update" = true ]; then
                [ -d node_modules ] || npm ci --prefer-offline
                npx ${cli} update --publish --to "\${GOODFELLOW_UPDATE:-automatic}" || echo "The update wasn't published; rebuilding the site as it is."
              fi
            # Vercel builds an update that was published by itself, so this is for when there wasn't one.
            - |
              if [ "$build" = false ] && [ "$update" = false ]; then
                echo "Not rebuilding the site, since nothing has changed since it was built."
              elif [ "$(git ls-remote origin "refs/heads/$BITBUCKET_BRANCH" | cut -f1)" != "$BITBUCKET_COMMIT" ]; then
                echo "Vercel builds the update that was published."
              else
                ${REBUILD}
              fi

    ${scheduled}:
      - step:
          name: Scheduled changes
          caches: [npm]
          script:
            - npm ci --prefer-offline
            - npx ${cli} due --since "$(date -u -d '70 minutes ago' +%Y-%m-%dT%H:%M:%SZ)" --output due.env && . ./due.env
            - |
              if [ "$due" = true ]; then
                ${REBUILD}
              fi

    ${task}:
      # Runs a plugin's task for the admin panel, such as S3 storage signing uploads with keys kept in the
      # repository's variables, each task getting only those its plugin declared. The admin panel starts it with
      # these variables, and it leaves the answer, sealed to a key only that admin panel holds, on a branch of its
      # own, which the admin panel reads and deletes.
      - variables:
          - name: GOODFELLOW_TASK_REQUEST
          - name: GOODFELLOW_TASK_PLUGIN
          - name: GOODFELLOW_TASK_NAME
          - name: GOODFELLOW_TASK_INPUT
          - name: GOODFELLOW_TASK_KEY
      - step:
          name: Plugin task
          caches: [npm]
          script:
            - npm ci --prefer-offline
            - npx ${cli} task --out "$BITBUCKET_CLONE_DIR/../${TASK_RESULT_FILE}" || true
            - |
              case "$GOODFELLOW_TASK_REQUEST" in "" | *[!a-z0-9]*) echo "That isn't a request from the admin panel."; exit 1 ;; esac
              answer="$BITBUCKET_CLONE_DIR/../${TASK_RESULT_FILE}"
              [ -s "$answer" ] || echo '{"version":1,"failed":true}' > "$answer"
              git checkout -q --orphan answer
              git rm -rq --cached .
              cp "$answer" ${TASK_RESULT_FILE}
              git add ${TASK_RESULT_FILE}
              git -c user.name="Goodfellow" -c user.email=tasks@goodfellow.invalid commit -q -m "The answer to plugin task $GOODFELLOW_TASK_REQUEST"
              git push -q origin "HEAD:refs/heads/${TASK_BRANCH_PREFIX}$GOODFELLOW_TASK_REQUEST"
`;
}
