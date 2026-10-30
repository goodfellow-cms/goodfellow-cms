---
"@goodfellow-cms/core": patch
"@goodfellow-cms/blocks": patch
"@goodfellow-cms/registry": patch
"@goodfellow-cms/next": patch
"@goodfellow-cms/expo": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/mcp": patch
"goodfellow": patch
---

Harden more of what the code review found:

- Builds read other calendars and News feed blocks' feeds only from `https://` addresses that aren't on the building computer or a private network, checking each redirect, and stop reading past their size limit as they read (`readRemoteText()`, `isPrivateHost()`).
- Markdown headings never get an id starting `gf-`, which Goodfellow's own scripts look up, so a heading can't stop a page's interactive blocks from starting.
- Calendar files never let a carriage return in a name or event start a line of its own; sitemaps escape `"` in addresses.
- Players and social posts refuse every spelling of this computer's address (`localhost.`, `*.localhost`, `[::ffff:127.0.0.1]`).
- Registry items' files go only into their own block's folder or the shared components, whatever their `target` says.
- Next.js sites' redirects to addresses with `:`, `*`, `(` and the like no longer fail `next build`.
- `next dev`'s local server refuses requests for any name but this computer's before serving the editor's frames, reading the name Next.js passes on as `x-forwarded-host`.
- Sites that ask visitors first also hold back head styles that load from other sites, a `base` and a `meta` refresh.
- Apps download a kept file again where it's corrupt, keep the classes they can read where twrnc can't read one, and keep other sites' frames from opening other apps; on Android, links from them now open in the browser.
- GitLab's "let editors publish" changes the branch's protection in one step where GitLab can, and checks it after where it can't.
- Local screenshots never let a site's scripts write through the development server's API.
