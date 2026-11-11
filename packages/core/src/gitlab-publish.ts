/**
 * How sites' GitLab pipelines publish what their own jobs change, the nightly
 * update and the lockfile a plugin needs. GitLab gives every job in a project
 * the same token, so a job that runs the site's packages' code never
 * publishes: the prepare job (`PREPARE_JOB`) commits, and leaves its commits
 * as `PUBLISH_PATCH`; the publish job (`PUBLISH_JOB`), which runs none of the
 * site's code, checks them with `UPDATE_CHECK`, as GitHub's `publish-update`
 * job does, and pushes them with a deploy key only it has: its private half is
 * the `DEPLOY_KEY_VARIABLE` variable, protected and scoped to the
 * `PUBLISH_ENVIRONMENT` environment, which only that job names. The admin
 * panel's Updates screen makes the key (`gitlabUpdates().enable()`). The
 * starters' pipelines have these jobs as written here, which a test checks.
 *
 * The prepare job's artifacts are files only, never a dotenv report, since a
 * report's variables would reach the publish job and could change what it runs.
 */
import { UPDATE_CHECK } from "./github-workflows.js";
import { gitlabLockfileScript } from "./lockfile-setup.js";

/** The environment whose jobs get the publishing key: only `PUBLISH_JOB` names it. */
export const PUBLISH_ENVIRONMENT = "goodfellow-publish";
/** The CI/CD variable holding the deploy key's private half, base64-encoded so GitLab can mask it. */
export const DEPLOY_KEY_VARIABLE = "GOODFELLOW_DEPLOY_KEY";
/** The deploy key's title in the project's settings, by which the Updates screen finds it again. */
export const DEPLOY_KEY_TITLE = "Goodfellow publishing";
/** The commits the prepare job made, as `git format-patch` writes them, for the publish job. */
export const PUBLISH_PATCH = "goodfellow-publish.patch";
/** Whether the prepare job found the site needs building, `true` or `false`, for the pages job. */
export const BUILD_DECISION = "goodfellow-build.txt";
/** The job that writes the lockfile and makes the update, committing them. */
export const PREPARE_JOB = "prepare";
/** The job that checks and publishes them. */
export const PUBLISH_JOB = "publish";
/** What a pipeline with the publish job has, by which `gitlabUpdates()` tells it from older setups. */
export const PUBLISH_MARK = `name: ${PUBLISH_ENVIRONMENT}`;

const NPM_CACHE = `  cache:
    key:
      files: [package-lock.json]
    paths: [.npm/]
`;

export interface PrepareJobOptions {
  /** The script's first steps, indented as a job's script lines are, such as `gitlabLockfileScript()`. */
  before?: string;
  /**
   * The step that decides, setting `update` (and `build`, for the pages job)
   * to `true` or `false`, installing the site's packages where it needs them.
   */
  decide: string;
  /** The update command, such as `npx goodfellow update`, which the job runs with `--commit`. */
  update: string;
  /** Writes `BUILD_DECISION` for the job that builds the site. */
  decision?: boolean;
  /** The job's `rules:` lines. */
  rules: string;
  /** Lines of the job's own, such as `cache:`, which default to npm's cache. */
  cache?: string;
}

/**
 * The prepare job: writes the lockfile and makes the update, as commits, and
 * leaves them for the publish job, since it runs the site's code and so can't
 * be trusted to publish. A failed update leaves the site as it is.
 */
export function gitlabPrepareJob({ before, decide, update, decision, rules, cache }: PrepareJobOptions): string {
  return `${PREPARE_JOB}:
  image: node:22
  stage: build
${cache ?? NPM_CACHE}  script:
${before ?? ""}${decide}    - |
      if [ "$update" = true ]; then
        [ -d node_modules ] || npm ci --cache .npm --prefer-offline
        ${update} --commit --to "\${GOODFELLOW_UPDATE:-automatic}" || echo "The update wasn't made; the site stays as it is."
      fi
${decision ? `    - echo "$build" > ${BUILD_DECISION}\n` : ""}    # What this job committed, for the publish job to check and publish: this job ran the site's code, so it can't.
    - git format-patch --binary --stdout "$CI_COMMIT_SHA..HEAD" > ${PUBLISH_PATCH}
  artifacts:
    paths: [${PUBLISH_PATCH}${decision ? `, ${BUILD_DECISION}` : ""}]
    expire_in: 1 day
  # A newer publish cancels it ("Auto-cancel redundant pipelines" under
  # Settings → CI/CD → General pipelines, on by default).
  interruptible: true
  rules:
${rules}`;
}

