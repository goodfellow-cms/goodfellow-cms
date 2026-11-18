---
"@goodfellow-cms/core": patch
"@goodfellow-cms/registry": patch
---

On a full-stack site, editors couldn't change Custom HTML's "Make it safe", but a save that left the setting out, set it to `null`, or put the block in another block's slot without an id got past the server's check, and the block then used its HTML exactly as written. The check now takes a setting as it's written, left out and `null` included, refuses a block with owners-only settings that has no id, and Custom HTML uses its HTML as written only where the setting is `false`; anything else is made safe.
