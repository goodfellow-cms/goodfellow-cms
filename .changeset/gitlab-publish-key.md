---
"@goodfellow-cms/core": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/admin": patch
"create-goodfellow": patch
---

On GitLab, the job that makes the nightly update or writes a plugin's lockfile, which runs the code of every package the site installs, no longer publishes. The starters' `.gitlab-ci.yml` makes them in a `prepare` job, which only commits, and a `publish` job that runs none of the site's code checks they change only what an update or a lockfile does and publishes them with a deploy key of its own, whose private half only that job gets. Turning on updates on the Updates screen adds the key, lets it publish to the main branch, and turns off job token pushes; the setup page does the same for a code project it creates. A developer copies the starter's `.gitlab-ci.yml` to an older site, after which an owner turns updates on again.
