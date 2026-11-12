/**
 * The setup file of a site stored on Bitbucket: `bitbucket-pipelines.yml`.
 * Bitbucket's own static websites have one address for each workspace and no
 * custom domains, and Cloudflare Pages doesn't build from Bitbucket, so Vercel
 * builds and serves the site, from its Bitbucket integration, whenever the
 * main branch changes. Vercel can't build on a schedule, so Bitbucket
 * Pipelines runs the nightly update, the rebuilds for scheduled changes and
 * plugins' tasks, and asks Vercel to rebuild the site through the project's
 * deploy hook when there's nothing new for it to build. Pipelines' schedules
 * can't be written in the file, so the admin panel adds them: the Updates
 * screen the nightly one (`BITBUCKET_SCHEDULES`), and the backend's
 * `scheduledBuilds.sync()` one for each scheduled change, pinned to its
 * minute. `planSite()` writes the file for new sites, so `create-goodfellow`
 * makes the same one every time.
 */

import { UPDATE_CHECK } from "./github-workflows.js";
import { BUILD_DECISION, PUBLISH_PATCH } from "./gitlab-publish.js";
import {
  EARLY_CHECK,
  EARLY_COMMAND,
  LOCKFILE_CHECK,
  LOCKFILE_COMMAND,
  LOCKFILE_REGISTRY_CHECK,
} from "./lockfile-setup.js";
import { RELEASE_AGE_DAYS } from "./npm-packages.js";
import { TASK_BRANCH_PREFIX, TASK_JOB, TASK_RESULT_FILE } from "./plugin-tasks.js";
import { type SiteCli, TASK_DESCRIPTION, taskRunner, taskRunnerInstall } from "./task-setup.js";

/** Bitbucket Pipelines' setup file. */
export const BITBUCKET_PIPELINES = "bitbucket-pipelines.yml";

/** The repository variable that holds the Vercel project's deploy hook. */
export const VERCEL_DEPLOY_HOOK = "VERCEL_DEPLOY_HOOK";

/**
 * The custom pipelines the admin panel starts, and its schedules run: the
 * nightly update, which also rebuilds (`GOODFELLOW_REBUILD`) and updates to a
 * release (`GOODFELLOW_UPDATE`); the rebuild for a scheduled change, which
 * a schedule pinned to its minute runs; plugins' tasks; and, in a content
 * repository, the nightly rebuild.
 */
export const BITBUCKET_PIPELINE_NAMES = {
  update: "update",
  scheduled: "scheduled",
  task: TASK_JOB,
  rebuild: "rebuild",
} as const;

/**
 * The nightly schedule, as Bitbucket's seven-field cron pattern (seconds first,
 * the year last), in UTC: each night at the time the starters' GitHub workflow
 * runs. The Updates screen adds it.
 */
export const BITBUCKET_SCHEDULES = {
  update: "0 17 4 * * ? *",
} as const;

/**
 * The cron pattern of a schedule that runs once, at an instant's minute in
 * UTC, pinned to its year. Bitbucket has no schedules that run only once, so
 * `scheduledBuilds.sync()` also removes them once they've passed.
 */
export function bitbucketCronAt(at: Date): string {
  return `0 ${at.getUTCMinutes()} ${at.getUTCHours()} ${at.getUTCDate()} ${at.getUTCMonth() + 1} ? ${at.getUTCFullYear()}`;
}

/** The instant a pattern `bitbucketCronAt()` wrote runs at, or nothing for any other pattern. */
export function bitbucketCronInstant(pattern: string): Date | undefined {
  const match = /^0 (\d{1,2}) (\d{1,2}) (\d{1,2}) (\d{1,2}) \? (\d{4})$/.exec(pattern.trim());
  if (!match) return undefined;
  const [, minute, hour, day, month, year] = match.map(Number) as number[];
  return new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day, hour, minute));
}

/** Where the step that only asks Vercel to rebuild runs: Bitbucket's own image, which has curl, cloning nothing, so it takes seconds. */
const HOOK_STEP = `image: atlassian/default-image:4
          clone:
            enabled: false`;

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

/**
 * What a step that runs the site's code may do with the repository: read it.
 * Every step's own token can otherwise publish to it, so a package taken over
 * by someone else could change the site's code; a step that declares its
 * scopes gets only those (Bitbucket's `auth.system.scopes`).
 */
