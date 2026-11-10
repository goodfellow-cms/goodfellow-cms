---
"@goodfellow-cms/core": patch
"@goodfellow-cms/mcp": patch
"@goodfellow-cms/expo": patch
"@goodfellow-cms/ai": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/bitbucket": patch
"create-goodfellow": patch
"@goodfellow-cms/broker": patch
---

More fixes from November's security review:

- The local backend in `goodfellow dev` and `next dev`, and the Claude connector's folders, never follow a link inside an editable folder to files outside it; the folders themselves may still be links, as a content repository's are.
- The Claude connector's screenshots run the browser in Chrome's sandbox, without the connector's tokens in its environment.
- A plugin can't ask to read `*`, `.git`, or files of secrets such as `.env.local`, or for Goodfellow's own `GOODFELLOW_` variables.
- Bitbucket sites' lockfile step publishes `package-lock.json` only once every new package comes from npm's registry, as GitHub's and GitLab's do. Sites made by an earlier release keep their `bitbucket-pipelines.yml` until it's copied from a new site's.
- WordPress imports take only web addresses for attachments, and importing on a computer downloads them only from public `https://` addresses or the site it was read from, no larger than the upload limit.
- Expo apps open redirects to other sites only over the web, and take the site's base path only where it's a path.
- Cleaning an SVG's CSS goes on until taking out an `@import` or `url()` can't join what's around it into another, and leaves the CSS out whole where something would still load from elsewhere, as an unfinished `url(` would.
- Rich text can't take an id Goodfellow's own scripts look up by spelling it with character references, such as `&#103;f-consent`.
- A full-stack site's AI proxy (`aiServer()`) sends on only the fields the AI assistant sends: Claude's own models, answers no longer than the assistant asks for, text messages and structured answers, and only its beta, so an editor can't spend the site's key on tools, files, or other models. `models` on a service's key limits the models editors may ask for.
- GitLab and Bitbucket sites list and close only their own repository's merge and pull requests as drafts' reviews, never one from a fork that uses a draft's branch name.
- The sign-in worker that `create-goodfellow` carries, which owners deploy, takes its setup page's forms only from that page, and always writes a new session key while it's being set up.
- The token broker publishes a draft with exactly the changes it checked, so nothing added to the draft in between goes live unchecked, and frames the admin panel at the screen an address names without what a sign-in brought back, such as the sign-in worker's grant or Bitbucket's token.
- The Claude connector reads a site's description as builds read other sites' files: from public `https://` addresses only (or a folder's development server), no larger than 5 MB, and within 15 seconds.
- A plugin installed from the admin panel runs its tasks only from its own package, so a task's description can't send its secrets to a file of the site's.
