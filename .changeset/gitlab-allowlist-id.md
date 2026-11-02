---
"@goodfellow-cms/gitlab": patch
---

Creating a site with its content in a project of its own on GitLab now connects the two projects' pipelines. GitLab's job token allowlist takes only a project's number, so it refused the project's path with "id is invalid", leaving both connections to be added by hand.
