---
"@goodfellow-cms/react": patch
---

Built pages are written whole. On a long page, React moved what a block waited for, such as formatted text, to the end of the page for a script to put back, so visitors without JavaScript, search engines and the accessibility checks found it outside the page's main content.
