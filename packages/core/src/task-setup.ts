/**
 * The setup files that run plugins' tasks for the admin panel
 * (`plugin-tasks.ts`), as the starters have them and `planSite()` writes
 * them: a GitHub workflow started by a `repository_dispatch` event, which
 * editors' tokens can send with the Contents permission they publish with,
 * a GitLab pipeline the admin panel starts with variables, and a Bitbucket
 * custom pipeline. Each runs in two parts (`node-task-runner.ts`): one loads
 * the site's config and writes down the task, with no secrets where the host
 * allows, and one runs it with the secrets, from a release of
 * `@goodfellow-cms/core` installed from npm apart from the site's packages,
 * running none of the site's code but the task itself, held to what its
 * plugin declared.
 */
import { GITHUB_INSTALL_STEPS } from "./github-workflows.js";
import { CORE_RELEASE_COMMAND } from "./lockfile-setup.js";
import { TASK_BRANCH_PREFIX, TASK_EVENT, TASK_JOB, TASK_RESULT_FILE } from "./plugin-tasks.js";

/** The CLI a site's setup runs: `goodfellow`, or `goodfellow-next` for Next.js sites. */
export type SiteCli = "goodfellow" | "goodfellow-next";

/** Where the job with the secrets reads the task's description, as `goodfellow task --describe` writes it. */
export const TASK_DESCRIPTION = "goodfellow-task.json";

/** The GitLab job that writes the task's description, before `TASK_JOB` runs it. */
export const TASK_DESCRIBE_JOB = `${TASK_JOB}-describe`;

/** The GitLab environment the task job runs in, which owners scope plugins' variables to. */
export const TASK_ENVIRONMENT = "goodfellow-tasks";

/**
 * Installs Goodfellow's task runner into `dir`, outside the site, from
 * npm's own registry, at the release of `@goodfellow-cms/core` the site
 * names (`CORE_RELEASE`), running no install scripts, with none of the
 * site's npm settings: script lines, each starting at `indent`.
 */
export function taskRunnerInstall(dir: string, indent: string): string {
  return [
    CORE_RELEASE_COMMAND,
    `mkdir -p "${dir}"`,
    `(cd "${dir}" && npm install --prefix . --no-save --no-package-lock --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org/ "@goodfellow-cms/core@$core")`,
  ]
    .map((line) => `${indent}${line}`)
    .join("\n");
}

/** The task runner's bin, as `taskRunnerInstall()` installs it into `dir`. */
export function taskRunner(dir: string): string {
  return `node "${dir}/node_modules/@goodfellow-cms/core/bin/goodfellow-task.js"`;
}

/**
 * `.github/workflows/plugin-task.yml`: `describe` loads the site's config
 * and writes down the task, with no secrets; `task` runs it with the
 * repository's Actions secrets, which GitHub hands a workflow only as a
 * whole (`toJSON(secrets)`), from Goodfellow's task runner rather than the
 * site's packages, which it installs without running any of their code; and
 * `answer`, which runs none of the site's code, leaves the sealed answer on a
 * branch of its own.
 */
