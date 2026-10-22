---
version: 1
title: Custom domains
description: Put the site at your own address, such as example.org, from the admin panel.
section: owners
order: 4
---

A new site is at its host's address, such as `https://your-name.github.io/your-site/`. To put it at a domain of your own, such as `example.org`, connect the domain in the admin panel. Buy the domain first from a registrar, such as Cloudflare, Namecheap or Porkbun, if you don't have one.

## Connect a domain

1. In the admin panel, open **Site Settings → Domain**. Type the domain, such as `example.org` or `www.example.org`, and choose **Connect domain**.
2. Goodfellow connects the domain on GitHub Pages or GitLab Pages, makes it the site's address in Site Settings and publishes that, and lists the records to add at your registrar.
3. At your registrar, add each record, as below. Delete any other A, AAAA or CNAME records with the same names, such as the page some registrars show on new domains.
4. The Domain screen checks every 30 seconds whether:
   1. the records are in place, as the rest of the world sees them;
   2. GitHub or GitLab has checked the domain and set up HTTPS for it;
   3. the site opens at its new address.

   New records usually take a few minutes to reach everyone, and up to a day. The certificate for HTTPS can take up to a day too.
5. Once all three are done, choose **Send everyone to https://…**, so visitors always get the secure address and the old address sends them to the new one.

A few things to know:

