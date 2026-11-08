import { classNameField, cx } from "@goodfellow-cms/react";
import type { ComponentConfig, Slot } from "@puckeditor/core";

export interface DocsLayoutProps {
  sidebar: Slot;
  content: Slot;
  aside: Slot;
  className: string;
}

/**
 * A documentation page's columns: navigation on the left, the page in the
 * middle and "On this page" on the right, which leave room for the page on
 * smaller screens (the navigation moves below it, and "On this page" is hidden).
 */
export const DocsLayout: ComponentConfig<DocsLayoutProps> = {
  label: "Documentation layout",
  fields: {
    sidebar: { type: "slot" },
    content: { type: "slot" },
    aside: { type: "slot" },
    className: classNameField,
  },
  defaultProps: { sidebar: [], content: [], aside: [], className: "" },
  render: ({ sidebar: Sidebar, content: Content, aside: Aside, className }) => (
    <div
      className={cx(
        "mx-auto grid w-full max-w-7xl gap-10 px-4 py-10 lg:grid-cols-[13rem_minmax(0,1fr)_11rem] lg:gap-8 xl:grid-cols-[14rem_minmax(0,1fr)_12rem] xl:gap-10",
        className,
      )}
    >
      {/* Above the page on small screens too, kept short there so the page starts close below. */}
      <Sidebar className="max-lg:max-h-72 max-lg:overflow-y-auto max-lg:border-b max-lg:border-border max-lg:pb-4 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto" />
      <Content className="min-w-0" />
      <Aside className="hidden lg:sticky lg:top-6 lg:block lg:self-start" />
    </div>
  ),
};
