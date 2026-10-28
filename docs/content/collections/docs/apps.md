---
version: 1
title: Apps with Expo
description: An Expo app for iPhone and Android that shows the site natively from its content API, keeps a copy for offline, and stays up to date by itself.
section: developers
order: 4.6
---

`@goodfellow-cms/expo` makes an [Expo](https://expo.dev) app for iPhone and Android from a Goodfellow site. It reads the site's [content API](/docs/content-api), so there's no server to run, and every publish reaches the app the next time it's opened. Pages are drawn natively, with React Native, by each block's version for apps.

- **Up to date and offline.** The app reads the site's manifest when it starts and whenever it comes back to the front, downloads only the files whose hash changed, and keeps them, with the pictures they show. Opened offline, it shows the copy it kept.
- **Native blocks.** Every [built-in block](/docs/built-in-blocks) has a version for apps, `nativeBlocks` from `@goodfellow-cms/blocks/native`, by the same name, with the same settings.
- **Links.** The site's own pages open in the app, and old addresses go where the site's [redirects](/docs/layout-and-settings#redirects) send them, as on the website; anything else opens in the phone's browser, and email addresses and phone numbers in its apps.
- **Its theme.** Blocks use the site's colors, corners and fonts, in dark colors where the site has [dark mode](/docs/layout-and-settings) and the phone is set to dark.

## Making the app

Make an Expo app (SDK 58 or later), then install the packages, with the Expo packages the app uses:

```sh
npx create-expo-app@latest parish-app
cd parish-app
npm install @goodfellow-cms/expo @goodfellow-cms/blocks
npx expo install expo-file-system react-native-webview
```

Then show the site, by its Site address:

```tsx
import { GoodfellowApp } from "@goodfellow-cms/expo";
import { fileStorage } from "@goodfellow-cms/expo/file-system";
import { nativeBlocks } from "@goodfellow-cms/blocks/native";
import { ActivityIndicator, Text } from "react-native";

const storage = fileStorage();

export default function App() {
  return (
    <GoodfellowApp
      site="https://parish.example/"
      storage={storage}
      blocks={nativeBlocks}
      loading={<ActivityIndicator />}
      unavailable={<Text>Connect to the internet to open the parish's app the first time.</Text>}
    />
  );
}
```

`<GoodfellowApp>` shows one page at a time, with the site's header and footer, and goes back with Android's back button. Apps with [Expo Router](https://docs.expo.dev/router/introduction/) use `<GoodfellowSite>` around the app and `<GoodfellowPage path={…}>` in their own screens instead, with `onNavigate` to open a screen for each of the site's links.

### What `<GoodfellowSite>` takes

| Setting | What it does |
|---|---|
| `site` | The Site address, as Site settings has it, such as `https://name.github.io/parish/`. |
| `storage` | Where the app keeps its copy: `fileStorage()` keeps it in the app's documents; `memoryStorage()` keeps nothing between launches. |
| `blocks` | The blocks the app draws: `nativeBlocks`, with the site's own after them. |
| `keep` | Which pages to download ahead. Every page unless given; a large site can keep only some, such as `(page) => !page.entry`, and the rest download when they're opened. |
| `fallback` | What shows in place of a block the app has no version of. A note that opens the page on the website unless given. |
| `fonts` | Font families the app loaded for the theme's fonts, such as with `expo-font`: `{ heading, body, mono }`. The phone's own fonts otherwise. |
| `language` | The language to show at first, on a site in [several languages](/docs/languages). The site's main one unless given; the Language switch block changes it. |

`useSiteStatus()` says whether the copy is `ready`, or why it isn't up to date: `offline`, `no-api` (the site has no content API, as before it's rebuilt with this release, or where its config turns it off) or `newer-content`. That last one means the site's content files are a newer version than the app reads, after an update to Goodfellow: the app keeps showing the copy it has until it's updated to a release that reads them.

Pictures are kept with the pages that show them. Videos, sound and other files are played and opened from the site, since keeping them would fill the phone.

## How blocks differ in apps

Most blocks look and work as they do on the website. A few can't:

- **Search** finds pages and items by their titles and fields, which the app keeps; the website's search reads every page's text, which the app doesn't keep for every page.
- **Form** sends the answers to the form service itself, as the website's form does, and then opens the thank-you page, or says what the form's "In the site's app" message says. A form with Web3Forms' hCaptcha opens on the website instead, since the captcha only works there.
- **Video** plays uploads with the phone's own player, and YouTube's, Vimeo's and other sites' players in a frame of their own.
- **Code** shows the colors the site's build gave it, and can be selected to copy.
- **Menu** across the top is a button that opens the menu on a phone, and a row on a tablet.
- Theme parts' classes (`theme.parts`) and blocks' CSS classes don't apply in apps, since there's no CSS.

## Blocks of the site's own

A block the site has made, or installed from a [block registry](/docs/block-registries), needs a version for apps too: a React Native component given the props the content API has for it, after the block's preparation, so with its defaults filled in. Give the app both, by name:

```tsx
import { nativeBlocks } from "@goodfellow-cms/blocks/native";
import { RichText, SiteText, useNativeSite } from "@goodfellow-cms/expo";

function Notice({ id, title }: { id: string; title: string }) {
  const site = useNativeSite();
  return (
    <>
      <SiteText heading={2}>{title}</SiteText>
      {/* Rich text, from the content API's structure of it, never its HTML. */}
      <RichText nodes={site.richText(id, "text")} />
    </>
  );
}

const blocks = { ...nativeBlocks, Notice };
```

`@goodfellow-cms/expo` has what blocks are made of: `SiteText`, `NativeLink`, `NativeImage` (from the app's copy), `RichText`, `Blocks` (a slot's blocks), `Columns`, `Disclosure`, `SiteButton`, `MediaPlayer` and `WebFrame`, and `useNativeSite()` for the site's settings, menus, collections, the page's item and the theme. The built-in blocks' own logic, such as which items a list shows, is shared with the website's and imports none of its code: see `packages/blocks/src/*-data.ts`.

### Blocks without a version for apps

Where a block has no version for apps, the app shows `fallback`. A block's web code can be shown there with [Expo's DOM components](https://docs.expo.dev/guides/dom-components/): a file starting with `"use dom"` renders it in a web view inside the app, such as a registry block's component from the site's folder:

```tsx
// web-accordion.tsx
"use dom";

import "./tailwind.css";
import AccordionDemo from "../parish/blocks/installed/accordion/accordion-parts";

export default function WebAccordion(_: { dom?: import("expo/dom").DOMProps }) {
  return <AccordionDemo />;
}
```

```tsx
<GoodfellowApp
  site="https://parish.example/"
  storage={storage}
  blocks={nativeBlocks}
  fallback={({ type }) => (type === "accordion" ? <WebAccordion dom={{ matchContents: true }} /> : null)}
/>
```

That's slower than a native block and doesn't follow the app's links by itself, so it's best for a few blocks while their native versions are written.

### Cross-platform blocks from shadcn components

[shadcn-tamagui-codemod](https://www.npmjs.com/package/shadcn-tamagui-codemod) rewrites components styled with Tailwind, shadcn/ui's among them, into [Tamagui](https://tamagui.dev) components that run on the web and on phones from the same code. Anything it can't convert is left marked with `// TODO(native)` and listed in its report. It's a way to give blocks made from [shadcn components](/docs/shadcn-components) a version for apps.

`goodfellow blocks add` does it with `--native`, given the app's folder:

```sh
npx goodfellow blocks add @acme/hero --native ../parish-app
```

As well as making the site's block, it copies the item's code into the app's `goodfellow-blocks/hero/`, and the site's components it uses that the app doesn't have yet into the app at the same paths, converts them with the codemod, writes `goodfellow-blocks/hero/block.tsx`, which gives the converted component the site's block's props, and lists every block it has made in `goodfellow-blocks/index.ts`. Nothing in the site's own code is converted. Then, in the app:

- Set up Tamagui, as the codemod's README says: `withTamagui` from `@tamagui/cli/metro` in `metro.config.js`, `TamaguiProvider` from `tamagui` around the app, the `@/` import alias the site uses, and `npm dedupe` after installing.
- Give `<GoodfellowSite>` the blocks: `blocks={{ ...nativeBlocks, ...installedNativeBlocks }}`, from `./goodfellow-blocks`.
- Look for `// TODO(native)` in what it converted, and generate the icons it says, with `npx @tamagui/cli icons add …`.

The command says what's left to do when it's finished. It doesn't make an app's version again where the app already has one, so it's yours to change.
