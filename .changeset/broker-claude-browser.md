---
"@goodfellow-cms/ai": patch
"@goodfellow-cms/broker": patch
---

Claude works through the token broker again. The broker sends the AI assistant's requests from its own page, which is a browser, and Anthropic's API answers browsers only when a request says it comes from one, which `aiServer()` left out. `aiServer()` takes a `browser` option, which the broker sets.
