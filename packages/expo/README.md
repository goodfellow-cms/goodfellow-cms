# @goodfellow-cms/expo

Shows a Goodfellow site natively in an [Expo](https://expo.dev) app for iPhone and Android, from the site's content API, with no server. The app keeps a copy of the site, so it opens offline, and brings it up to date whenever it starts or comes back to the front, downloading only what changed.

```tsx
import { nativeBlocks } from "@goodfellow-cms/blocks/native";
import { GoodfellowApp } from "@goodfellow-cms/expo";
import { fileStorage } from "@goodfellow-cms/expo/file-system";

const storage = fileStorage();

export default function App() {
  return <GoodfellowApp site="https://parish.example/" storage={storage} blocks={nativeBlocks} />;
}
```

It also has what blocks for apps are made of: `useNativeSite()`, `SiteText`, `NativeLink`, `NativeImage`, `RichText`, `Blocks`, `Columns` and more.

[Goodfellow](https://github.com/goodfellow-cms/goodfellow-cms) is a website builder for people who aren't developers, with no server or database: pages are files in your own GitHub, GitLab or Bitbucket repository, edited in a visual editor built on [Puck](https://puckeditor.com). To start a new site, run `npm create goodfellow@latest my-site`. See the [documentation](https://goodfellow-cms.github.io/goodfellow-cms/) for everything else.

More in the docs: [Apps with Expo](https://goodfellow-cms.github.io/goodfellow-cms/docs/apps).

## License

MIT
