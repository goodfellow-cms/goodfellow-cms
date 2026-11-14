import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ContentSource, loadSiteContent, serializeContent, shownContent } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { buttonOn, buttonsOn } from "./buttons.ts";
import type { ButtonPlace } from "./stripe.ts";

/** The Buy button at `place`, as `findButton()` finds it: on the site as visitors see it, as its pages render it. */
async function buttonFrom(source: ContentSource, place: ButtonPlace, reader?: "everyone" | "members") {
  return buttonOn(shownContent(await loadSiteContent(source)), place, reader);
}

const PRICE = "price_monthly";

/** The example's own content, with `changes` made to its files. */
async function site(changes: Record<string, unknown> = {}): Promise<ContentSource> {
  const files = new Map<string, string>();
  for (const name of await readdir("content", { recursive: true })) {
    const path = join("content", name).split("\\").join("/");
    if (path.endsWith(".json")) files.set(path, await readFile(path, "utf8"));
  }
  for (const [path, value] of Object.entries(changes)) files.set(path, serializeContent(value));
  return {
    read: async (path) => files.get(path),
    list: async (dir) => [...files.keys()].filter((path) => path.startsWith(`${dir}/`)),
  };
}

/** The Subscribe page, with its Buy button given `props`. */
async function subscribePage(props: Record<string, unknown>) {
  const page = JSON.parse(await readFile("content/pages/subscribe.json", "utf8"));
  const section = page.data.content[0];
  section.props.content = section.props.content.map((block: { type: string; props: object }) =>
    block.type === "BuyButton" ? { ...block, props: { ...block.props, ...props } } : block,
  );
  return page;
}

