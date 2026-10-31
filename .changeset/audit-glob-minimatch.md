---
"@goodfellow-cms/core": patch
---

Sites now override glob and minimatch to releases that fix GHSA-3g3m-2fjr-6pw4 and GHSA-g3hv-75wg-m249, which reached them through sigstore's packages. `goodfellow update` adds the overrides to older sites.
