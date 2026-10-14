---
"@goodfellow-cms/core": minor
"@goodfellow-cms/github": minor
"@goodfellow-cms/gitlab": minor
"@goodfellow-cms/admin": minor
---

Sign in with GitHub, through Goodfellow's sign-in service. Editors get a token for the site's repository only, lasting an hour and renewed while they're signed in, and what they publish names them as its author. The service stores nothing about anyone's sign-in: editors' own GitHub tokens are revoked as soon as they've signed in. The first time someone signs in, the sign-in screen offers to install Goodfellow on the site, and GitHub's install page signs them in too. It works at the address in the site's settings, never on this computer; elsewhere, and when the service's daily limit is reached, editors sign in with a token as before. Owners sign in with a second app, for one tab, on the Editors, Domain and Updates screens, and the setup page signs in, and installs Goodfellow where it creates sites, through the service too. `github({ signIn })` names your own copy of the service, or `false` turns it off.