export interface PublishJobOptions {
  /** The job's `rules:` lines, the same as the prepare job's. */
  rules: string;
  /** Shell lines, indented as the script's own are, for when the prepare job committed nothing. */
  unpublished?: string;
}

/**
 * The publish job: applies the prepare job's commits, checks they change only
 * what an update or a lockfile does, and pushes them over SSH with the deploy
 * key, which no other job has. It runs none of the site's code, and runs git
 * and Node.js with only the variables they need, so a variable a pipeline was
 * started with can't change what they run. Where it can't publish, the jobs
 * after it build the site as it is.
 */
export function gitlabPublishJob({ rules, unpublished }: PublishJobOptions): string {
  return `${PUBLISH_JOB}:
  image: node:22
  stage: test
  needs:
    - job: ${PREPARE_JOB}
      artifacts: true
  # Only jobs in this environment, on protected branches, get ${DEPLOY_KEY_VARIABLE}: the private half of
  # the deploy key the admin panel's Updates screen adds, which can publish to this project. Nothing in this
  # job runs the site's code.
  environment:
    name: ${PUBLISH_ENVIRONMENT}
    action: prepare
  allow_failure: true
  script:
    - |
      run() { env -i HOME=/tmp PATH=/usr/local/bin:/usr/bin:/bin "$@"; }
      if [ -f ${PUBLISH_PATCH} ] && [ ! -L ${PUBLISH_PATCH} ] && [ -s ${PUBLISH_PATCH} ]; then
        run git -c user.name="Goodfellow" -c user.email=publish@goodfellow.invalid am ${PUBLISH_PATCH}
        # The commits were made where the site's code ran, so only what an update or a lockfile changes is published.
        run BASE="$CI_COMMIT_SHA" node -e '${UPDATE_CHECK}'
        if [ -z "$${DEPLOY_KEY_VARIABLE}" ]; then
          echo "Nothing was published, since this job has no key to publish with: turn on updates on the admin panel's Updates screen, which adds one."
          exit 1
        fi
        key="$(mktemp)"
        trap 'rm -f "$key"' EXIT
        printf '%s' "$${DEPLOY_KEY_VARIABLE}" | base64 -d > "$key"
        chmod 600 "$key"
        run GIT_SSH_COMMAND="ssh -i $key -o IdentitiesOnly=yes -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=/tmp/known_hosts -p \${CI_SERVER_SHELL_SSH_PORT:-22}" git push "git@\${CI_SERVER_SHELL_SSH_HOST:-$CI_SERVER_HOST}:\${CI_PROJECT_PATH}.git" "HEAD:refs/heads/$CI_COMMIT_BRANCH"
${unpublished ? `      else\n${unpublished}` : ""}      fi
  rules:
${rules}`;
}

/**
 * Whether the site needs building where the branch is still the commit this
 * pipeline started at: once the publish job publishes, the pipeline its
 * publish starts builds the site with what it published.
 */
export const GITLAB_BRANCH_MOVED = `head="$(git ls-remote origin "refs/heads/$CI_COMMIT_BRANCH" | cut -f1)"
      if [ -n "$head" ] && [ "$head" != "$CI_COMMIT_SHA" ]; then
        echo "A newer version has been published, which its own pipeline builds."
        build=false
      fi`;

export interface PagesJobOptions {
  /** The build command, such as `npx goodfellow build`. */
  build: string;
  /** The folder the build writes. */
  output: string;
  /** The cache's paths, such as `.npm/`. */
  cachePaths: string;
}

/**
 * The GitLab Pages job, after the prepare and publish jobs: builds the site, or
 * publishes the live site's files again, which GitLab Pages needs of a pages
 * job, where the prepare job found nothing has changed or a newer version has
 * been published.
 */
export function gitlabPagesJob({ build, output, cachePaths }: PagesJobOptions): string {
  return `pages:
  image: node:22
  stage: deploy
  # Where the prepare and publish jobs run: on scheduled pipelines, with an update, and when package.json changes.
  needs:
    - job: ${PREPARE_JOB}
      artifacts: true
      optional: true
    - job: ${PUBLISH_JOB}
      artifacts: false
      optional: true
  cache:
    key:
      files: [package-lock.json]
    paths: [${cachePaths}]
  script:
    - |
      build="$(cat ${BUILD_DECISION} 2>/dev/null || echo true)"
      ${GITLAB_BRANCH_MOVED}
${gitlabLockfileScript({ build: true })}    - |
      if [ "$build" = false ] && curl --fail --silent --show-error --location --header "JOB-TOKEN: $CI_JOB_TOKEN" --output live.zip "$CI_API_V4_URL/projects/$CI_PROJECT_ID/jobs/artifacts/$CI_DEFAULT_BRANCH/download?job=pages" && unzip -q -o live.zip; then
        echo "Publishing the live site's files again, since they're still current."
      else
        npm ci --cache .npm --prefer-offline
        # Pages may serve the site from a subfolder, such as https://group.gitlab.io/site/.
        export GOODFELLOW_BASE="$(node -e 'console.log(new URL(process.env.CI_PAGES_URL).pathname)')"
        ${build}
      fi
  pages:
    publish: ${output}
  # A newer publish cancels this build while it runs ("Auto-cancel redundant
  # pipelines" under Settings → CI/CD → General pipelines, on by default) and
  # builds the site with both, so publishes in quick succession mostly cost one
  # build. A nightly update it cancels runs again the next night.
  interruptible: true
  rules:
    - if: $GOODFELLOW_TASK_PLUGIN
      when: never
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
`;
}

