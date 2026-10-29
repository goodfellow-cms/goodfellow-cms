import { type Page, type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { describe, expect, it } from "vitest";
import { blocks, categories } from "./index.js";
import { type NewsletterProps, newsletterTarget } from "./newsletter.js";
import { htmlSignupForm } from "./newsletter-data.js";

const renderPage = createPageRenderer({ blocks, categories });

const KEY = "0b5c4f7e-1a2b-4c3d-8e9f-0123456789ab";

function site(forms?: unknown): SiteContent {
  return {
    settings: siteSettingsSchema.parse({
      version: 1,
      title: "St. Joseph",
      url: "https://parish.example.org",
      language: "en",
      ...(forms !== undefined && { forms }),
    }),
    menus: {},
    header: { version: 1, data: { root: {}, content: [] } },
    footer: { version: 1, data: { root: {}, content: [] } },
    pages: [],
    collections: [],
    customCss: "",
  };
}

async function render(content: SiteContent, props: Partial<NewsletterProps>): Promise<string> {
  const page: Page = {
    path: "/",
    file: "content/pages/index.json",
    content: {
      version: 1,
      data: {
        root: { props: {} },
        content: [{ type: "Newsletter", props: { id: "news", ...blocks.Newsletter.defaultProps, ...props } }],
      },
    },
  };
  const html = await renderPage(content, page);
  return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
}

const MAILCHIMP = `<div id="mc_embed_shell">
<form action="https://parish.us21.list-manage.com/subscribe/post?u=0a1b2c3d4e5f&amp;id=9f8e7d6c5b&amp;f_id=00a1b2e1f0" method="post" id="mc-embedded-subscribe-form" target="_blank">
<input type="email" name="EMAIL" required="" value="">
<div aria-hidden="true" style="position: absolute; left: -5000px;"><input type="text" name="b_0a1b2c3d4e5f_9f8e7d6c5b" tabindex="-1" value=""></div>
</form></div>`;

describe("newsletterTarget", () => {
  const target = (service: NewsletterProps["service"], form: string) =>
    newsletterTarget({ service, form, heading: "News" }, undefined);

  it("reads Mailchimp's embed code and address, with its honeypot", () => {
    const expected = {
      service: "mailchimp",
      action: "https://parish.us21.list-manage.com/subscribe/post?u=0a1b2c3d4e5f&id=9f8e7d6c5b&f_id=00a1b2e1f0",
      email: "EMAIL",
      name: "FNAME",
      hidden: [],
      honeypot: { name: "b_0a1b2c3d4e5f_9f8e7d6c5b", type: "text" },
      captcha: false,
    };
    expect(target("mailchimp", MAILCHIMP)).toEqual(expected);
    expect(target("mailchimp", expected.action)).toEqual(expected);
    expect(target("mailchimp", "https://parish.list-manage.com/subscribe/post?u=0a1b&id=9f8e")).toMatchObject({
      action: "https://parish.list-manage.com/subscribe/post?u=0a1b&id=9f8e",
    });
  });

  it("reads Buttondown's username, address and embed code", () => {
    const action = "https://buttondown.com/api/emails/embed-subscribe/stjoseph";
    for (const form of [
      "stjoseph",
      "https://buttondown.com/stjoseph",
      "https://buttondown.email/stjoseph",
      `<form action="${action}" method="post" target="popupwindow"><input type="email" name="email"></form>`,
    ]) {
      expect(target("buttondown", form)).toEqual({
        service: "buttondown",
        action,
        email: "email",
        hidden: [{ name: "embed", value: "1" }],
        captcha: false,
      });
    }
  });

  it("reads Kit's form number, address and embed code", () => {
    for (const form of [
      "1234567",
      "https://app.kit.com/forms/1234567/subscriptions",
      "https://app.convertkit.com/forms/1234567/subscriptions",
      '<form action="https://app.kit.com/forms/1234567/subscriptions" class="seva-form formkit-form" method="post">',
    ]) {
      expect(target("kit", form)).toMatchObject({
        action: "https://app.kit.com/forms/1234567/subscriptions",
        email: "email_address",
        name: "fields[first_name]",
      });
    }
  });

  it("posts only to the service's own address, and only securely", () => {
    for (const [service, form] of [
      ["mailchimp", "https://evil.example/subscribe/post?u=0a1b&id=9f8e"],
      ["mailchimp", "http://parish.us21.list-manage.com/subscribe/post?u=0a1b&id=9f8e"],
      ["mailchimp", "https://parish.us21.list-manage.com/subscribe/post?u=0a1b"],
      ["mailchimp", "https://list-manage.com.evil.example/subscribe/post?u=0a1b&id=9f8e"],
      ["buttondown", "https://evil.example/api/emails/embed-subscribe/stjoseph"],
      ["buttondown", "stjoseph/../admin"],
      ["kit", "https://evil.example/forms/1234567/subscriptions"],
      ["kit", "https://app.kit.com/forms/abc/subscriptions"],
    ] as const) {
      expect(target(service, form)).toEqual({ problem: "bad-form" });
    }
    expect(target("mailchimp", "  ")).toEqual({ problem: "no-form" });
  });

  it("uses the site's form service, with its key, honeypot and thank-you page", () => {
    expect(
      newsletterTarget(
        { service: "forms", form: "", heading: "Parish news" },
        { service: "web3forms", accessKey: KEY },
        {
          from: "St. Joseph",
          redirect: "https://parish.example.org/thanks",
        },
      ),
    ).toEqual({
      service: "forms",
      action: "https://api.web3forms.com/submit",
      email: "email",
      name: "Name",
      hidden: [
        { name: "access_key", value: KEY },
        { name: "subject", value: "Parish news" },
        { name: "from_name", value: "St. Joseph" },
        { name: "redirect", value: "https://parish.example.org/thanks" },
      ],
      honeypot: { name: "botcheck", type: "checkbox" },
      captcha: false,
    });
    expect(newsletterTarget({ service: "forms", form: "", heading: "" }, undefined)).toEqual({ problem: "no-key" });
  });
});

describe("Newsletter", () => {
  it("posts a plain form straight to Mailchimp, with a label for the email box", async () => {
    const html = await render(site(), { form: MAILCHIMP, askName: true });
    expect(html).toContain(
      'action="https://parish.us21.list-manage.com/subscribe/post?u=0a1b2c3d4e5f&amp;id=9f8e7d6c5b&amp;f_id=00a1b2e1f0" method="post"',
    );
    expect(html).toMatch(/<input type="text" class="hidden" [^>]*name="b_0a1b2c3d4e5f_9f8e7d6c5b"/);
    expect(html).toContain('<label for="news-email" class="gf-newsletter-label sr-only">Email address</label>');
    expect(html).toMatch(/<input id="news-email" type="email" required="" autoComplete="email" [^>]*name="EMAIL"/);
    expect(html).toMatch(/<input id="news-name" type="text" autoComplete="given-name" [^>]*name="FNAME"/);
    expect(html).toContain('<h2 class="gf-newsletter-heading');
    expect(html).toContain(">Subscribe</button>");
    // Only the structured data for search engines, which isn't JavaScript.
    expect(html).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });

  it("shows visible labels when the button is under the box, and asks for no name where Buttondown takes none", async () => {
    const html = await render(site(), { service: "buttondown", form: "stjoseph", askName: true, layout: "stacked" });
    expect(html).toContain(
      '<label for="news-email" class="gf-newsletter-label block font-medium">Email address</label>',
    );
    expect(html).toContain('<input type="hidden" name="embed" value="1"/>');
    expect(html).not.toContain("news-name");
  });

  it("shows nothing on the site until it can sign people up", async () => {
    expect(await render(site(), { form: "" })).not.toContain("gf-newsletter");
    expect(await render(site(), { service: "forms" })).not.toContain("gf-newsletter");
    expect(await render(site({ accessKey: KEY }), { service: "forms", thankYou: "/thanks" })).toContain(
      '<input type="hidden" name="redirect" value="https://parish.example.org/thanks"/>',
    );
  });
});

describe("Another service's signup form", () => {
  const LISTS = `<div class="signup"><form method="post" action="https://lists.example.org/subscribe?list=parish&amp;src=site" class="form">
  <label for="e">Email</label><input id="e" type="email" name="field_email" required placeholder="you@example.org">
  <input type="text" name="FirstName" placeholder="First name">
  <input type="hidden" name="list_id" value="a1&amp;b2">
  <input type="hidden" name="list_id" value="c3">
  <div aria-hidden="true" style="position:absolute;left:-5000px"><input type="text" name="hp_9f" tabindex="-1" value=""></div>
  <label><input type="checkbox" name="interest[news]" value="1"> News</label>
  <select name="country"><option>Elsewhere</option></select>
  <input type="submit" value="Subscribe">
</form></div>`;

  it("reads where it sends, its email and first name boxes, hidden fields and the box only bots fill in", () => {
    expect(htmlSignupForm(LISTS)).toEqual({
      service: "other",
      action: "https://lists.example.org/subscribe?list=parish&src=site",
      email: "field_email",
      name: "FirstName",
      hidden: [
        { name: "list_id", value: "a1&b2" },
        { name: "list_id", value: "c3" },
      ],
      honeypot: { name: "hp_9f", type: "text" },
      captcha: false,
      leftOut: 2,
    });
  });

  it("keeps a form that sends with GET, and finds an email box by its name", () => {
    expect(htmlSignupForm('<form action="https://news.example/join"><input name="EMAIL" type="text"></form>')).toEqual({
      service: "other",
      action: "https://news.example/join",
      method: "get",
      email: "EMAIL",
      hidden: [],
      captcha: false,
    });
  });

  it("refuses forms that aren't secure, have no email box, or are only a script or a frame", () => {
    for (const code of [
      '<form action="http://news.example/join" method="post"><input type="email" name="email"></form>',
      '<form action="javascript:alert(1)" method="post"><input type="email" name="email"></form>',
      '<form action="https://news.example/join" method="post"><input type="text" name="name"></form>',
      '<form action="https://news.example/join" method="dialog"><input type="email" name="email"></form>',
      '<script src="https://news.example/embed.js" data-form="123"></script>',
      '<iframe src="https://news.example/embed"></iframe>',
    ]) {
      expect(htmlSignupForm(code), code).toBeUndefined();
    }
  });

  it("draws the block's own form with the service's names, and tells the editor what it leaves out", async () => {
    const html = await render(site(), { service: "other", form: LISTS, askName: true });
    expect(html).toContain('action="https://lists.example.org/subscribe?list=parish&amp;src=site" method="post"');
    expect(html).toMatch(/<input id="news-email" [^>]*name="field_email"/);
    expect(html).toMatch(/<input id="news-name" [^>]*name="FirstName"/);
    expect(html).toContain('<input type="hidden" name="list_id" value="a1&amp;b2"/>');
    expect(html).not.toContain("interest[news]");
    expect(html).not.toContain("more questions");
    expect(await render(site(), { service: "other", form: "<script></script>" })).not.toContain("gf-newsletter");
  });
});
