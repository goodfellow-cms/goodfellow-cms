---
"@goodfellow-cms/core": patch
---

`goodfellow blocks add` works on Windows: once it has written a block, it starts TypeScript again to read it, since TypeScript didn't take in the new files when told of them there, so every block failed its typecheck.
