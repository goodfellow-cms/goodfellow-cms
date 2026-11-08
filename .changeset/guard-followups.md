---
"@goodfellow-cms/core": patch
---

The admin address's guard now runs in SVG and XML files whose root element has a prefix, such as `<svg:svg>`, since it names its namespace; goes into files whose root element is empty (`<svg …/>`) rather than failing the build; and accepts any attribute names and quotes on a page's `<html>` element.
