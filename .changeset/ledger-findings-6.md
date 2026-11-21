---
"@goodfellow-cms/core": patch
"@goodfellow-cms/blocks": patch
---

Security and correctness fixes:

- The Section block writes its background picture's address as CSS reads it back, and leaves the picture out where the address has a tab, a line break, or another control character in it. Before, it wrote the address as a JavaScript string, whose escapes mean something else to CSS, so the picture loaded could be another than the one named. A theme whose header or footer has such an address is refused, so its install screen always lists the address a page would load.
- MiniSearch's index takes a page's title only from its own `<title>`. Before, on a page with no heading in its content, an SVG's title in the header or footer, such as a logo's, was added to the page's title in search results.
