import { describe, expect, it } from "vitest";
import { fromDraft, toDraft } from "./collection-settings.js";

const members = {
  version: 1,
  name: "Meetings",
  entryName: "Meeting",
  path: "/meetings/{slug}",
  visibility: "members",
  fields: [{ name: "title", label: "Title", type: "text" }],
} as unknown as Parameters<typeof toDraft>[0];

describe("a collection's settings form", () => {
  it("keeps items' pages to members only while the collection has pages", () => {
    expect(fromDraft(members, toDraft(members)).visibility).toBe("members");
    expect(fromDraft(members, { ...toDraft(members), membersOnly: false }).visibility).toBeUndefined();
    // Without pages the checkbox isn't shown, so the setting goes with them, rather than staying out of reach.
    expect(fromDraft(members, { ...toDraft(members), withPages: false }).visibility).toBeUndefined();
  });
});
