---
"@goodfellow-cms/core": patch
---

`goodfellow blocks add` works on Windows: it gives TypeScript the block's files by paths with forward slashes, since TypeScript 7 didn't find new files by paths with backslashes.
