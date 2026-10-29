---
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/bitbucket": patch
---

Editors signed in with GitLab are no longer signed out when several requests need a new access token at once: they now share one renewal, since GitLab accepts each refresh token only once. Coming back from signing in with GitLab or Bitbucket in a tab that didn't start it now takes the sign-in details out of the address too, so a Bitbucket token never stays in the address bar or history.
