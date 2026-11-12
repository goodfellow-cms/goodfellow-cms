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
  it("keeps items to members only, with or without pages", () => {
    expect(fromDraft(members, toDraft(members)).visibility).toBe("members");
    expect(fromDraft(members, { ...toDraft(members), membersOnly: false }).visibility).toBeUndefined();
    // Items without pages are still kept out of the content API, so turning pages off keeps the setting.
    expect(fromDraft(members, { ...toDraft(members), withPages: false }).visibility).toBe("members");
  });

  it("shows a template's members-only setting, and unchecking it makes the items everyone's", () => {
    const template = { root: { props: { title: "{title}", visibility: "members" } }, content: [] };
    const byTemplate = { ...members, visibility: undefined, template } as unknown as Parameters<typeof toDraft>[0];
    expect(toDraft(byTemplate).membersOnly).toBe(true);
    const unchecked = fromDraft(byTemplate, { ...toDraft(byTemplate), membersOnly: false });
    expect(unchecked.visibility).toBeUndefined();
    expect(unchecked.template).toEqual({ root: { props: { title: "{title}" } }, content: [] });
    // Left checked, the template keeps saying so.
    expect(fromDraft(byTemplate, toDraft(byTemplate)).template).toEqual(template);
  });
});
