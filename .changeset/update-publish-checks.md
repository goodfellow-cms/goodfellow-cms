---
"@goodfellow-cms/core": patch
"@goodfellow-cms/github": patch
"@goodfellow-cms/gitlab": patch
"@goodfellow-cms/bitbucket": patch
---

The Updates screen counts an update job that only commits as set up only where a later job publishes what it commits, and Bitbucket's last update reads as failed where the step publishing it failed. GitLab's starter Pages job writes the lockfile only where it builds, letting editors publish keeps the publishing key's access to the main branch on older GitLab, and the Updates screen asks to turn updates on again where the main branch's protection no longer names the key.
