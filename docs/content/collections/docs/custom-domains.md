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

Once the site opens at its new address, put the address in **Site Settings → General → Site address** and publish. With **Sign in with Bitbucket**, change the OAuth consumer's callback URL to the new admin address, such as `https://example.org/admin/`, too; the Domain screen reminds you.

### Keeping your DNS at your registrar

To keep the domain's DNS where it is, put the site at `www.example.org` and have something else send visitors from `example.org` to it. Whatever you choose must work over HTTPS: many people type or follow `https://example.org`, and some domains, such as `.dev` and `.app`, only open over HTTPS. A redirect that only works over plain HTTP gives those visitors a security warning instead of your site. Once it's set up, open `https://example.org` to check that it reaches the site.

- **Your registrar's forwarding:** most registrars forward a domain for free, but many only over plain HTTP, and some only while the domain uses their own DNS. Porkbun says its forwarding works over HTTPS. Forward `example.org` to `https://www.example.org` as a permanent (301) redirect.
- **A redirect service:** services such as [redirect.pizza](https://redirect.pizza/support/redirecting-non-www-to-www) (free for a few domains and a limit on visits each month), [ApexToWWW](https://www.apextowww.com/) and [ApexWise](https://apexwise.io/) give you an A record (and sometimes an AAAA record) for `example.org`, set up HTTPS and redirect to `www`. They see every visit that comes in through `example.org`, and the redirect stops working if the service shuts down, so read their terms first.

Either way, the Site address is `https://www.example.org`.

## Sites on Vercel

A site published with Vercel, as every site on Bitbucket is, connects its domain in Vercel: open the site's project, go to **Settings → Domains** and add the domain, and Vercel shows the records to add at your registrar. Once the site opens at its new address, put the address in **Site Settings → General → Site address** and publish. With **Sign in with Bitbucket**, change the OAuth consumer's callback URL to the new admin address, such as `https://example.org/admin/`, too; the Domain screen reminds you.

## An admin address

The admin panel can have an address of its own beside the site's, such as `admin.example.org` beside `example.org`. Browsers keep what one address stores away from the other, so scripts on the site's pages, such as code pasted into Site Settings or a block's, can't reach what the admin panel keeps there, such as an editor's sign-in. It also lets admins add blocks from [registries other than Goodfellow's](/docs/add-blocks#other-registries).

It works on GitLab Pages, Cloudflare Pages and Vercel, which serve a site at more than one address. GitHub Pages serves each site at one address (and its `www`), so it can't have one there.

1. Connect the site's own domain first, as above.
2. In **Site Settings → Domain**, under **Admin address**, type the address, such as `admin.example.org`, and choose **Give the admin panel this address**.
   - **GitLab Pages:** Goodfellow connects it on GitLab Pages too and lists its records, which you add at your registrar as for the site's domain. The Domain screen follows them until GitLab has set up HTTPS for it.
   - **Cloudflare Pages and Vercel:** add the address to the site's project yourself, as for the site's own domain.
3. Goodfellow publishes the address in the site's `goodfellow.config.tsx`. When the site rebuilds, every page starts with a script that sends it to the site's own address when it's opened at the admin address, before anything else on it runs. On Cloudflare Pages and Vercel, the host also runs every page there but the admin panel's in a sealed-off sandbox.
4. Once the site has rebuilt, open the admin panel at the new address, with the link the Domain screen gives, and sign in again: it's a different address, so it keeps its own sign-in. It checks that the site's pages leave the address, then offers **Start using https://admin.example.org**.
5. That publishes the address as checked. Once the site has rebuilt again, the admin panel opens only there: `example.org/admin/` sends people to `admin.example.org/admin/`, and the admin panel refuses to be shown inside another page.

A few things to know:

- **Sign in with GitLab:** add the admin panel's new address, such as `https://admin.example.org/admin/`, to the GitLab application's redirect URIs too.
- **Signing in with GitHub** through a [sign-in service](/docs/sign-in-service) gives tokens to the admin address as well as the Site address, once the site has been rebuilt with it.
- **Content in a repository of its own:** the address is in the code's `goodfellow.config.tsx`, which the admin panel can't publish on a site whose [content is in a repository of its own](/docs/content-repository), so a developer finishes it there. See [With a content repository](#with-a-content-repository).
- **Pages opened at the wrong address:** the script every page starts with sends people to the right address in the browser. On Vercel, the site's setup also has Vercel send them there before anything loads: a site page opened at the admin address, such as `admin.example.org/about/`, goes to `example.org/about/`, and once the address is checked, `example.org/admin/` goes to `admin.example.org/admin/`. Only pages opened in a tab are sent, so the admin panel's previews and what pages load stay where they are. On Cloudflare Pages you can add the same as redirect rules; see [Redirects on Cloudflare](#redirects-on-cloudflare). GitLab Pages can't send them, so the scripts do it there.
- **Stopping:** **Stop using the admin address** removes it from the config, and on GitLab Pages from the site's domains. The admin panel goes back to the site's own address once the site has rebuilt.

### With a content repository

On a site whose content is in a repository of its own, the Domain screen connects the address but leaves the config to a developer, and shows what they run in the code's folder (`goodfellow-next` in place of `goodfellow` for a Next.js site):

1. In **Site Settings → Domain**, type the address and choose **Give the admin panel this address**. On GitLab Pages, Goodfellow connects it there and lists its records, as above; on Cloudflare Pages and Vercel, add it to the site's project yourself.
2. A developer runs `npx goodfellow admin add admin.example.org` and publishes the code. Where Vercel builds the site from the content repository, it also writes the address's header rules, and the address its redirects are worked out from, into the content repository's `vercel.ts`, since Vercel reads that file before the code is cloned: publish that too. Where Vercel builds from the code repository, the content isn't there yet when Vercel reads `vercel.ts`, so only the scripts send pages opened at the wrong address.
3. Once the site has rebuilt, the developer runs `npx goodfellow admin check`, which reads the site's home page at the admin address, as the Domain screen does from there, checks that it leaves the address before running anything (and is sandboxed on Cloudflare Pages and Vercel), and marks the address checked in `goodfellow.config.tsx`, and in the content repository's `vercel.ts` where it changed it before. Once that's published and the site has rebuilt, the admin panel opens only at the admin address.

`npx goodfellow admin remove` stops using it. The Domain screen shows how far it's got where the sign-in can read the code's repository.

### Redirects on Cloudflare

Cloudflare Pages can't send people from one address to another itself, but Cloudflare can, where the domain's DNS is on Cloudflare (not where you [keep it at your registrar](#keeping-your-dns-at-your-registrar)). They're optional, since every page's script does the same in the browser. In the Cloudflare dashboard, open the domain, go to **Rules → Redirect Rules**, and add a rule for each, choosing **Custom filter expression**, **Edit expression**, a **Dynamic** target, status code **307** and **Preserve query string**, with your own addresses in place of `example.org` and `admin.example.org`:

1. **Site pages opened at the admin address,** sent to the Site address:

   ```text
   http.host eq "admin.example.org" and not (http.request.uri.path eq "/admin" or starts_with(http.request.uri.path, "/admin/")) and any(http.request.headers["sec-fetch-dest"][*] eq "document")
   ```

   with the target `concat("https://example.org", http.request.uri.path)`.

2. **The admin panel opened at the Site address,** sent to the admin address. Add it only once the admin panel has checked the address, or you couldn't open it at the Site address to do so:

   ```text
   http.host eq "example.org" and (http.request.uri.path eq "/admin" or (starts_with(http.request.uri.path, "/admin/") and not starts_with(http.request.uri.path, "/admin/editor/") and not starts_with(http.request.uri.path, "/admin/plugins/"))) and any(http.request.headers["sec-fetch-dest"][*] eq "document")
   ```

   with the target `concat("https://admin.example.org", http.request.uri.path)`.

The `sec-fetch-dest` part sends only pages opened in a tab, so the admin panel's previews and what pages load stay where they are. Use 307, not a permanent redirect, which browsers remember after you change or stop using the address, and delete both rules if you do.

## If it doesn't work

- **"Something else is there":** another record with the same name points elsewhere, such as the registrar's own page. Delete it.
- **The records are in place, but HTTPS isn't ready:** wait up to a day. If it still isn't, check for a CAA record at your registrar that leaves out Let's Encrypt, which issues the certificates, or for Cloudflare's proxy. Then remove the domain and connect it again.
- **The site opens, but looks unstyled or its links are broken:** the site needs rebuilding for its new address, which publishing does. Publish any change, or run the deploy again on GitHub or GitLab.
