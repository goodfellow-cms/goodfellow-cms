---
"@goodfellow-cms/core": minor
"@goodfellow-cms/react": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/blocks": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
---

Full-stack sites can mark pages, and collections' items, for signed-in members only: a page's **Who can see this page** setting, and a collection's settings, store `visibility: "members"`, and `isMembersOnly()` tells the site's own code which pages they are. Members' pages and collections are left out of the site's search, feeds, calendar files, and the content API, and the calendar blocks offer no files for members' calendars. Only full-stack sites are offered the setting, and `goodfellow build` and `goodfellow-next finish` warn when a static site has pages marked for members, which they publish to everyone.
