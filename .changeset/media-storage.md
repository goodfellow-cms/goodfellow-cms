---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/broker": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
"create-goodfellow": minor
---

Plugins can keep a site's media in a storage service in place of `public/media/`, as S3 storage (`goodfellow-plugin-s3`, in a repository of its own) does. A plugin with `mediaStorage` takes the Media screen's uploads, larger ones too, and `content/media-storage.json` lists the files it keeps by their `/media/` addresses, which builds, `goodfellow dev` and Next.js show from the storage's public address, so pages don't change. The Media screen moves the site's own files there and back.

Plugins can also run tasks in the site's CI, with secrets the admin panel never holds: an admin module calls `api.task(id, input)`, and the starters' new `.github/workflows/plugin-task.yml`, or the `plugin-task` job in `.gitlab-ci.yml`, runs `goodfellow task` (`goodfellow-next task`) with only the secrets the plugin declared, sealing the answer to a key only that admin panel holds. It takes about a minute. `goodfellow dev` and `next dev` run tasks on the computer, and full-stack sites pass them through their server. Sites made earlier copy the starter's `plugin-task.yml`, or the `plugin-task` job and the `pages` job's new rule, to run tasks.

Plugins' screens fill the screen as the admin panel's own do, drawing their own heading in a frame as tall as what they draw. `api.secretsHelp()` tells a plugin how the site's owner adds its secrets for this site, in steps for GitHub, GitLab, the development servers' `.env.local` or a full-stack site's server, and a site's config can give a plugin `options`.
