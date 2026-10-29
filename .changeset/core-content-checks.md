---
"@goodfellow-cms/core": patch
---

Content checks catch more that would go wrong on the site:

- Redirects can't come from addresses builds write files at (`/feeds/`, `/api/`, `/media-sizes/`, `/404.html` and others), only send visitors to other websites over `https://`, and can't go round in a circle.
- A time zone that isn't one is refused, rather than read as UTC.
- A language's `languagePaths` must start with its code.
- Theme colors must be colors, never `url(…)`.
- Rich text keeps no `gf-` ids, which Goodfellow's own scripts look up.
- Item and collection change helpers refuse names that aren't one part of an address.
