---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/bitbucket": patch
"@goodfellow-cms/registry": patch
"create-goodfellow": patch
---

Security fixes from the November code review:

- The sign-in service sends a sign-in back only to the admin panel (or the token broker's page), never to another page at the site's address, where an editor's redirect could pass it on to another site, and a link can no longer keep an owner signed in for longer.
- The Comments block shows Garrul's comments only from the address in Site Settings, which only owners change, since Garrul's script comes from wherever its address says.
- A token broker asks before publishing a file in the media folder that isn't a kind the media library takes, such as a page or a script.
- Builds refuse a page whose comment a browser would end before the admin address's guard (`<!-->`, `<!--->` or `--!>`).
- Plugins' tasks install Goodfellow's task runner at the exact release the site's lockfile has, with nothing npm published more than a day after it, in new sites' setups.
- Bitbucket invitations match a member by their account or username before the name they show, and refuse a name more than one member uses.
