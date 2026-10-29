---
"@goodfellow-cms/core": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/ai": patch
"goodfellow": patch
"create-goodfellow": patch
---

Publishing refuses, rather than retries on top, when GitHub or GitLab can't list every file someone else changed meanwhile, so a large change such as a WordPress import is never written over. `goodfellow preview` answers only this computer unless given `--network`. AI services' addresses must be `https://`, unless the service runs on this computer, and the assistant is told the site's own text is content, not instructions. Registry addresses are compared as they'd be fetched, so `..` can't leave a trusted registry. New sites ignore every `.env` file but `.env.example`.
