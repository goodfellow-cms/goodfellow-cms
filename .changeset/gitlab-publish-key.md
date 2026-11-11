---
"@goodfellow-cms/core": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/bitbucket": patch
"create-goodfellow": patch
---

On GitLab, the job that makes the nightly update or writes a plugin's lockfile, which runs the code of every package the site installs, no longer publishes. The starters' `.gitlab-ci.yml` makes them in a `prepare` job, which only commits, and a `publish` job that runs none of the site's code checks they change only what an update or a lockfile does and publishes them with a deploy key of its own, whose private half only that job gets. Turning on updates on the Updates screen adds the key, lets it publish to the main branch, and turns off job token pushes; the setup page does the same for a code project it creates. A developer copies the starter's `.gitlab-ci.yml` to an older site, after which an owner turns updates on again.

On Bitbucket, the pipeline steps that run the site's code (the lockfile, the nightly update, and plugins' tasks) now ask only to read the repository, so their token can't publish, and a step after each, which runs none of the site's code, checks what they committed and publishes it, as on GitHub. Where the main branch has branch restrictions, add main under its Pipelines write access. A developer copies the newer `bitbucket-pipelines.yml` to an older site.
