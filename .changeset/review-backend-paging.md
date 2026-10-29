---
"@goodfellow-cms/bitbucket": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/gitlab": patch
---

Backends list every draft and review, past the first hundred, on GitHub and GitLab. The Bitbucket backend sends its sign-in only to Bitbucket's API, even when an answer names another address. It also reads what others published when its own commit is too far down the branch to find, rather than showing old text. And it refuses a `repo` that isn't `workspace/repository`, as the GitHub backend does.
