import type { Config } from "@puckeditor/core";
import { describe, expect, it } from "vitest";
import { withOwnersOnlyLocked } from "./owners-only.js";

const config: Config = {
  root: {
    fields: {
      title: { type: "text", label: "Title" },
      visibility: {
        type: "radio",
        label: "Who can see this page",
        metadata: { owners: true },
        options: [
          { label: "Everyone", value: "everyone" },
          { label: "Only signed-in members", value: "members" },
        ],
      },
    },
  },
  components: {
    Html: {
      fields: { html: { type: "textarea" }, sanitize: { type: "radio", options: [], metadata: { owners: true } } },
      render: () => <div />,
    },
    Text: { fields: { text: { type: "text" } }, render: () => <p /> },
  },
};

describe("owners-only settings in the editor", () => {
  it("are shown but not changeable, the page's own included", () => {
    const locked = withOwnersOnlyLocked(config);
    expect(locked.root?.fields?.visibility?.type).toBe("custom");
    expect(locked.root?.fields?.visibility?.label).toBe("Who can see this page");
    expect(locked.root?.fields?.title).toBe(config.root?.fields?.title);
    expect(locked.components.Html?.fields?.sanitize?.type).toBe("custom");
    expect(locked.components.Html?.fields?.html).toBe(config.components.Html?.fields?.html);
    expect(locked.components.Text).toBe(config.components.Text);
  });
});
