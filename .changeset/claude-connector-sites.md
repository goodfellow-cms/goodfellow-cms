---
"@goodfellow-cms/mcp": minor
"@goodfellow-cms/core": minor
"@goodfellow-cms/github": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/bitbucket": patch
---

The Claude connector on your computer works on several sites at once, with a token for each host, and on sites in folders on your computer through their development server. It finds a site's address on GitHub Pages or GitLab Pages when Site settings has none, and its screenshots no longer wait for pages to go quiet for good, run without the GPU, are tried again when the browser closes, and say what the browser said. Backends wait and try again when a host limits requests (`withRateLimits()`, `RateLimitError`), and the GitLab backend no longer lists the whole site again after each of its own saves.
