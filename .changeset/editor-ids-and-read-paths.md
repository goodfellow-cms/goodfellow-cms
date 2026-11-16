---
"@goodfellow-cms/core": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/bitbucket": patch
"@goodfellow-cms/broker": patch
---

Editors' ids, file paths, and revisions are checked before they go into GitHub's, GitLab's, and Bitbucket's addresses, so `..` can't reach another of the host's addresses. The token broker names the editor the site's own list gives an id, and makes reads only with plain paths at commits.
