---
"@goodfellow-cms/core": patch
"@goodfellow-cms/admin": patch
"@goodfellow-cms/registry": patch
"goodfellow": patch
---

Resolves the rest of the code scanner's findings. Reading long theme CSS, Google Fonts stylesheets, pages that get the admin address's guard, and addresses with many slashes now takes time in proportion to their length. Values put into the guards' and blocks' inline scripts can't end the script early. A plugin's early install runs npm without a shell on Windows. The content API's rich text keeps any block id, `__proto__` included, as an ordinary key. The Comments block loads Garrul's script only from a web address.
