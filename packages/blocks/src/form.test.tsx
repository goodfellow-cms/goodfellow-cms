import { type Page, type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { describe, expect, it } from "vitest";
import { answerNames, type FormField, type FormProps } from "./form.js";
import { blocks, categories } from "./index.js";

const renderPage = createPageRenderer({ blocks, categories });

const KEY = "0b5c4f7e-1a2b-4c3d-8e9f-0123456789ab";

function site(forms: unknown, url: string | undefined = "https://parish.example.org"): SiteContent {
  return {
    settings: siteSettingsSchema.parse({ version: 1, title: "St. Joseph", url, language: "en", forms }),
    menus: {},
    header: { version: 1, data: { root: {}, content: [] } },
    footer: { version: 1, data: { root: {}, content: [] } },
    pages: [],
    collections: [],
    customCss: "",
  };
}

async function render(content: SiteContent, props: Partial<FormProps>, whole = false): Promise<string> {
  const page: Page = {
    path: "/",
    file: "content/pages/index.json",
    content: {
      version: 1,
      data: {
        root: { props: {} },
        content: [{ type: "Form", props: { id: "contact", ...blocks.Form.defaultProps, ...props } }],
      },
    },
  };
  const html = await renderPage(content, page);
  if (whole) return html;
  return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
}

const field = (label: string, type: FormField["type"], extra: Partial<FormField> = {}): FormField => ({
  label,
  type,
  required: false,
  choices: "",
  hint: "",
  ...extra,
});

describe("Form", () => {
  it("posts its answers to Web3Forms with a plain form, sending visitors back to the thank-you page", async () => {
    const html = await render(site({ accessKey: KEY }), { thankYou: "/thank-you", title: "Prayer request" });
    expect(html).toContain(
      '<form class="gf-form-questions space-y-5" action="https://api.web3forms.com/submit" method="post">',
    );
    expect(html).toContain(`<input type="hidden" name="access_key" value="${KEY}"/>`);
    expect(html).toContain('<input type="hidden" name="subject" value="Prayer request"/>');
    expect(html).toContain('<input type="hidden" name="from_name" value="St. Joseph"/>');
    expect(html).toContain('<input type="hidden" name="redirect" value="https://parish.example.org/thank-you/"/>');
    expect(html).toMatch(
      /<input type="checkbox" class="hidden" style="display:none" tabindex="-1" [^>]*name="botcheck"/,
    );
    expect(html).toMatch(/<input id="contact-0" type="text" required="" [^>]*name="Name"/);
    expect(html).toMatch(/<input id="contact-1" type="email" required="" autoComplete="email" [^>]*name="email"/);
    expect(html).toMatch(/<textarea id="contact-2" name="Message" rows="5" required=""/);
    expect(html).toContain('<label for="contact-0" class="gf-form-label block font-medium">Name');
    expect(html).toContain(">Send</button>");
    // No JavaScript unless hCaptcha is on.
    // Only the structured data for search engines, which isn't JavaScript.
    expect(html).not.toMatch(/<script(?! type="application\/ld\+json")/);
  });

  it("shows every kind of question", async () => {
    const html = await render(site({ accessKey: KEY }), {
      fields: [
        field("Phone", "phone", { hint: "So we can call you back" }),
        field("Guests", "number"),
        field("Arriving", "date"),
        field("Mass", "select", { choices: "Saturday 5 pm\nSunday 9 am\n\nSunday 9 am", required: true }),
        field("Ministry", "radio", { choices: "Choir\nReaders", required: true }),
        field("Help with", "checkboxes", { choices: "Set-up\nTidying" }),
        field("I agree to be contacted", "checkbox", { required: true }),
      ],
    });
    expect(html).toMatch(
      /<input id="contact-0" type="tel" autoComplete="tel" aria-describedby="contact-0-hint" [^>]*name="Phone"/,
    );
    expect(html).toContain(
      '<p id="contact-0-hint" class="gf-form-hint text-sm text-muted-foreground">So we can call you back</p>',
    );
    expect(html).toMatch(/type="number" [^>]*name="Guests"/);
    expect(html).toMatch(/type="date" [^>]*name="Arriving"/);
    expect(html).toContain('<option value="" disabled="" selected="">—</option><option value="Saturday 5 pm">');
    expect(html.match(/<option value="Sunday 9 am">/g)).toHaveLength(1);
    expect(html).toContain('<legend class="gf-form-label font-medium">Ministry');
    expect(html).toMatch(/<input type="radio" required="" [^>]*name="Ministry" value="Choir"\/>/);
    expect(html).toMatch(/<input type="checkbox" [^>]*name="Help with: Set-up" value="Yes"\/>/);
    expect(html).toMatch(/<input type="checkbox" required="" [^>]*name="I agree to be contacted" value="Yes"\/>/);
  });

  it("names answers by their questions, with the first email address as the one to reply to", () => {
    expect(
      answerNames([
        field("Your email", "email"),
        field("A friend's email", "email"),
        field("Subject", "text"),
        field("Name", "text"),
        field("name", "text"),
        field("", "text"),
        field("_next", "text"),
      ]),
    ).toEqual(["email", "A friend's email", "Subject (answer)", "Name", "name (2)", "Question 6", "next"]);
  });

  it("posts to Formspree, which sets its own thank-you page", async () => {
    const html = await render(site({ service: "formspree", address: "xyzabcde" }), { thankYou: "/thank-you" });
    expect(html).toContain('action="https://formspree.io/f/xyzabcde"');
    expect(html).toContain('<input type="hidden" name="_subject" value="Contact form"/>');
    expect(html).not.toContain("_next");
    expect(html).toMatch(/<input type="text" class="hidden" [^>]*name="_gotcha"\/>/);
  });

  it("adds Web3Forms' hCaptcha and script only when it's turned on", async () => {
    const html = await render(site({ accessKey: KEY, captcha: true }), {}, true);
    expect(html).toContain('<div class="h-captcha" data-captcha="true"></div>');
    expect(html.match(/<script src="https:\/\/web3forms.com\/client\/script.js" async=""/g)).toHaveLength(1);
  });

  it("holds back hCaptcha and Google forms until visitors agree, on a site that asks", async () => {
    const asking = (forms: unknown) => {
      const content = site(forms);
      return { ...content, settings: siteSettingsSchema.parse({ ...content.settings, consent: {} }) };
    };
    const captcha = await render(asking({ accessKey: KEY, captcha: true }), {}, true);
    expect(captcha).toContain('<script data-gf-consent-src="https://web3forms.com/client/script.js"></script>');
    expect(captcha).not.toContain('<script src="https://web3forms.com/client/script.js"');
    expect(captcha).toContain("This comes from web3forms.com, which can set cookies.");
    const google = await render(asking(undefined), {
      source: "google",
      google: "https://docs.google.com/forms/d/e/1FAIpQLSf9x2k3m4n5p6q7r8s9t0uVwXyZ/viewform?embedded=true",
    });
    expect(google).toMatch(
      /<div class="gf-consent-box"><iframe class="gf-form-embed[^"]*" style="height:800px" data-gf-consent-src="https:\/\/docs\.google\.com\//,
    );
    expect(google).toContain("This comes from docs.google.com, which can set cookies.");
  });

  it("fills in settings stored props leave out", async () => {
    const html = await render(site({ accessKey: KEY }), {
      title: undefined,
      fields: [{ label: "Name" } as FormField, { type: "select" } as FormField],
    } as unknown as Partial<FormProps>);
    expect(html).toMatch(/<input id="contact-0" type="text" [^>]*name="Name"\/>/);
    expect(html).toMatch(/<select id="contact-1" name="Question 2"/);
    expect(html).toContain('<input type="hidden" name="subject" value="Contact form"/>');
  });

  it("shows nothing on the site until answers have somewhere to go", async () => {
    expect(await render(site(undefined), {})).not.toContain("<form");
    expect(await render(site({ service: "other", address: "http://forms.example.org" }), {})).not.toContain("<form");
  });

  it("shows a Google form in a sandbox, as tall as its embed code says", async () => {
    const html = await render(site(undefined), {
      source: "google",
      title: "Volunteer sign-up",
      google:
        '<iframe src="https://docs.google.com/forms/d/e/1FAIpQLSf9x2k3m4n5p6q7r8s9t0uVwXyZ/viewform?embedded=true" width="640" height="1162">Loading…</iframe>',
    });
    expect(html).toContain(
      'src="https://docs.google.com/forms/d/e/1FAIpQLSf9x2k3m4n5p6q7r8s9t0uVwXyZ/viewform?embedded=true"',
    );
    expect(html).toContain('style="height:1162px"');
    expect(html).toContain('title="Volunteer sign-up"');
    expect(html).toContain('sandbox="allow-scripts allow-same-origin allow-forms allow-popups');
    expect(await render(site(undefined), { source: "google", google: "https://forms.gle/AbCdEf123" })).not.toContain(
      "<iframe",
    );
  });
});
