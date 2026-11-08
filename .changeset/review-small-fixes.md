---
"@goodfellow-cms/core": patch
"@goodfellow-cms/github": patch
---

Fix small problems found in review:

- The checks of built pages read a character reference past Unicode's last (`&#x110000;`) as browsers do, rather than stopping.
- Moving a page leaves links to the pages a block adds under a page that stays (`/news/events/page/2` when `/news` moves) where they are.
- The content API's manifest leaves out redirects the checks refuse, as builds do.
- Plugins can't ask for Netlify's variables (`NETLIFY_*`) as secrets.
- On GitHub, starting a draft from a revision GitHub doesn't have says so, rather than that a draft by that name exists, and a pull request from a deleted fork is no longer taken for one of the site's drafts.