- **Who can connect a domain:** the site's owners. On GitHub, the Domain screen asks owners to sign in as an owner, or for an owner token, either of which can change GitHub Pages settings (see [Editors and sign-in](/docs/sign-in#inviting-and-removing-editors)). Signing in with GitHub follows the site to its new address once Site settings have it, which connecting the domain does. On GitLab, owners are Maintainers in the site's project.
- **www:** for a domain such as `example.org`, the screen lists a `www` record too, so `www.example.org` goes to the site as well.
- **Add the records straight away:** as soon as a domain is connected, GitHub sends visitors from the site's old address to the new one. Connecting it before adding the records is what GitHub recommends, so nobody else can claim the domain for their own site in between.
- **GitLab:** connecting a domain also gives the site a unique domain on gitlab.io, if it didn't have one, since the site is then served from the root of both addresses. Its GitLab records include one that proves the domain is yours: leave it in place, as GitLab checks it again now and then.
- **Sign in with GitLab:** the GitLab application editors sign in with sends them back to the admin panel's address, which changes with the domain. Add the new one, such as `https://example.org/admin/`, to the application's redirect URIs (see [Put it online](/docs/put-it-online#4-set-up-sign-in)). The Domain screen reminds you, with the exact address.
- **Removing a domain:** **Remove domain** puts the site back at its host's address. Afterwards, delete the records at your registrar, so nobody else can use the domain for a site of theirs.

## The records

The Domain screen lists the exact records for your site. They are:

| Host | Domain such as `example.org` | Domain such as `www.example.org` |
|---|---|---|
| GitHub Pages | Four A records: 185.199.108.153, 185.199.109.153, 185.199.110.153 and 185.199.111.153. Four AAAA records are optional. | A CNAME record pointing to `your-name.github.io` |
| GitLab Pages | An A record: 35.185.44.232. An AAAA record is optional. Plus a TXT record that proves the domain is yours. | A CNAME record pointing to `your-group.gitlab.io`, plus the TXT record |

Most registrars add the domain to a record's name themselves, so the screen shows what to type: `@` for the domain itself, `www` for `www.example.org`, and so on.

## At your registrar

Each registrar's help explains where its DNS settings are. The parts that trip people up:

- **[Cloudflare](https://developers.cloudflare.com/dns/manage-dns-records/how-to/create-dns-records/):** under the domain's **DNS → Records**, add each record and set its **Proxy status** to **DNS only** (a grey cloud). With Cloudflare's proxy on, GitHub and GitLab can't set up HTTPS for the domain, and the records look wrong to the Domain screen.
- **[GoDaddy](https://www.godaddy.com/help/add-an-a-record-19238):** in the domain's **DNS** settings, choose **Add New Record**. Type `@` as the name for the domain itself. Delete the A record GoDaddy adds for its own page on new domains.
- **[Namecheap](https://www.namecheap.com/support/knowledgebase/article.aspx/319/2237/how-can-i-set-up-an-a-address-record-for-my-domain/):** on the domain's **Advanced DNS** tab, use **Add New Record** under **Host Records**. Type `@` as the host for the domain itself, and only `www` for `www.example.org`. Delete any URL redirect or parking records for the same names.
- **[Porkbun](https://kb.porkbun.com/article/231-how-to-add-dns-records-on-porkbun):** in **Domain Management**, open the domain's **DNS** settings. Leave **Host** empty for the domain itself. Delete the default records Porkbun adds for its parking page.
- **[Squarespace](https://support.squarespace.com/hc/en-us/articles/360002101888)** (including domains that were with Google Domains): in the domain's **DNS** settings, add the records under **Custom records**, with `@` for the domain itself. Delete the **Squarespace defaults**, or the domain keeps pointing at Squarespace.

Never delete MX records, which deliver the domain's email.

## Sites on Cloudflare Pages

A site published with Cloudflare Pages connects its domain in Cloudflare: open the site's Pages project, go to **Custom domains** and set up the domain.

- **A subdomain**, such as `www.example.org`, can keep its DNS where it is: Cloudflare shows a CNAME record pointing at the project's `pages.dev` address, to add at your registrar.
- **The domain itself**, such as `example.org`, has to use Cloudflare's nameservers. Cloudflare walks you through adding the domain to your account, copies its existing records, and shows the two nameservers to set at your registrar. Keep the MX records, which deliver the domain's email. To keep your DNS where it is instead, see [Keeping your DNS at your registrar](#keeping-your-dns-at-your-registrar).

Once the site opens at its new address, put the address in **Site Settings → General → Site address** and publish.

### Keeping your DNS at your registrar

To keep the domain's DNS where it is, put the site at `www.example.org` and have something else send visitors from `example.org` to it. Whatever you choose must work over HTTPS: many people type or follow `https://example.org`, and some domains, such as `.dev` and `.app`, only open over HTTPS. A redirect that only works over plain HTTP gives those visitors a security warning instead of your site. Once it's set up, open `https://example.org` to check that it reaches the site.

- **Your registrar's forwarding:** most registrars forward a domain for free, but many only over plain HTTP, and some only while the domain uses their own DNS. Porkbun says its forwarding works over HTTPS. Forward `example.org` to `https://www.example.org` as a permanent (301) redirect.
- **A redirect service:** services such as [redirect.pizza](https://redirect.pizza/support/redirecting-non-www-to-www) (free for a few domains and a limit on visits each month), [ApexToWWW](https://www.apextowww.com/) and [ApexWise](https://apexwise.io/) give you an A record (and sometimes an AAAA record) for `example.org`, set up HTTPS and redirect to `www`. They see every visit that comes in through `example.org`, and the redirect stops working if the service shuts down, so read their terms first.

Either way, the Site address is `https://www.example.org`.

## Sites on Vercel

A site published with Vercel connects its domain in Vercel: open the site's project, go to **Settings → Domains** and add the domain, and Vercel shows the records to add at your registrar. Once the site opens at its new address, put the address in **Site Settings → General → Site address** and publish.

## If it doesn't work

- **"Something else is there":** another record with the same name points elsewhere, such as the registrar's own page. Delete it.
- **The records are in place, but HTTPS isn't ready:** wait up to a day. If it still isn't, check for a CAA record at your registrar that leaves out Let's Encrypt, which issues the certificates, or for Cloudflare's proxy. Then remove the domain and connect it again.
- **The site opens, but looks unstyled or its links are broken:** the site needs rebuilding for its new address, which publishing does. Publish any change, or run the deploy again on GitHub or GitLab.