export function githubTaskWorkflow(cli: SiteCli): string {
  return `# Runs plugins' tasks for the admin panel, such as S3 storage signing uploads
# with keys only this workflow has. The admin panel starts it with a
# repository_dispatch event, and it leaves the task's answer, sealed to a key
# only that admin panel holds, on a branch of its own, which the admin panel
# reads and deletes. Plugins' secrets, such as S3_ACCESS_KEY_ID, are the
# repository's Actions secrets (Settings → Secrets and variables → Actions).
# The site's code, its config and the packages it loads, runs in a job with
# none of them. The job with them runs Goodfellow's task runner, installed
# from npm apart from the site's packages, which gives each task only the
# secrets its plugin declared. Both can only read the repository, and the job
# that leaves the answer runs none of the site's code. See README.md.
name: Plugin task
run-name: Plugin task \${{ github.event.client_payload.request }}

on:
  repository_dispatch:
    types: [${TASK_EVENT}]

permissions: {}

jobs:
  describe:
    # Loads the site's config and writes down the task, with no secrets.
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      description: \${{ steps.describe.outputs.description }}
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
${GITHUB_INSTALL_STEPS}
      - id: describe
        env:
          GOODFELLOW_TASK_PLUGIN: \${{ github.event.client_payload.plugin }}
          GOODFELLOW_TASK_NAME: \${{ github.event.client_payload.task }}
        run: |
          npx ${cli} task --describe --out "$RUNNER_TEMP/${TASK_DESCRIPTION}"
          echo "description=$(cat "$RUNNER_TEMP/${TASK_DESCRIPTION}")" >> "$GITHUB_OUTPUT"

  task:
    # Runs the task with the secrets, from Goodfellow's task runner, running none of the site's other code.
    needs: describe
    if: always()
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      result: \${{ steps.task.outputs.result }}
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
      - uses: actions/setup-node@v5
        with:
          node-version: 22
          check-latest: true
      - name: Install Goodfellow's task runner from npm, apart from the site's packages
        run: |
${taskRunnerInstall("$RUNNER_TEMP/goodfellow-runner", "          ")}
      - run: npm ci --ignore-scripts
      - id: task
        env:
          GOODFELLOW_TASK_REQUEST: \${{ github.event.client_payload.request }}
          GOODFELLOW_TASK_PLUGIN: \${{ github.event.client_payload.plugin }}
          GOODFELLOW_TASK_NAME: \${{ github.event.client_payload.task }}
          GOODFELLOW_TASK_INPUT: \${{ github.event.client_payload.input }}
          GOODFELLOW_TASK_KEY: \${{ github.event.client_payload.key }}
          GOODFELLOW_TASK_DESCRIPTION: \${{ needs.describe.outputs.description }}
          GOODFELLOW_SECRETS: \${{ toJSON(secrets) }}
        run: |
          printf '%s' "$GOODFELLOW_TASK_DESCRIPTION" > "$RUNNER_TEMP/${TASK_DESCRIPTION}"
          ${taskRunner("$RUNNER_TEMP/goodfellow-runner")} --description "$RUNNER_TEMP/${TASK_DESCRIPTION}" --out "$RUNNER_TEMP/${TASK_RESULT_FILE}"
          echo "result=$(cat "$RUNNER_TEMP/${TASK_RESULT_FILE}")" >> "$GITHUB_OUTPUT"

  answer:
    # Leaves the sealed answer for the admin panel, running none of the site's code.
    needs: task
    if: always()
    runs-on: ubuntu-latest
    permissions:
      contents: write
    steps:
      - env:
          REQUEST: \${{ github.event.client_payload.request }}
          RESULT: \${{ needs.task.outputs.result }}
          TOKEN: \${{ github.token }}
        run: |
          case "$REQUEST" in "" | *[!a-z0-9]*) echo "That isn't a request from the admin panel."; exit 1 ;; esac
          [ -n "$RESULT" ] || RESULT='{"version":1,"failed":true}'
          git init -q answer
          cd answer
          printf '%s\\n' "$RESULT" > ${TASK_RESULT_FILE}
          git add ${TASK_RESULT_FILE}
          git -c user.name="Goodfellow" -c user.email=tasks@goodfellow.invalid commit -q -m "The answer to plugin task $REQUEST"
          git push -q "https://x-access-token:$TOKEN@\${GITHUB_SERVER_URL#https://}/$GITHUB_REPOSITORY.git" "HEAD:refs/heads/${TASK_BRANCH_PREFIX}$REQUEST"
`;
}

/** The rule that keeps a job out of the pipelines the admin panel starts for tasks, first in its `rules`. */
export const GITLAB_TASK_RULE = `    - if: $GOODFELLOW_TASK_PLUGIN
      when: never`;

/**
 * The task's jobs, in pipelines the admin panel starts with
 * `GOODFELLOW_TASK_PLUGIN` and the request's other variables:
 * `TASK_DESCRIBE_JOB` loads the site's config and writes down the task, and
 * `TASK_JOB` runs it from Goodfellow's task runner, leaving the sealed answer
 * as its artifact. GitLab gives every job the project's CI/CD variables,
 * unless they're scoped to an environment: the task job alone is in
 * `TASK_ENVIRONMENT`, so plugins' variables scoped to it never reach the
 * site's code.
 */
export function gitlabTaskJob(cli: SiteCli): string {
  return `${TASK_DESCRIBE_JOB}:
  # Loads the site's config and writes down a plugin's task, for the task's own job to run.
  image: node:22
  cache:
    key:
      files: [package-lock.json]
    paths: [.npm/]
  script:
    - npm ci --cache .npm --prefer-offline
    - npx ${cli} task --describe --out ${TASK_DESCRIPTION}
  artifacts:
    paths: [${TASK_DESCRIPTION}]
    expire_in: 1 hour
  rules:
    - if: $GOODFELLOW_TASK_PLUGIN

${TASK_JOB}:
  # Runs a plugin's task for the admin panel, such as S3 storage signing uploads
  # with keys kept in the project's CI/CD variables (Settings → CI/CD →
  # Variables): scope them to the ${TASK_ENVIRONMENT} environment, so only this
  # job has them. It runs Goodfellow's task runner, installed from npm apart
  # from the site's packages, which gives each task only the variables its
  # plugin declared. The admin panel starts a pipeline with
  # GOODFELLOW_TASK_PLUGIN set and reads the answer, sealed to a key only that
  # admin panel holds, from the artifacts.
  image: node:22
  needs: [${TASK_DESCRIBE_JOB}]
  environment:
    name: ${TASK_ENVIRONMENT}
    action: prepare
  script:
${taskRunnerInstall("/tmp/goodfellow-runner", "    - ")}
    - npm ci --ignore-scripts
    - ${taskRunner("/tmp/goodfellow-runner")} --description ${TASK_DESCRIPTION} --out ${TASK_RESULT_FILE}
  artifacts:
    paths: [${TASK_RESULT_FILE}]
    expire_in: 1 hour
  rules:
    - if: $GOODFELLOW_TASK_PLUGIN
      when: always
`;
}
