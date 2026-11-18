---
"@goodfellow-cms/core": patch
---

GitLab refused the pipeline of every site made with `.gitlab-ci.yml` ("jobs:plugin-task:script config should be a string or a nested array of strings"), so those sites never built: the line installing the plugin task runner held `: `, which YAML reads as a key and its value. GitLab's and Bitbucket's task steps now write those lines as quoted strings. Sites made before this keep their file, since updates don't change it: copy the `plugin-task` job from the starter's `.gitlab-ci.yml`, or, in `bitbucket-pipelines.yml`, the "Plugin task" step's script from `create-goodfellow`'s, or wrap its `release=$(node -e '…') || exit 1` line in single quotes, doubling each `'` inside it.
