---
"@goodfellow-cms/gitlab": patch
---

GitLab's remembered sign-in keeps working with the admin panel open in more than one tab. GitLab ends a refresh token once it's used, so when one tab renewed the sign-in, the other was signed out at its next renewal, and the remembered sign-in with it. A tab now takes the tokens another tab saved, before renewing and when GitLab refuses its own, and tabs take turns renewing where the browser can.
