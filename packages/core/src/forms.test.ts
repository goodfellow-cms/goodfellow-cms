import { describe, expect, it } from "vitest";
import { formRedirect, formspreeAddress, formTarget, googleFormUrl } from "./forms.js";

const KEY = "0b5c4f7e-1a2b-4c3d-8e9f-0123456789ab";

describe("formTarget", () => {
  it("posts to Web3Forms by default, with its key, subject, redirect and honeypot", () => {
    expect(
      formTarget(
        { service: "web3forms", accessKey: ` ${KEY} ` },
        { subject: "Prayer request", from: "St. Joseph", redirect: "https://parish.example.org/thanks" },
      ),
    ).toEqual({
      service: "web3forms",
      action: "https://api.web3forms.com/submit",
      hidden: [
        { name: "access_key", value: KEY },
        { name: "subject", value: "Prayer request" },
        { name: "from_name", value: "St. Joseph" },
        { name: "redirect", value: "https://parish.example.org/thanks" },
      ],
      honeypot: { name: "botcheck", type: "checkbox" },
      captcha: false,
      redirects: true,
    });
    expect(formTarget({ service: "web3forms", accessKey: KEY, captcha: true })).toMatchObject({ captcha: true });
  });

  it("says what's missing", () => {
    expect(formTarget(undefined)).toEqual({ problem: "no-key" });
    expect(formTarget({ service: "web3forms", accessKey: "my-email@example.org" })).toEqual({ problem: "bad-key" });
    expect(formTarget({ service: "formspree" })).toEqual({ problem: "no-address" });
    expect(formTarget({ service: "formspree", address: "https://example.org/f/abc" })).toEqual({
      problem: "bad-address",
    });
    expect(formTarget({ service: "other", address: "http://forms.example.org/send" })).toEqual({
      problem: "bad-address",
    });
  });

  it("posts to Formspree from its form's address or ID, which sets its own thank-you page", () => {
    expect(formspreeAddress("xyzabcde")).toBe("https://formspree.io/f/xyzabcde");
    expect(formspreeAddress("https://formspree.io/f/xyzabcde")).toBe("https://formspree.io/f/xyzabcde");
    const target = formTarget(
      { service: "formspree", address: "https://formspree.io/f/xyzabcde" },
      { subject: "Volunteers", redirect: "https://parish.example.org/thanks" },
    );
    expect(target).toMatchObject({
      action: "https://formspree.io/f/xyzabcde",
      hidden: [{ name: "_subject", value: "Volunteers" }],
      honeypot: { name: "_gotcha", type: "text" },
      redirects: false,
    });
  });

  it("posts to any other secure address, with Formspree's names for the rest", () => {
    expect(
      formTarget(
        { service: "other", address: "https://formsubmit.co/office@example.org" },
        { redirect: "https://parish.example.org/thanks" },
      ),
    ).toMatchObject({
      action: "https://formsubmit.co/office@example.org",
      hidden: [{ name: "_next", value: "https://parish.example.org/thanks" }],
      redirects: true,
    });
  });
});

describe("formRedirect", () => {
  it("makes the thank-you page's full address from the site's", () => {
    expect(formRedirect("https://parish.example.org", "/thanks")).toBe("https://parish.example.org/thanks/");
    expect(formRedirect("https://example.github.io/parish/", "/thanks")).toBe(
      "https://example.github.io/parish/thanks/",
    );
    // As the site's pages' addresses end, where the host serves them without a slash.
    expect(formRedirect("https://parish.example.org", "/thanks/", false)).toBe("https://parish.example.org/thanks");
    expect(formRedirect(undefined, "https://other.example.org/done")).toBe("https://other.example.org/done");
    expect(formRedirect(undefined, "/thanks")).toBeUndefined();
    expect(formRedirect("https://parish.example.org", "")).toBeUndefined();
  });
});

describe("googleFormUrl", () => {
  const id = "1FAIpQLSf9x2k3m4n5p6q7r8s9t0uVwXyZ";
  it("reads a form's embed code and addresses", () => {
    expect(
      googleFormUrl(
        `<iframe src="https://docs.google.com/forms/d/e/${id}/viewform?embedded=true" width="640" height="1162" frameborder="0">Loading…</iframe>`,
      ),
    ).toEqual({ url: `https://docs.google.com/forms/d/e/${id}/viewform?embedded=true`, height: 1162 });
    expect(googleFormUrl(`https://docs.google.com/forms/d/e/${id}/viewform?usp=sf_link`)).toEqual({
      url: `https://docs.google.com/forms/d/e/${id}/viewform?embedded=true`,
    });
    expect(googleFormUrl("https://docs.google.com/forms/d/1aBcDeFgHiJkLmNoPqRsT/edit")).toEqual({
      url: "https://docs.google.com/forms/d/1aBcDeFgHiJkLmNoPqRsT/viewform?embedded=true",
    });
  });

  it("explains short links and refuses other addresses", () => {
    expect(googleFormUrl("https://forms.gle/AbCdEf123")).toEqual({ problem: "short-link" });
    expect(googleFormUrl("https://docs.google.com/document/d/abc1234567890/edit")).toEqual({ problem: "not-a-form" });
    expect(googleFormUrl(`https://docs.google.com.example.org/forms/d/e/${id}/viewform`)).toEqual({
      problem: "not-a-form",
    });
    expect(googleFormUrl("")).toEqual({ problem: "not-a-form" });
  });
});
