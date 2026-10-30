---
"@goodfellow-cms/core": minor
"@goodfellow-cms/next": minor
"@goodfellow-cms/admin": patch
"goodfellow": minor
---

Plugins' tasks run in two parts, so the site's code never runs where their secrets are. Loading a site's config runs every package it imports, plugins' own included, and on Linux a process can read the environment its parent started with, so a package could read every secret of the job that ran a task. Now `goodfellow task --describe` (and `goodfellow-next task --describe`) loads the config in a job with no secrets and writes the task down, and the job with them installs Goodfellow's task runner from npm apart from the site's packages, installs those without running their scripts, and runs the new `goodfellow-task` bin of `@goodfellow-cms/core`, which never loads the config and checks what was written down: the task must be the plugin's own module, ask for none of the hosts' own variables, and for a plugin installed from the Plugins screen ask for no more than its owner approved.

The starters' `plugin-task.yml`, `.gitlab-ci.yml` and the Bitbucket and Cloudflare setups `planSite()` writes are the new ones. On GitLab, scope plugins' variables to the `goodfellow-tasks` environment so only the task's job has them; Bitbucket gives every step every repository variable. Sites made before this run tasks in one job until a developer copies the starter's task setup, since updates can't change a site's workflows.

The lockfile jobs' early-update check now refuses a `package.json` that names `@goodfellow-cms/core` as anything but a release from npm, such as a URL or a git repository, which `npm exec` would otherwise install and run.