describe("Buy buttons", () => {
  it("sell the price the page as published gives them, found by their id in a block's slot", async () => {
    const content = await site({ "content/pages/subscribe.json": await subscribePage({ price: PRICE }) });
    expect(await buttonFrom(content, { page: "/subscribe", block: "BuyButton-monthly" })).toEqual({ price: PRICE });
    expect(await buttonFrom(content, { page: "/subscribe/", block: "BuyButton-monthly" })).toEqual({ price: PRICE });
  });

  it("sell nothing without a price, from a page the site doesn't show, or with an id that isn't a Buy button's", async () => {
    expect(await buttonFrom(await site(), { page: "/subscribe", block: "BuyButton-monthly" })).toBeUndefined();
    const notAPrice = await site({ "content/pages/subscribe.json": await subscribePage({ price: "prod_monthly" }) });
    expect(await buttonFrom(notAPrice, { page: "/subscribe", block: "BuyButton-monthly" })).toBeUndefined();
    const priced = await site({ "content/pages/subscribe.json": await subscribePage({ price: PRICE }) });
    expect(await buttonFrom(priced, { page: "/about", block: "BuyButton-monthly" })).toBeUndefined();
    expect(await buttonFrom(priced, { page: "/no-such-page", block: "BuyButton-monthly" })).toBeUndefined();
    expect(await buttonFrom(priced, { page: "/subscribe", block: "Heading-subscribe" })).toBeUndefined();
    // Only a Buy button's price, whatever else holds one.
    const heading = await subscribePage({ price: PRICE });
    heading.data.content[0].props.content[0].props.price = PRICE;
    const headed = await site({ "content/pages/subscribe.json": heading });
    expect(await buttonFrom(headed, { page: "/subscribe", block: "Heading-subscribe" })).toBeUndefined();
    // A page whose schedule hasn't shown it yet isn't for sale either.
    const scheduled = { ...(await subscribePage({ price: PRICE })), showFrom: "2999-01-01T00:00" };
    const hidden = await site({ "content/pages/subscribe.json": scheduled });
    expect(await buttonFrom(hidden, { page: "/subscribe", block: "BuyButton-monthly" })).toBeUndefined();
  });

  it("in a synced block sell its price, by the id they have on the page", async () => {
    const synced = {
      version: 1,
      title: "Subscribe",
      data: {
        content: [
          { type: "BuyButton", props: { id: "BuyButton-synced", label: "Subscribe", price: PRICE, className: "" } },
        ],
        root: { props: {} },
      },
    };
    const page = await subscribePage({});
    page.data.content.push({ type: "SyncedBlock", props: { id: "SyncedBlock-offer", block: "offer" } });
    const content = await site({ "content/synced-blocks/offer.json": synced, "content/pages/subscribe.json": page });
    const placed = await buttonFrom(content, { page: "/subscribe", block: "SyncedBlock-offer-BuyButton-synced" });
    expect(placed).toEqual({ price: PRICE });
    expect(await buttonFrom(content, { page: "/subscribe", block: "BuyButton-synced" })).toBeUndefined();
  });

  it("in the header or footer sell their price from any page they're shown on", async () => {
    const button = { type: "BuyButton", props: { id: "BuyButton-header", label: "Join", price: PRICE, className: "" } };
    const header = JSON.parse(await readFile("content/layout/header.json", "utf8"));
    header.data.content.push(button);
    const footer = JSON.parse(await readFile("content/layout/footer.json", "utf8"));
    footer.data.content.push({ ...button, props: { ...button.props, id: "BuyButton-footer" } });
    const content = await site({ "content/layout/header.json": header, "content/layout/footer.json": footer });
    expect(await buttonFrom(content, { page: "/about", block: "BuyButton-header" })).toEqual({ price: PRICE });
    // On a page a block adds, or one the site doesn't have, whose header and footer are its language's.
    expect(await buttonFrom(content, { page: "/events/2026-12", block: "BuyButton-header" })).toEqual({ price: PRICE });
    expect(await buttonFrom(content, { page: "/", block: "BuyButton-footer" })).toEqual({ price: PRICE });
  });

  it("in a synced block sell the price of the page's language's version of it", async () => {
    const offer = (price: string) => ({
      version: 1,
      title: "Subscribe",
      data: {
        content: [{ type: "BuyButton", props: { id: "BuyButton-synced", label: "Subscribe", price, className: "" } }],
        root: { props: {} },
      },
    });
    const page = await subscribePage({});
    page.data.content.push({ type: "SyncedBlock", props: { id: "SyncedBlock-offer", block: "offer" } });
    const settings = JSON.parse(await readFile("content/site.json", "utf8"));
    const content = await site({
      "content/site.json": { ...settings, languages: [{ code: "es", name: "Español" }] },
      "content/synced-blocks/offer.json": offer(PRICE),
      "content/synced-blocks/offer.es.json": offer("price_mensual"),
      "content/pages/subscribe.json": page,
      "content/pages/es/subscribe.json": { ...page, translationOf: "/subscribe" },
    });
    const block = "SyncedBlock-offer-BuyButton-synced";
    expect(await buttonFrom(content, { page: "/subscribe", block })).toEqual({ price: PRICE });
    expect(await buttonFrom(content, { page: "/es/subscribe", block })).toEqual({ price: "price_mensual" });
  });

  it("after a members-only page's Paywall sell only to members, as only they're shown them", async () => {
    const page = await subscribePage({ price: PRICE });
    page.data.root.props = { ...page.data.root.props, visibility: "members" };
    page.data.content.unshift({ type: "Paywall", props: { id: "Paywall-1" } });
    const content = await site({ "content/pages/subscribe.json": page });
    const place = { page: "/subscribe", block: "BuyButton-monthly" };
    expect(await buttonFrom(content, place)).toBeUndefined();
    expect(await buttonFrom(content, place, "everyone")).toBeUndefined();
    expect(await buttonFrom(content, place, "members")).toEqual({ price: PRICE });
    // Before the Paywall, they're for everyone.
    const before = await subscribePage({ price: PRICE });
    before.data.root.props = { ...before.data.root.props, visibility: "members" };
    before.data.content.push({ type: "Paywall", props: { id: "Paywall-1" } });
    expect(await buttonFrom(await site({ "content/pages/subscribe.json": before }), place)).toEqual({ price: PRICE });
  });

  it("are listed in a language's header where a synced block in the main language's has a version in that language", async () => {
    const offer = (price: string) => ({
      version: 1,
      title: "Join",
      data: {
        content: [{ type: "BuyButton", props: { id: "BuyButton-synced", label: "Join", price, className: "" } }],
        root: { props: {} },
      },
    });
    const header = JSON.parse(await readFile("content/layout/header.json", "utf8"));
    header.data.content.push({ type: "SyncedBlock", props: { id: "SyncedBlock-offer", block: "offer" } });
    const settings = JSON.parse(await readFile("content/site.json", "utf8"));
    const languages = { ...settings, languages: [{ code: "es", name: "Español" }] };
    const listed = async (files: Record<string, unknown>) =>
      buttonsOn(shownContent(await loadSiteContent(await site(files))))
        .filter((button) => button.part === "header")
        .map((button) => [button.page, button.price]);
    const both = { "content/site.json": languages, "content/layout/header.json": header };
    expect(await listed({ ...both, "content/synced-blocks/offer.json": offer(PRICE) })).toEqual([["/", PRICE]]);
    expect(
      await listed({
        ...both,
        "content/synced-blocks/offer.json": offer(PRICE),
        "content/synced-blocks/offer.es.json": offer("price_mensual"),
      }),
    ).toEqual([
      ["/", PRICE],
      ["/es", "price_mensual"],
    ]);
  });
});
