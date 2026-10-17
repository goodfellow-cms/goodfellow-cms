---
version: 1
title: Hosts and business sites
description: What each free host allows, including the rules for business and commercial sites.
section: start
order: 5
---

Goodfellow sites run on free plans, which have limits worth knowing about. These are the hosts' rules, not Goodfellow's, and they change, so check the links before deciding. Last checked in October 2026.

| | GitHub Free | GitLab Free |
|---|---|---|
| Free static hosting | GitHub Pages, public repositories only | GitLab Pages, public or private |
| Editors | Unlimited collaborators | Up to 5 users in a private group or account; unlimited if public |
| Build minutes | Unlimited for public repositories, 2,000 a month for private | 400 a month (or build on Vercel instead) |
| Sign-in | Personal access token (fine-grained, or classic for collaborators), or Sign in with GitHub with a [sign-in service](/docs/sign-in-service) you run | One-click sign-in (OAuth) or personal access token |

## Business and commercial sites

- **GitHub Pages** isn't for running an online business, a shop, or any site mainly for selling things or software as a service ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)). It also shouldn't handle passwords or card numbers.
- **Vercel's free Hobby plan** is for personal, non-commercial use only. Vercel counts a site as commercial if anyone involved in making it gains financially, including a developer paid to build or update it, and if it takes payments, advertises products or services for sale, or shows ads. Asking for donations is allowed ([Vercel fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)).
- **GitLab Pages:** we haven't found a rule against business sites on GitLab's free plan, so it's the free option to use for one. Check [GitLab's terms](https://about.gitlab.com/terms/) for your own case.

## GitHub sign-in for several editors

GitHub doesn't let collaborators on someone else's personal repository use fine-grained tokens, so put the repository in a free GitHub organization and add editors as members; otherwise collaborators need a classic token. Sign in with GitHub, through a [sign-in service](/docs/sign-in-service) you run, works for every editor. See [Editors and sign-in](/docs/sign-in).
