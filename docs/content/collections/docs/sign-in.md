---
version: 1
title: Editors and sign-in
description: How editors sign in with GitHub, GitLab or Bitbucket, what permissions they need, and how their sign-in is kept.
section: owners
order: 2
---

Editors sign in at `/admin` on the live site with their own GitHub, GitLab or Bitbucket account. There's no separate list of users: anyone who can change the site's repository can edit the site, and the site's owners invite and remove them under **Site Settings → Editors**. [Full-stack sites](/docs/full-stack-nextjs) are different: editors sign in with the site's own sign-in.

## Inviting and removing editors

**Site Settings → Editors** lists everyone who can edit the site, and the invitations they haven't accepted yet. There are two roles:

- **Editors** change and publish everything in the admin panel.
- **Owners** can also invite and remove editors, change their roles, and connect a domain.

Owners invite people by their GitHub, GitLab or Bitbucket username, and on GitLab by email address too, in which case GitLab helps them make an account if they don't have one. GitHub and GitLab email each person an invitation, which they accept before they can sign in. Invitations can be withdrawn until they're accepted. Nobody can remove themselves or change their own role, so a site always keeps its owner.

- **On GitHub,** everyday sign-in can't change who edits the site, since that needs GitHub's Administration permission, which can also delete the repository. The Editors screen asks owners for a second token, an **owner token**, made from a link that fills in the permissions it needs, for that browser tab only. The Domain and Updates screens use it too, for GitHub Pages settings and running the site's update. On a site with a [sign-in service](#signing-in-with-github), owners can **Sign in as an owner with GitHub** instead, with the service's second app, the owners' app. Either is kept only until the browser tab closes.
- **On GitLab,** owners are Maintainers in the site's project, and editors are Developers. GitLab only lets Maintainers publish to the main branch at first, so the Editors screen offers **Let editors publish**, which lets Developers publish too, while still stopping anyone from rewriting the site's history. People in a GitLab group that has the project are listed too, but are changed in the group on GitLab.
- **On Bitbucket,** owners have the repository's Admin permission, and editors Write. Bitbucket only gives a repository's permissions to people already in its workspace, so owners add someone to the workspace on Bitbucket first; then the Editors screen gives them access by their Bitbucket username, straight away, with no invitation to accept. Seeing and changing everyone's permissions needs Admin, so an editor's own sign-in only shows themselves, and an owner who signed in with a token that can't do it uses an **owner token**, a repository access token with admin permission, for that browser tab only. The Updates screen uses the same, for Bitbucket Pipelines' settings and schedules.

## GitHub

### Signing in with a token

Editors sign in with a personal access token. The admin panel's **Create a token on GitHub** link opens GitHub's token page with the right permissions already chosen (**Contents** read and write; **Actions**, **Commit statuses** and **Deployments** read-only, which show when the new version of the site is live); under **Repository access**, choose **Only select repositories** and pick the site. Paste the token into the admin panel.

Every editor needs write access to the repository. GitHub doesn't let collaborators on someone else's personal repository use these fine-grained tokens, so either:

- put the repository in a free GitHub organization and add editors as members, or
- have collaborators use the **Create a broader token instead** link, which creates a classic token.

### Signing in with GitHub

A site whose owner runs a [sign-in service](/docs/sign-in-service) and names it in the site's config also offers **Sign in with GitHub**. Goodfellow doesn't run one for everyone yet, and may in the future. Editors approve the service's app on GitHub's page the first time, and come back signed in. It needs two things:

- **The app is installed on the site.** GitHub only lets the service sign editors in to repositories its app is installed on. The first time anyone signs in, the sign-in screen says it isn't installed yet and offers to install it: an owner of the site installs it there, choosing the site's repository, and comes back signed in. The Editors, Domain and Updates screens offer the same for the owners' app, which owners sign in with there.
- **The site's address is in Site settings.** The sign-in service only signs editors in at the address Site settings give, so a copy of the admin panel anywhere else can't use it. Sites made with the setup page have it already.

Each sign-in gives the admin panel a token for the site's repository only, which can change its files and see its builds but not its workflows or settings, and lasts an hour; the admin panel gets a new one while the editor is signed in. The sign-in service revokes editors' own GitHub tokens as soon as they've signed in, and what they publish still shows them as its author.

Signing in with GitHub works only on the published site, not in `goodfellow dev` or `next dev`, which need no sign-in, or a build viewed on this computer. When it isn't available, or the sign-in service has been used as much as it can be that day, editors sign in with a token.

## GitLab

With the site's application registered (see [Put it online](/docs/put-it-online#4-set-up-sign-in)), editors click **Sign in with GitLab**. Without it, or as an alternative, they sign in with a personal access token. Editors need the Developer role or higher.

## Bitbucket

Sites stored on Bitbucket Cloud are edited the same way. Editors sign in with one of:

- **A repository access token,** made under the repository's **Repository settings → Access tokens** (the sign-in screen links there), with permission to read and write the repository and pull requests and to run pipelines. It belongs to the repository rather than to anyone, so what's published with it is shown as the token's, and anyone who has it can edit the site: give each editor their own, and revoke it when they stop.
- **An API token,** made under the Atlassian account's **Security → API tokens**, pasted as the account's email address, a colon, then the token, such as `name@example.org:ATATT3x…`. What's published with it shows the editor as its author.
- **Sign in with Bitbucket,** where the site's config names an OAuth consumer (see [Put it online](/docs/put-it-online#4-set-up-sign-in)). Bitbucket's sign-in for browsers lasts two hours and can't be renewed without a server, so editors sign in again after that.

Editors need Write permission on the repository, or Admin to change editors or set up updates.

## Staying signed in

Editors choose whether to stay signed in on the device (**Stay signed in on this device**; leave it off on shared computers). Otherwise the sign-in lasts until the browser tab closes. **Sign out** forgets the token, and the AI keys entered in the AI panel too. On a site with a [token broker](/docs/token-broker), editors sign in on the broker's page instead, which keeps the sign-in and the AI keys, and shows the admin panel from there.

Tokens are only ever sent to GitHub, GitLab or Bitbucket, never anywhere else. Signing in with GitHub keeps only the sign-in service's session, which holds no token, and signing out forgets it. If a sign-in stops working, for example because it expired, the admin panel asks to sign in again.
