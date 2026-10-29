---
version: 1
title: Write blocks
description: Turn React components into blocks for the editor, following the rules that keep them working everywhere.
section: developers
order: 2
---

A block is a [Puck component](https://puckeditor.com/docs/integrating-puck/component-configuration): a React component plus the fields the editor shows for it. Add it to `blocks` in `goodfellow.config.tsx`. To start from a shadcn component, `goodfellow blocks add` writes the block for you, with fields from its props (see [Any shadcn component as a block](/docs/shadcn-components)).

```tsx
// blocks/mass-times.tsx
import { classNameField, cx } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

export interface MassTimesProps {
  times: Array<{ day: string; time: string }>;
  className: string;
}

export const MassTimes: ComponentConfig<MassTimesProps> = {
  label: "Mass times",
  fields: {
    times: {
      type: "array",
      label: "Times",
      arrayFields: { day: { type: "text", label: "Day" }, time: { type: "text", label: "Time" } },
    },
    className: classNameField,
  },
  defaultProps: { times: [{ day: "Sunday", time: "10:00 am" }], className: "" },
  render: ({ times, className }) => (
    <dl className={cx("grid grid-cols-2 gap-2", className)}>
      {times.map((item) => (
        <div key={item.day} className="contents">
          <dt className="font-semibold">{item.day}</dt>
          <dd>{item.time}</dd>
        </div>
      ))}
    </dl>
  ),
};
```

## Rules

- **Never rename** a block's key in `blocks`, or any of its props. Content files refer to blocks and props by name.
- **CSS classes:** give every block `className: classNameField` and apply it to the outermost element. It's the block's **Style** setting in the editor, kept as Tailwind classes (`readBlockStyle()` and `withBlockStyle()` in `@goodfellow-cms/core` read and write them). Combine classes with `cx()`, with `className` last, so an editor's classes override the block's own. A block with an `align` setting of its own keeps it, and its Style offers no text alignment.
- **Words to find it by:** editors can search the block list. To have your block found by words besides its label, name and group, add them with `withKeywords(block, ["times", "schedule"])` from `@goodfellow-cms/react`, lowercase.
- **Its icon:** the block list shows each block's icon, here and in editor plugins such as Gutenberg's. Give your block one with `withIcon(block, icon)`, where `icon` is the icon's shapes on a 24-unit grid, as [Lucide](https://lucide.dev)'s icon data is: `withIcon(MassTimes, [["circle", { cx: "12", cy: "12", r: "10" }], ["path", { d: "M12 6v6l4 2" }]])`, copied from an icon's SVG on lucide.dev. Only plain shapes (paths, circles, lines, rectangles and the like) and the numbers that place them are kept, so an icon can't load or run anything. Blocks without one show a box.
- **Named parts:** to let the site's theme restyle a block, give its parts names with `useParts()`: `const part = useParts()` at the start of `render`, then `className={part("gf-times-day", "font-semibold")}`, with what's chosen for the block, such as its alignment, and `className` after the block's own classes. Say what owners call each part with `withParts(block, { "gf-times-day": "Day" })`, so **Colors & fonts → Blocks' parts** offers them. Start names with `gf-` and your block's name, so they don't clash with built-in blocks' parts, and never rename or remove one, since themes refer to them.
- **Complete class names:** write Tailwind classes as whole strings, using lookup tables for options (`{ sm: "gap-3", md: "gap-6" }`), or Tailwind won't find them.
- **Theme classes:** style with the theme's classes, such as `bg-primary`, `text-muted-foreground`, `font-heading` and `rounded-lg`, rather than fixed colors, so blocks follow the site's settings, in dark mode too. Tailwind's `dark:` classes apply only on sites with [dark mode](/docs/layout-and-settings#dark-mode) turned on, when they're shown dark, so a light-only site never uses them, even on a computer set to dark.
- **Site data:** read menus, settings and collections with `useSite()`, never by copying them into props.
- **Links and images:** render them with `SiteLink` and `SiteImage` from `@goodfellow-cms/react`, not `<a>` and `<img>`, so they follow the site's base path and use `next/link` and `next/image` in Next.js. `SiteImage` lists a media library photo's smaller copies in `srcset` where the build makes them; pass `sizes` where the image is shown narrower than the page. Other root-relative addresses, such as a CSS background, go through `withBase(url, useSite().base)`.
- **Media fields:** a prop holding an uploaded file's address uses `mediaField()`, which adds the media library's chooser.
- **No hooks in `render`**, other than `useSite()` and `useParts()`, which reads it: in Next.js, blocks render as Server Components. Interactive parts go in [Client Components](/docs/interactive-blocks).
- **Labels for everyone:** fields' labels and options are for people who aren't developers: "Space above and below", not "padding-y".

## In the editor

The admin panel's own page, which signs editors in and publishes, never runs a block's code. Blocks run in the editor, which the admin panel shows in a frame sandboxed away from it, so no block can reach editors' sign-in or AI keys. The editor's previews, and the pages rendered to check a publish, run in frames like it. There, a block:

- **Can't fetch anything**, or store anything in the browser: the frame's Content Security Policy refuses requests, and a sandboxed page has no storage. Work that needs the network belongs in `resolveData` when the site is built, as the Calendar block's feeds do, or in a Client Component, which runs on the live site's pages as usual.
- **Shares the page with Puck's controls.** The site's CSS is kept to the canvas, and its media queries on the page's width become container queries on the canvas's, so the editor's **Phone** and **Tablet** buttons show the layout at those widths. Viewport units, such as `100vh`, still measure the editor's frame.
- **Runs only the site's own scripts:** a block can't load a script from another address in the editor. On the live site, nothing changes.
- **Has its labels translated** where the editor uses the admin panel in another language, such as Spanish: a block's name, group, settings' labels, choices and placeholders are looked up by their English wording in the language's table of labels, which has the built-in blocks' and the page settings'. A block of your own whose labels are worded the same way, such as "Heading" or "Space above and below", is translated too; anything else stays as you wrote it. Only what the editor shows changes: props, choices' values and what blocks render don't.

## Blocks for collections

In a collection's page design, Puck's `metadata` holds the item being shown (`metadata.entry`) and its collection (`metadata.collection`), for `resolveFields` and `resolveData`; `useSite().entry` has the item while rendering. Wrap blocks that only make sense there in `templateOnly()`, which leaves them out of the other editors.

A block can give the page it's on pages of its own, as Calendar does for its months and Collection list for its later pages: wrap it in `withPages(block, (props, { content, page, today }) => [...])` from `@goodfellow-cms/core`, returning each page's `suffix` (its address after the page's own, such as `page/2`), a `title` added to the page's, and what it shows (`month`, `page` or `choice`). Builds write them, and the block reads which one it's showing from `useSite().view`, when `view.block` is its own id. Only the first block on a page that adds pages gets them.

A block can also repeat the blocks inside it once for each of a collection's items, as Collection loop does: `repeatsForEntries(block, { design, items, entries })` from `@goodfellow-cms/react` names the slot that holds the design, the slot the copies go into, and a function that picks the items. The copies are made where pages are rendered, with each item's values in its placeholders, and never saved.

Custom fields don't say what they hold, so give them `metadata: { ai: … }` (an `AiFieldHint` from `@goodfellow-cms/ai`) for the AI assistant to fill them in.

A setting only the site's owners should choose, such as Custom HTML's "use it exactly as written", which lets HTML run on the site, takes `metadata: { owners: true }`. On a [full-stack Next.js site](/docs/full-stack-nextjs#who-may-do-what), editors who aren't owners see what it's set to but can't change it, and the server refuses a publish that changes it, or gives a new block anything but its starting value. Elsewhere it changes nothing, since editors' own accounts can change any file.
