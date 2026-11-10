---
"@goodfellow-cms/core": patch
"@goodfellow-cms/mcp": patch
"@goodfellow-cms/expo": patch
---

More fixes from November's security review:

- The local backend in `goodfellow dev` and `next dev`, and the Claude connector's folders, never follow a link inside an editable folder to files outside it; the folders themselves may still be links, as a content repository's are.
- The Claude connector's screenshots run the browser in Chrome's sandbox, without the connector's tokens in its environment.
- A plugin can't ask to read `*`, `.git`, or files of secrets such as `.env.local`, or for Goodfellow's own `GOODFELLOW_` variables.
- Bitbucket sites' lockfile step publishes `package-lock.json` only once every new package comes from npm's registry, as GitHub's and GitLab's do. Sites made by an earlier release keep their `bitbucket-pipelines.yml` until it's copied from a new site's.
- WordPress imports take only web addresses for attachments, and importing on a computer downloads them only from public `https://` addresses or the site it was read from, no larger than the upload limit.
- Expo apps open redirects to other sites only over the web, and take the site's base path only where it's a path.
