---
"@goodfellow-cms/core": patch
---

Builds now ask Google Fonts again, twice, after a failed connection, a timeout or an answer saying to try later, before leaving a site's fonts with Google. A single failed request used to leave every page loading its fonts from Google until the next build.
