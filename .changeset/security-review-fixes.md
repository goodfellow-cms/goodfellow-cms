---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/next": patch
"@goodfellow-cms/broker": patch
"@goodfellow-cms/mcp": patch
"create-goodfellow": patch
---

Security fixes from the second November review:

- Markdown items show text after an inline `<kbd>`, `<code>`, `<pre>`, or `<script>` tag as text, where it could carry live HTML onto the site's pages.
- A full-stack site's server publishes only on top of the live site as it is now, whatever revision the browser names, so a change waiting for review can't come along with an editor's own; the GitHub backend checks the same before every commit, moves the branch only from that commit in the same request, and takes only commits' ids as revisions.
- The sign-in service finishes a sign-in only in the browser that started it, so a link to GitHub that someone else started can't send an owner's sign-in to them. New sign-in services get it; an existing one gets it with its next weekly update, or by copying create-goodfellow's `templates/sign-in/` over it.
- `next dev`'s local backend answers nothing while other computers can reach the development server, and the Next.js starter starts it with `next dev --port 4321 -H 127.0.0.1`. On a site made by an earlier release, change the `dev` script in `package.json` to that.
- Publishing a draft refuses one that changes files the admin panel never edits, such as the site's configuration, packages, or workflows (anything outside its content, its media, and the folders the admin panel installs blocks and plugins into), which only reach a draft when someone saves them there on the site's host, and publishes exactly the changes the admin panel's **Publish all** and Claude's `publish` checked, media included.
- A token broker makes each change again before checking it, so the change it checks is the one it publishes, and checks the changes a draft is asked to publish, and theme and plugin records written as bytes.