export const BITBUCKET_READ_ONLY = `auth:
            system:
              scopes:
                - read:git:bitbucket`;

/** What a step that publishes, and runs none of the site's code, may do: read and publish. */
export const BITBUCKET_PUBLISHES = `auth:
            system:
              scopes:
                - read:git:bitbucket
                - write:git:bitbucket`;

/** The end of a step that commits what the site's code made, for the next step to check and publish. */
const LEAVE_PATCH = `            # What this step committed, for the next to check and publish: this one ran the site's code, so it can't.
            - git format-patch --binary --stdout "$BITBUCKET_COMMIT..HEAD" > ${PUBLISH_PATCH}`;

/**
 * A step that publishes what the step before it committed, running none of
 * the site's code: it applies the commits, checks they change only what an
 * update or a lockfile does (`UPDATE_CHECK`), with git and Node.js given only
 * the variables they need, and pushes them. `unpublished` runs where there
 * was nothing to publish.
 */
function publishStep(name: string, condition: string, unpublished?: string): string {
  return `      - step:
          name: ${name}
          ${BITBUCKET_PUBLISHES}
${condition}          script:
            - |
              run() { env -i HOME=/tmp PATH=/usr/local/bin:/usr/bin:/bin "$@"; }
              if [ -f ${PUBLISH_PATCH} ] && [ ! -L ${PUBLISH_PATCH} ] && [ -s ${PUBLISH_PATCH} ]; then
                run git -c user.name="Goodfellow" -c user.email=publish@goodfellow.invalid am ${PUBLISH_PATCH}
                # The commits were made where the site's code ran, so only what an update or a lockfile changes is published.
                run BASE="$BITBUCKET_COMMIT" node -e '${UPDATE_CHECK}'
                git push origin "HEAD:refs/heads/$BITBUCKET_BRANCH"
${unpublished ? `              else\n${unpublished}` : ""}              fi`;
}

/** Only when package.json changed, since a skipped step uses no build minutes. */
const PACKAGE_CHANGED = `          condition:
            changesets:
              includePaths:
                - package.json
`;

/** Asks Vercel to rebuild the site, or says how to give the pipeline the hook. */
const REBUILD = `if [ -z "$${VERCEL_DEPLOY_HOOK}" ]; then
                echo "Add the Vercel project's deploy hook as the repository variable ${VERCEL_DEPLOY_HOOK}."
                exit 1
              fi
              curl --fail --silent --show-error --request POST "$${VERCEL_DEPLOY_HOOK}"`;

/** `REBUILD` where the publish step has it, four spaces further in. */
const REBUILD_IN_PUBLISH = REBUILD.replaceAll("\n              ", "\n                  ");

/** A step that only asks Vercel to rebuild the site. */
export function bitbucketRebuildStep(name: string): string {
  return `      - step:
          name: ${name}
          ${HOOK_STEP}
          script:
            - |
              ${REBUILD}`;
}

