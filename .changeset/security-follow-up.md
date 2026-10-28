---
"@goodfellow-cms/core": patch
"@goodfellow-cms/broker": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/next": patch
"goodfellow": patch
---

Security fixes from a review:

- The token broker refuses calls it doesn't list, and asks before changing domains, taking someone's access away, running a plugin's task, setting up updates or throwing away a draft. It also never publishes `bitbucket-pipelines.yml`.
- `goodfellow task` and `goodfellow-next task` load the site's config in a process of its own that has none of the job's secrets, so the config and the packages it loads can't read them.
- The GitHub backend lists every pending invitation and organization, not only the first 100.
- GitLab removes a scheduled-change pipeline schedule it couldn't give its variable.
