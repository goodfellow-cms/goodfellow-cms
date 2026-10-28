---
version: 1
title: Forms
description: Contact forms and sign-up forms whose answers are emailed to you by a form service, and Google Forms on the site's pages.
section: editors
order: 3.8
---

The **Form** block puts a form on any page: a contact form, a prayer request, a sign-up for an event. Its questions are set in the editor, and its answers go to a form service, which emails them to you. The site has no server of its own, so answers are never kept with the site's pages or in its repository; they're only where the form service keeps them.

## Choose a form service

Forms send their answers to the service chosen once for the whole site, in **Site Settings → General → Forms**:

- **Web3Forms**, the default: free for 250 answers a month, with no account. On [Web3Forms' site](https://app.web3forms.com/onboarding/create), enter the email address answers should go to, and Web3Forms emails you an access key. Paste it into **Web3Forms access key**. Its free plan sends visitors back only to a page on the same site as the form, so visitors see Web3Forms' own thank-you page when the thank-you page is on another site, or when a form is tried out anywhere but the Site address, such as on your own computer; its paid plans send them anywhere.
- **Formspree:** make a form in [Formspree](https://formspree.io) and paste its address, such as `https://formspree.io/f/xyzabcde`. On Formspree's free plan, visitors see Formspree's own thank-you page; its paid plans send them to one of yours, set in Formspree's settings for the form.
- **Another service:** any service that takes a plain form post, such as [FormSubmit](https://formsubmit.co) or [Formcarry](https://formcarry.com). Paste the address the service gives for its forms, starting with `https://`. Forms send the thank-you page's address as `_next`, the form's name as `_subject`, and the hidden field that catches robots as `_gotcha`, as Formspree, FormSubmit and Formcarry expect.

Until a service is set up, forms show a note in the editor and don't appear on the site, so visitors never see a form that can't send.

## Questions

Each question has its wording, the kind of answer, whether it must be answered, and optional help text shown under it. Kinds of answer:

| Kind | Shown as |
|---|---|
| Short answer, Long answer | A line or a box for text |
| Email address, Phone number, Number, Date | Fields that phones show the right keyboard for, and browsers check |
| A list to choose one from | A drop-down list |
| One of several choices | Choices with round buttons |
| Any of several choices | Choices with tick boxes |
| A box to tick | One tick box, such as "I agree to be contacted" |

For lists and choices, write each choice on a line of its own. Browsers check that questions that must be answered are, and that email addresses look right, before anything is sent, with no JavaScript.

The emails show each answer under its question's wording. The first email address question is the one the service replies to, so replying to the email answers the person who sent it.

## After sending

**Page visitors see after sending** is one of the site's pages, such as `/thank-you`, or a full address on another site. Make the page first, as any other page. Without one, visitors see the form service's own thank-you page, since a form that works without JavaScript can't show its own message. The form service sends visitors there once their answers are on their way, so it needs the full address, which comes from the **Site address** in Site Settings: until that's set, visitors see the service's own thank-you page. They also see it on Formspree's free plan, and on Web3Forms' free plan when the thank-you page is on another site or the form isn't on the Site address (see [Choose a form service](#choose-a-form-service)).

In the site's [app](/docs/apps), the form sends the answers itself and then opens the thank-you page, or shows **In the site's app: what it says once the answers are sent** where there's none, and **what it says when the answers couldn't be sent** when they couldn't, such as with no connection.

**The form's name** is the subject of the emails answers arrive in, so give each form its own, such as "Prayer request" or "Volunteer sign-up".

## Spam

Every form has a field that people never see, which robots fill in. Services throw away answers that have it filled in. Formspree also asks visitors who might be robots to tick its reCAPTCHA box before their answers are sent.

With Web3Forms, **Ask visitors to show they aren't robots (hCaptcha)** adds Web3Forms' hCaptcha to every form. It needs Web3Forms' script on pages with a form, so it's off by default, and the editor shows where the hCaptcha will go rather than loading it. Web3Forms only turns away answers without it when hCaptcha is also turned on for the form in a Web3Forms account.

## Google Forms

Longer forms, such as surveys and sign-up sheets, can be made in [Google Forms](https://forms.google.com), whose answers go to a Google spreadsheet. Set the Form block's **Questions** to **A Google form**, then in Google Forms choose **Send**, the **<>** tab, and copy the embed code into the block. The form shows on the page, as tall as the embed code says. Short `forms.gle` links can't be shown, since the block can't find out which form they open; use the embed code instead.

Google forms don't use the site's form service, so they work without one, and their answers stay in Google.
