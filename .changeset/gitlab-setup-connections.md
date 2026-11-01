---
"@goodfellow-cms/core": patch
"@goodfellow-cms/gitlab": patch
---

Creating a site with its content in a project of its own on GitLab now adds the nightly pipeline schedule after the project's files are written, since GitLab can't schedule a branch an empty project doesn't have yet, and tries each connection between the projects on its own. The ones GitLab refuses come back as `unconnected`, which the setup page lists with links to where to add them and what GitLab answered.
