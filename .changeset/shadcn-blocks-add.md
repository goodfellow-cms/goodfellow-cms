---
"@goodfellow-cms/core": minor
"goodfellow": minor
"@goodfellow-cms/next": minor
"create-goodfellow": patch
---

`goodfellow blocks add <item>` (and `goodfellow-next blocks add`) installs any shadcn registry item with shadcn's own CLI and makes a block of its component. Its fields come from the component's props, read with TypeScript 7, and its defaults from the component's code. The command then typechecks and renders the block, and lists what it couldn't do. With `--registry <folder>`, it writes the block into a block registry instead. The new `@goodfellow-cms/core/shadcn` entry does the work.

New sites' `components.json` says `"rsc": true`, since with `false` shadcn drops `"use client"` from what it installs, and interactive components never run in the browser. The command fixes older sites' when it runs.