/** The setup file of a site stored on Bitbucket and built by Vercel. */
export function bitbucketPipelines(cli: SiteCli): string {
  const { update, scheduled, task } = BITBUCKET_PIPELINE_NAMES;
  return `${comment(
    `Vercel builds and publishes the site whenever the main branch changes (including every Publish in the admin panel). These pipelines keep it current, and run plugins' tasks. The first runs only when package.json changes, and the others only when started: the admin panel's Updates screen adds a schedule for "${update}" each night (Pipelines → Schedules), the admin panel adds a schedule for "${scheduled}" at each time a page or item is to be shown or hidden, and it starts "${update}" and "${task}" when an owner or editor asks. "${update}" and "${task}" take about a minute of Bitbucket's build minutes each, of which the free plan has 50 a month; "${scheduled}" takes seconds.
"${update}" checks whether the site needs building: when Goodfellow has new fixes, which it installs and publishes only if the site still builds with them, unless content/updates.json turns automatic updates off; when something the site shows by today's date, such as an event, has changed; or when the live site isn't the newest build. When it needs building but there's no update to publish, it asks Vercel to rebuild the site. The repository variable GOODFELLOW_NIGHTLY, which the Updates screen sets, can make it rebuild every night ("always") or not at all ("off"). "${scheduled}" asks Vercel to rebuild the site, at the time a page or item scheduled to be shown or hidden comes due; each of its schedules runs once, and the admin panel removes it once it has passed.
They ask Vercel through the project's deploy hook (in Vercel, the project's Settings → Git → Deploy Hooks, for the main branch), which can only start builds: add it as the secured repository variable ${VERCEL_DEPLOY_HOOK} (Repository settings → Pipelines → Repository variables). Pipelines must be turned on (Repository settings → Pipelines → Settings). Every step gets the repository's variables, so keep only what the site needs there. Steps that run the site's code can only read the repository (their auth scopes): what they commit, the next step, which runs none of it, checks and publishes. Where the main branch has branch restrictions, add main under its Pipelines write access, so that step can publish. See README.md.`,
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
          ${BITBUCKET_READ_ONLY}
          # Only when package.json changed, since a skipped step uses no build minutes.
${PACKAGE_CHANGED}          script:
            # When package.json names packages package-lock.json doesn't have, such as a plugin installed from the
            # admin panel: writes package-lock.json, installing nothing and running none of the packages' code,
            # with releases at least ${RELEASE_AGE_DAYS} days old for what it adds, for the next step to publish,
            # which Vercel then builds.
            - |
              if node -e '${LOCKFILE_CHECK}'; then
                echo "package-lock.json has every package package.json names."
              else
                if node -e '${EARLY_CHECK}'; then
                  ${LOCKFILE_COMMAND} || exit 1
                else
                  # A plugin installed before it was ${RELEASE_AGE_DAYS} days old: checked against its provenance
                  # first, and the step fails, publishing nothing, if it doesn't check out.
                  ${EARLY_COMMAND} || exit 1
                fi
                # Only packages from npm's registry, or the step fails, publishing nothing.
                node -e '${LOCKFILE_REGISTRY_CHECK}' || exit 1
                git ${COMMIT_AS} commit -m "Write package-lock.json for the packages package.json names" package-lock.json
              fi
${LEAVE_PATCH}
          artifacts:
            - ${PUBLISH_PATCH}
${publishStep("Publish the lockfile", PACKAGE_CHANGED)}

  custom:
    ${update}:
      - variables:
          - name: GOODFELLOW_UPDATE
            default: ""
          - name: GOODFELLOW_REBUILD
            default: ""
      - step:
          name: Update
          ${BITBUCKET_READ_ONLY}
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
                npx ${cli} update --commit --to "\${GOODFELLOW_UPDATE:-automatic}" || echo "The update wasn't made; rebuilding the site as it is."
              fi
            - echo "$build" > ${BUILD_DECISION}
${LEAVE_PATCH}
          artifacts:
            - ${PUBLISH_PATCH}
            - ${BUILD_DECISION}
${publishStep(
  "Publish and rebuild",
  "",
  `                # Vercel builds what's published by itself, so this is for when nothing was.
                if [ "$(cat ${BUILD_DECISION} 2>/dev/null)" != true ]; then
                  echo "Not rebuilding the site, since nothing has changed since it was built."
                else
                  ${REBUILD_IN_PUBLISH}
                fi
