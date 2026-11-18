---
"@goodfellow-cms/core": patch
"@goodfellow-cms/react": patch
"@goodfellow-cms/blocks": patch
"goodfellow": patch
---

Pages now give each block its default settings for any its saved file leaves out, so a page written by hand or by a script no longer stops a build; a setting whose absence means something is marked `metadata: { noDefault: true }`, as the Table block's `format` and the Gallery's `lightbox` are. A theme's list of what it loads from other sites, and the head code a site that asks visitors first holds back, now see `@import` written with no space after it, CSS escapes and `image-set()`. Editors' limits count what a page translates only for a page in another language translating one in the main language. `goodfellow preview` answers only at `localhost` and this computer's IP addresses unless `--network` is given. WordPress exports write a Heading's alignment only where it's one WordPress has, and name linked files whose address has a stray `%` in it.
