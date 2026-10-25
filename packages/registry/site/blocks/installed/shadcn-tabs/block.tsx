import { classNameField, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, RichText } from "@puckeditor/core";
import { TabsView } from "./tabs-view";

interface Tab {
  label: string;
  content: RichText;
}

export interface TabsProps {
  tabs: Tab[];
  className: string;
}

/** Content split into tabs, one shown at a time. Every tab's content is in the page, so search engines see it. */
const Tabs: ComponentConfig<TabsProps> = withParts(
  {
    label: "Tabs",
    fields: {
      tabs: {
        type: "array",
        label: "Tabs",
        arrayFields: {
          label: { type: "text", label: "Tab name" },
          content: { type: "richtext", label: "Content" },
        },
        defaultItemProps: { label: "Tab", content: "<p>What this tab shows.</p>" },
        getItemSummary: (tab) => tab.label || "Tab",
      },
      className: classNameField,
    },
    defaultProps: {
      tabs: [
        { label: "First", content: "<p>What the first tab shows.</p>" },
        { label: "Second", content: "<p>What the second tab shows.</p>" },
      ],
      className: "",
    },
    render: ({ tabs, className }) => {
      const part = useParts();
      return (
        <section className={part("gf-shadcn-tabs", "mx-auto w-full max-w-4xl px-4 py-8", className)}>
          <TabsView
            tabs={tabs.map(({ label, content }) => ({ label, content }))}
            classes={{
              list: part("gf-shadcn-tabs-list", "flex-wrap"),
              tab: part("gf-shadcn-tabs-tab"),
              content: part("gf-shadcn-tabs-content", "pt-4", "data-[state=inactive]:hidden"),
            }}
          />
        </section>
      );
    },
  },
  {
    "gf-shadcn-tabs": "Tabs",
    "gf-shadcn-tabs-list": "Tabs' names",
    "gf-shadcn-tabs-tab": "Tab's name",
    "gf-shadcn-tabs-content": "Tab's content",
  },
);

export default Tabs;
