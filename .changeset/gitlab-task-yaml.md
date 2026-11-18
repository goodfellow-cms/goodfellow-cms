---
"@goodfellow-cms/core": patch
---

GitLab refused the pipeline of every site made with `.gitlab-ci.yml` ("jobs:plugin-task:script config should be a string or a nested array of strings"), so those sites never built: the line installing the plugin task runner held `: `, which YAML reads as a key and its value. GitLab's and Bitbucket's task steps now write their commands as quoted strings. Sites made before this keep their file, since updates don't change it. On GitLab, copy the `plugin-task` job from the starter's `.gitlab-ci.yml`. On Bitbucket, wrap the "Plugin task" step's `release=$(node -e '…') || exit 1` line in single quotes, doubling each `'` inside it, or replace `bitbucket-pipelines.yml` with what `node --input-type=module -e 'import("@goodfellow-cms/core").then((core) => process.stdout.write(core.bitbucketPipelines("goodfellow")))'` writes in the site's folder once Goodfellow is updated (with `goodfellow-next` for a Next.js site), keeping any changes of your own.
