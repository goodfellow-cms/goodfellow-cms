import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { type ContentSource, serializeContent } from "@goodfellow-cms/core";
import { describe, expect, it } from "vitest";
import { buttonFrom } from "./buttons.ts";

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
});
