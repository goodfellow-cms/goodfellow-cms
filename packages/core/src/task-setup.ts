/**
 * The setup files that run plugins' tasks for the admin panel
 * (`plugin-tasks.ts`), as the starters have them and `planSite()` writes
 * them: a GitHub workflow started by a `repository_dispatch` event, which
 * editors' tokens can send with the Contents permission they publish with,
 * and a GitLab job in a pipeline the admin panel starts with variables. Both
 * run the site's code with a token that can only read the repository, and
 * give each task only the secrets its plugin declared.
 */
import { GITHUB_INSTALL_STEPS } from "./github-workflows.js";
import { TASK_BRANCH_PREFIX, TASK_EVENT, TASK_JOB, TASK_RESULT_FILE } from "./plugin-tasks.js";

/** The CLI a site's setup runs: `goodfellow`, or `goodfellow-next` for Next.js sites. */
export type SiteCli = "goodfellow" | "goodfellow-next";

/**
 * `.github/workflows/plugin-task.yml`: the `task` job runs the task with the
 * repository's Actions secrets, which GitHub hands a workflow only as a
 * whole (`toJSON(secrets)`), so Goodfellow's command takes them out of the
 * environment before it loads the site; then `answer`, which runs none of
 * the site's code, leaves the sealed answer on a branch of its own.
 */
export function githubTaskWorkflow(cli: SiteCli): string {
  return `# Runs plugins' tasks for the admin panel, such as S3 storage signing uploads
# with keys only this workflow has. The admin panel starts it with a
# repository_dispatch event, and it leaves the task's answer, sealed to a key
# only that admin panel holds, on a branch of its own, which the admin panel
# reads and deletes. Plugins' secrets, such as S3_ACCESS_KEY_ID, are the
# repository's Actions secrets (Settings → Secrets and variables → Actions):
# each task gets only those its plugin declared. The job that runs the site's
# code can only read the repository, and the job that leaves the answer runs
# none of it. See README.md.
name: Plugin task
run-name: Plugin task \${{ github.event.client_payload.request }}

on:
  repository_dispatch:
    types: [${TASK_EVENT}]

permissions: {}

jobs:
  task:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    outputs:
      result: \${{ steps.task.outputs.result }}
    steps:
      - uses: actions/checkout@v5
        with:
          persist-credentials: false
${GITHUB_INSTALL_STEPS}
      - id: task
        env:
          GOODFELLOW_TASK_REQUEST: \${{ github.event.client_payload.request }}
          GOODFELLOW_TASK_PLUGIN: \${{ github.event.client_payload.plugin }}
          GOODFELLOW_TASK_NAME: \${{ github.event.client_payload.task }}
          GOODFELLOW_TASK_INPUT: \${{ github.event.client_payload.input }}
          GOODFELLOW_TASK_KEY: \${{ github.event.client_payload.key }}
          GOODFELLOW_SECRETS: \${{ toJSON(secrets) }}
        run: |
          npx ${cli} task --out "$RUNNER_TEMP/${TASK_RESULT_FILE}"
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
 * The \`plugin-task\` job, in pipelines the admin panel starts with
 * \`GOODFELLOW_TASK_PLUGIN\` and the request's other variables, leaving the
 * sealed answer as its artifact. GitLab gives every job the project's CI/CD
 * variables, so the task's secrets are there for every job in the project;
 * Goodfellow's command gives the task only those its plugin declared.
 */
export function gitlabTaskJob(cli: SiteCli): string {
  return `${TASK_JOB}:
  # Runs a plugin's task for the admin panel, such as S3 storage signing uploads
  # with keys kept in the project's CI/CD variables (Settings → CI/CD →
  # Variables), each task getting only those its plugin declared. The admin
  # panel starts a pipeline with GOODFELLOW_TASK_PLUGIN set and reads the
  # answer, sealed to a key only that admin panel holds, from the artifacts.
  image: node:22
  cache:
    key:
      files: [package-lock.json]
    paths: [.npm/]
  script:
    - npm ci --cache .npm --prefer-offline
    - npx ${cli} task --out ${TASK_RESULT_FILE}
  artifacts:
    paths: [${TASK_RESULT_FILE}]
    expire_in: 1 hour
  rules:
    - if: $GOODFELLOW_TASK_PLUGIN
`;
}