`,
)}

    ${scheduled}:
${bitbucketRebuildStep("Scheduled change")}

    ${task}:
      # Runs a plugin's task for the admin panel, such as S3 storage signing uploads with keys kept in the
      # repository's variables: the first step loads the site's config and writes down the task, and the second
      # runs it from Goodfellow's task runner, installed from npm apart from the site's packages, which gives each
      # task only the variables its plugin declared. Bitbucket gives every step the repository's variables. The
      # admin panel starts it with these variables, and it leaves the answer, sealed to a key only that admin
      # panel holds, on a branch of its own, which the admin panel reads and deletes.
      - variables:
          - name: GOODFELLOW_TASK_REQUEST
          - name: GOODFELLOW_TASK_PLUGIN
          - name: GOODFELLOW_TASK_NAME
          - name: GOODFELLOW_TASK_INPUT
          - name: GOODFELLOW_TASK_KEY
      - step:
          name: Describe the plugin task
          ${BITBUCKET_READ_ONLY}
          caches: [npm]
          script:
            - npm ci --prefer-offline || true
            - npx ${cli} task --describe --out ${TASK_DESCRIPTION} || true
          artifacts:
            - ${TASK_DESCRIPTION}
      - step:
          name: Plugin task
          ${BITBUCKET_READ_ONLY}
          script:
${taskRunnerInstall("/tmp/goodfellow-runner", "            - ")}
            - npm ci --ignore-scripts
            - ${taskRunner("/tmp/goodfellow-runner")} --description ${TASK_DESCRIPTION} --out "$BITBUCKET_CLONE_DIR/../${TASK_RESULT_FILE}" || true
            - cp "$BITBUCKET_CLONE_DIR/../${TASK_RESULT_FILE}" ${TASK_RESULT_FILE} || echo '{"version":1,"failed":true}' > ${TASK_RESULT_FILE}
          artifacts:
            - ${TASK_RESULT_FILE}
      - step:
          # Leaves the answer for the admin panel, running none of the site's code.
          name: Plugin task's answer
          ${BITBUCKET_PUBLISHES}
          script:
            - |
              case "$GOODFELLOW_TASK_REQUEST" in "" | *[!a-z0-9]*) echo "That isn't a request from the admin panel."; exit 1 ;; esac
              answer="$(mktemp)"
              if [ -f ${TASK_RESULT_FILE} ] && [ ! -L ${TASK_RESULT_FILE} ] && [ -s ${TASK_RESULT_FILE} ]; then
                cp ${TASK_RESULT_FILE} "$answer"
              else
                echo '{"version":1,"failed":true}' > "$answer"
              fi
              git checkout -q --orphan answer
              git rm -rq --cached .
              cp "$answer" ${TASK_RESULT_FILE}
              git add ${TASK_RESULT_FILE}
              git -c user.name="Goodfellow" -c user.email=tasks@goodfellow.invalid commit -q -m "The answer to plugin task $GOODFELLOW_TASK_REQUEST"
              git push -q origin "HEAD:refs/heads/${TASK_BRANCH_PREFIX}$GOODFELLOW_TASK_REQUEST"
`;
}

/**
 * The content repository's `bitbucket-pipelines.yml`, for a site whose content
 * is kept in a repository of its own, which Vercel builds from either
 * repository: the rebuild for each scheduled change, which the admin panel
 * schedules here since it edits this repository, the nightly rebuild, and,
 * where Vercel builds from the code, a rebuild whenever the content changes.
 * Each only asks Vercel to rebuild, so none of them runs the site's code.
 */
export function bitbucketContentPipelines(build: "code" | "content"): string {
  const { scheduled, rebuild } = BITBUCKET_PIPELINE_NAMES;
  const onChange =
    build === "code"
      ? `  branches:
    # The main branch: rename this if yours is called something else.
    main:
${bitbucketRebuildStep("Rebuild on Vercel")}

`
      : "";
  return `${comment(
    `This repository holds only the site's content${build === "code" ? `, and Vercel builds the site from its code repository, so these pipelines ask Vercel to rebuild it whenever the content changes (including every Publish in the admin panel), ` : ", which Vercel builds the site from, so these pipelines ask Vercel to rebuild it "}at the time a page or item scheduled to be shown or hidden comes due ("${scheduled}", which the admin panel schedules for each such time, removing each schedule once it has passed), and each night so what the site shows by today's date stays current ("${rebuild}": add a schedule for it each night under Pipelines → Schedules). Each only asks Vercel to rebuild, so it takes seconds of build minutes and runs none of the site's code.
They ask through the Vercel project's deploy hook (Settings → Git → Deploy Hooks, for the main branch), which can only start builds: add it as the secured repository variable ${VERCEL_DEPLOY_HOOK} (Repository settings → Pipelines → Repository variables), and turn Pipelines on (Repository settings → Pipelines → Settings).`,
  )}
pipelines:
${onChange}  custom:
    ${scheduled}:
${bitbucketRebuildStep("Scheduled change")}

    ${rebuild}:
${bitbucketRebuildStep("Nightly rebuild")}
`;
}

/**
 * The code repository's `bitbucket-pipelines.yml`, where Vercel builds the
 * site from the content repository: a rebuild whenever the code changes.
 */
export function bitbucketCodeRebuildPipelines(content: string): string {
  return `${comment(
    `Vercel builds the site from its content repository, ${content}, so this asks Vercel to rebuild it whenever the code changes, through the Vercel project's deploy hook (Settings → Git → Deploy Hooks), which can only start builds: add it as the secured repository variable ${VERCEL_DEPLOY_HOOK} (Repository settings → Pipelines → Repository variables), and turn Pipelines on (Repository settings → Pipelines → Settings).`,
  )}
pipelines:
  branches:
    # The main branch: rename this if yours is called something else.
    main:
${bitbucketRebuildStep("Rebuild on Vercel")}
`;
}
