---
version: 1
title: Hosts and business sites
description: What each free host allows, including the rules for business and commercial sites.
section: start
order: 5
---

Goodfellow sites run on free plans, which have limits worth knowing about. These are the hosts' rules, not Goodfellow's, and they change, so check the links before deciding. Last checked in October 2026.

| On the free plan | GitHub Free | GitLab Free |
|---|---|---|
| Free static hosting | GitHub Pages, public repositories only; or Cloudflare Pages, public or private | GitLab Pages or Cloudflare Pages, public or private |
| Editors | Unlimited collaborators | Up to 5 users in a private group or account; unlimited if public |
| Build minutes | Unlimited for public repositories, 2,000 a month for private | 400 a month (or build on Cloudflare Pages or Vercel instead) |
| Sign-in | Personal access token (fine-grained, or classic for collaborators), or Sign in with GitHub with a [sign-in service](/docs/sign-in-service) you run | One-click sign-in (OAuth) or personal access token |

## Cloudflare Pages

[Cloudflare Pages](https://pages.cloudflare.com) builds sites from repositories on GitHub and GitLab, public or private. Its free plan's limits ([Pages limits](https://developers.cloudflare.com/pages/platform/limits/)):

- **500 builds a month**, one at a time, each up to 20 minutes. Each publish, nightly update and scheduled change that comes due is one build.
- **20,000 files**, each up to 25 MiB.
- **2,000 redirects** in the `_redirects` file the build writes, two for each old address, so about 1,000 old addresses; past that, the build says so, and the pages it writes at old addresses handle the rest.
- **Domains:** a subdomain, such as `www.example.org`, can keep its DNS where it is, with a CNAME record; the domain itself, such as `example.org`, has to use Cloudflare's nameservers, or redirect to the subdomain through your registrar or a redirect service. See [Custom domains](/docs/custom-domains#sites-on-cloudflare-pages).

Cloudflare can't build on a schedule, so the site's nightly update and its hourly check for scheduled changes run on GitHub Actions or GitLab CI, and ask Cloudflare to rebuild the site through its deploy hook. On a private GitHub repository, the hourly check uses about 720 of the free plan's 2,000 minutes a month; delete `.github/workflows/scheduled.yml` to have scheduled changes go live with the nightly rebuild instead.

## Business and commercial sites

- **GitHub Pages** isn't for running an online business, a shop, or any site mainly for selling things or software as a service ([GitHub Pages limits](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)). It also shouldn't handle passwords or card numbers.
- **Vercel's free Hobby plan** is for personal, non-commercial use only. Vercel counts a site as commercial if anyone involved in making it gains financially, including a developer paid to build or update it, and if it takes payments, advertises products or services for sale, or shows ads. Asking for donations is allowed ([Vercel fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines#commercial-usage)).
- **GitLab Pages:** we haven't found a rule against business sites on GitLab's free plan, so it's a free option to use for one. Check [GitLab's terms](https://about.gitlab.com/terms/) for your own case.
- **Cloudflare Pages:** we haven't found a rule against business sites on Cloudflare's free plan either, so it's the free option for a business site kept on GitHub, private or not. Its terms ask free plans to serve video and other large files through one of its paid services ([Cloudflare's terms](https://www.cloudflare.com/service-specific-terms-application-services/)), so put videos on YouTube or Vimeo and show them with the [Video block](/docs/built-in-blocks#video); the media library says so on a Cloudflare site with uploaded videos.

## GitHub sign-in for several editors

GitHub doesn't let collaborators on someone else's personal repository use fine-grained tokens, so put the repository in a free GitHub organization and add editors as members; otherwise collaborators need a classic token. Sign in with GitHub, through a [sign-in service](/docs/sign-in-service) you run, works for every editor. See [Editors and sign-in](/docs/sign-in).
