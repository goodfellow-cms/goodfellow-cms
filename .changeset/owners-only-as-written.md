---
"@goodfellow-cms/core": patch
"@goodfellow-cms/react": patch
"@goodfellow-cms/blocks": patch
"@goodfellow-cms/registry": patch
---

Pages now give each block its default settings for any its saved file leaves out, so a page written by hand or by a script no longer stops a build, and a block is drawn with the settings the server checks. A setting whose absence means something is marked `metadata: { noDefault: true }`, as the Table block's `format` and the Gallery's `lightbox` are. On a full-stack site, a save that set Custom HTML's "Make it safe" to `null`, or put the block in another block's slot without an id, got past the server's check, and the block then used its HTML exactly as written: the check now reads a setting as pages draw it, compares settings whatever order they're saved in, and refuses a block without an id whose owners-only settings aren't their starting values unless the file had it before. Custom HTML uses its HTML as written only where the setting is `false`.
