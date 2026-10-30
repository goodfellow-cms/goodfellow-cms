---
"@goodfellow-cms/core": minor
"@goodfellow-cms/admin": minor
"@goodfellow-cms/broker": minor
"@goodfellow-cms/next": minor
"goodfellow": minor
---

Owners can install an update of a plugin or theme the site has before it's three days old, with **Install now**, where both the version installed and the new one have npm provenance from the same repository and workflow. First installs, releases without provenance and releases built anywhere else still wait, and waiting stays the default. Where the site is built, the check is made again with Sigstore's signatures: the lockfile job (through `goodfellow-early`, run from npm) for plugins, `goodfellow build` and `goodfellow-next finish` for themes, and the full-stack server before review, failing loudly rather than falling back. The token broker names the release's repository in its own dialog. The starters' workflows have the new lockfile step, and their builds don't run after the lockfile job fails.
