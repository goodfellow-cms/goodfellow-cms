---
"@goodfellow-cms/core": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/gitlab": patch
"create-goodfellow": patch
---

A publish made while a GitLab Pages site is still building now cancels that build and builds both, so publishing several pages one after another mostly costs one build: the starters' and the content repository's GitLab Pages jobs are `interruptible`. The admin panel no longer reports a build that a newer publish cancelled or replaced as failed, on GitLab or GitHub: it follows the newer build instead.

Existing sites on GitLab Pages can add `interruptible: true` to the `pages` job in their `.gitlab-ci.yml` to get the same.
