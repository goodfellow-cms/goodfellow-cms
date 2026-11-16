---
"@goodfellow-cms/react": patch
---

An item's values go into HTML a block shows as written, such as Custom HTML's in a collection's page design, by where each placeholder sits. They were escaped only as text, which left a single-quoted or unquoted attribute's value open to more attributes, and an address such as `<iframe src="{video}">` open to `javascript:`. Now a value is escaped for any attribute, an address at the start of one a browser follows or loads goes in only where it's a safe one, and a placeholder where no escaping makes a value safe (inside a tag outside an attribute's value, in an `on…` attribute or `srcdoc`, or in a script or style) is left empty.