/**
 * The rules of the prepare and publish jobs on the default branch: with an
 * update to make, on the nightly schedule, and when `package.json` changes,
 * which may need the lockfile written; `also` adds rules of a pipeline's own.
 */
export function gitlabPublishRules(also = ""): string {
  return `    - if: $GOODFELLOW_TASK_PLUGIN
      when: never
    - if: $CI_COMMIT_BRANCH != $CI_DEFAULT_BRANCH
      when: never
    - if: $GOODFELLOW_UPDATE
${also}    - if: $CI_PIPELINE_SOURCE == "schedule" && $GOODFELLOW_SCHEDULED_CHANGE == null
    - if: $CI_PIPELINE_SOURCE == "push"
      changes: [package.json]
`;
}

/** The decision of a GitLab Pages site's prepare job: on scheduled pipelines, the nightly check. */
export function gitlabPagesDecision(cli: string): string {
  return `    - |
      build=true
      update=false
      if [ -n "$GOODFELLOW_UPDATE" ]; then
        update=true
      elif [ "$CI_PIPELINE_SOURCE" = "schedule" ] && [ -z "$GOODFELLOW_SCHEDULED_CHANGE" ]; then
        npm ci --cache .npm --prefer-offline
        # Sets build and update; where it can't tell, the site is updated and built as before.
        npx ${cli} nightly --output nightly.env && . ./nightly.env || update=true
      fi
`;
}

/**
 * The decision of the prepare job where another host builds the site itself
 * from every publish, through a deploy hook otherwise: on the nightly schedule,
 * the nightly check, and on pipelines for scheduled changes and the Updates
 * screen's Rebuild now, a rebuild.
 */
export function gitlabHookDecision(cli: string): string {
  return `    - |
      build=true
      update=false
      if [ -n "$GOODFELLOW_UPDATE" ]; then
        update=true
      elif [ "$CI_PIPELINE_SOURCE" = "push" ]; then
        # The host builds every publish itself.
        build=false
      elif [ -z "$GOODFELLOW_SCHEDULED_CHANGE" ] && [ -z "$GOODFELLOW_REBUILD" ]; then
        npm ci --cache .npm --prefer-offline
        # Sets build and update; where it can't tell, the site is updated and rebuilt as before.
        npx ${cli} nightly --output nightly.env && . ./nightly.env || update=true
      fi
`;
}

/**
 * The publish job's lines for when there was nothing to publish, where another
 * host builds the site: it asks the host to rebuild it through its deploy hook
 * (the `hook` variable), where the prepare job found it needs building. What
 * the publish job publishes, the host builds itself.
 */
export function gitlabHookUnpublished(hook: string, hookName: string, short: string): string {
  return `        if [ "$(cat ${BUILD_DECISION} 2>/dev/null)" != true ]; then
          echo "Not rebuilding the site, since nothing has changed since it was built."
        elif [ -z "$${hook}" ]; then
          echo "Add ${hookName} as this project's ${hook} variable."
          exit 1
        else
          echo "Asking ${short} to rebuild the site."
          curl --fail --silent --show-error --request POST "$${hook}"
        fi
`;
}

export interface PagesPipelineOptions extends PagesJobOptions {
  /** The command line tool, `goodfellow` or `goodfellow-next`. */
  cli: string;
}

/** A GitLab Pages site's prepare, publish and pages jobs, as the starters' `.gitlab-ci.yml` has them. */
export function gitlabPagesPipelineJobs(options: PagesPipelineOptions): string {
  const rules = gitlabPublishRules();
  return `${gitlabPrepareJob({
    before: gitlabLockfileScript(),
    decide: gitlabPagesDecision(options.cli),
    update: `npx ${options.cli} update`,
    decision: true,
    rules,
  })}
${gitlabPublishJob({ rules })}
${gitlabPagesJob(options)}`;
}
