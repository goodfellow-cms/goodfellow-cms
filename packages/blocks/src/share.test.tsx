import { type Page, type SiteContent, siteSettingsSchema } from "@goodfellow-cms/core";
import { createPageRenderer } from "@goodfellow-cms/react/server";
import { describe, expect, it } from "vitest";
import { blocks, categories } from "./index.js";
import { givingPage, shareLink } from "./share-data.js";

const renderPage = createPageRenderer({ blocks, categories });

function site(url?: string): SiteContent {
  return {
    settings: siteSettingsSchema.parse({ version: 1, title: "St. Joseph", language: "en", ...(url && { url }) }),
    menus: {},
    header: { version: 1, data: { root: {}, content: [] } },
    footer: { version: 1, data: { root: {}, content: [] } },
    pages: [],
    collections: [],
    customCss: "",
  };
}

async function render(
  type: keyof typeof blocks,
  props: Record<string, unknown>,
  content = site("https://parish.example.org"),
) {
  const page: Page = {
    path: "/news",
    file: "content/pages/news.json",
    content: {
      version: 1,
      data: {
        root: { props: { title: "Parish news" } },
        content: [{ type, props: { id: "b", ...blocks[type].defaultProps, ...props } }],
      },
    },
  };
  const html = await renderPage(content, page);
  return html.slice(html.indexOf("<main"), html.indexOf("</main>"));
}

describe("Share buttons", () => {
  it("links to share the page's full address, opening other sites in a new tab", async () => {
    const html = await render("ShareButtons", {});
    expect(html).toContain("Share this page");
    expect(html).toMatch(
      /href="https:\/\/www\.facebook\.com\/sharer\/sharer\.php\?u=https%3A%2F%2Fparish\.example\.org%2Fnews"[^>]* target="_blank"/,
    );
    expect(html).toContain('href="mailto:?subject=');
    expect(html).not.toContain("linkedin");
    // Only links: nothing from these sites loads.
    expect(html).not.toMatch(/<(script|iframe)/);
  });

  it("shows nothing without the Site address, since the links couldn't say where the page is", async () => {
    expect(await render("ShareButtons", {}, site())).not.toContain("gf-share");
  });

  it("writes each site's share address", () => {
    expect(shareLink("x", "https://a.example/b", "News")).toBe(
      "https://x.com/intent/post?url=https%3A%2F%2Fa.example%2Fb&text=News",
    );
    expect(shareLink("bluesky", "https://a.example/b", "News")).toBe(
      "https://bsky.app/intent/compose?text=News+https%3A%2F%2Fa.example%2Fb",
    );
    expect(shareLink("email", "https://a.example/b", "Our news")).toBe(
      "mailto:?subject=Our%20news&body=https%3A%2F%2Fa.example%2Fb",
    );
  });
});

describe("Donate button", () => {
  it("links to a secure giving page, saying where people give", async () => {
    const html = await render("Donate", { url: "https://donate.stripe.com/test_123", text: "Every gift helps." });
    expect(html).toContain('href="https://donate.stripe.com/test_123"');
    expect(html).toContain("Support our work");
    expect(html).toContain("You&#x27;ll give on Stripe&#x27;s secure page.");
  });

  it("refuses pages that aren't secure", async () => {
    expect(await render("Donate", { url: "http://pay.example.org" })).not.toContain("gf-donate");
    expect(givingPage("javascript:alert(1)")).toBeUndefined();
    expect(givingPage("https://www.paypal.com/donate/?hosted_button_id=X")?.service).toBe("PayPal");
    expect(givingPage("https://give.example.org/")?.service).toBeUndefined();
  });
});

describe("Document viewer", () => {
  it("shows a PDF from the media library, with a link to open it", async () => {
    const html = await render("Document", { file: "/media/bulletin.pdf", height: 600 });
    expect(html).toContain('<iframe src="/media/bulletin.pdf" title="bulletin.pdf" loading="lazy"');
    expect(html).toContain("height:600px");
    expect(html).toContain('href="/media/bulletin.pdf"');
    expect(html).toContain("Open the document");
  });

  it("shows nothing but PDFs", async () => {
    expect(await render("Document", { file: "/media/photo.jpg" })).not.toContain("<iframe");
    expect(await render("Document", { file: "/media/../admin/index.pdf" })).not.toContain("<iframe");
  });

  it("shows the media storage's PDFs, and only links to other sites', which could be pages", async () => {
    const stored = {
      ...site("https://parish.example.org"),
      mediaStorage: { plugin: "goodfellow-plugin-s3", url: "https://media.example.org/site", files: {} },
    };
    expect(await render("Document", { file: "https://media.example.org/site/bulletin.pdf" }, stored)).toContain(
      '<iframe src="https://media.example.org/site/bulletin.pdf"',
    );
    const elsewhere = await render("Document", { file: "https://elsewhere.example/x.pdf" }, stored);
    expect(elsewhere).not.toContain("<iframe");
    expect(elsewhere).toContain('href="https://elsewhere.example/x.pdf"');
    expect(await render("Document", { file: "https://media.example.org/site/../x.pdf" }, stored)).not.toContain(
      "<iframe",
    );
  });
});
