---
"@goodfellow-cms/core": patch
"@goodfellow-cms/react": patch
"@goodfellow-cms/blocks": patch
"@goodfellow-cms/expo": patch
---

Fix several bugs found in review:

- A page title with `$` in it (`$5 lunches`) goes into the site's title template as written, not as a replacement pattern.
- WordPress and Markdown imports give a page whose address ends in `index`, or is under `/admin`, an address a page can have (`/docs/index-page`), rather than stopping.
- Apps keep their whole copy of the site, manifest included, when a download fails part way through updating it.
- An item's values are escaped in rich text inside a block's lists and objects (such as Questions and answers'), as they are elsewhere.
- The Calendar's Subscribe links on a page in another language subscribe to that language's calendar file, which builds now write for every language, empty until it has events.
