import { imageSrcSet, isExternalLink, NEW_TAB, withBase } from "@goodfellow-cms/core";
import type { SiteContextValue, SiteImageProps, SiteLinkProps } from "./site-types.js";

/** Whether a link goes to one of the site's own pages, rather than a file, another site, or a new tab. */
function isPageLink({ href, target, download }: SiteLinkProps): boolean {
  return (
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !href.startsWith("/media/") &&
    (target === undefined || target === "_self") &&
    download === undefined
  );
}

/** Builds `SiteLink` and `SiteImage` on a `useSite()`: the browser's, or the Server Components' version. */
export function createSiteLinks(useSite: () => SiteContextValue) {
  /**
   * A link. Use it in blocks instead of `<a>`, so links follow the site's base
   * path, and links to the site's own pages use the renderer's link component,
   * such as Next.js's `next/link`. Links to other sites open in a new tab if
   * the site's settings say so, unless the link says where it opens itself.
   */
  function SiteLink(given: SiteLinkProps) {
    const { base, components, settings } = useSite();
    const newTab =
      settings?.externalLinksInNewTab && given.target === undefined && isExternalLink(given.href, settings.url);
    const props = newTab ? { ...given, ...NEW_TAB } : given;
    const Link = components?.Link;
    if (Link && isPageLink(props)) return <Link {...props} />;
    return <a {...props} href={withBase(props.href, base)} />;
  }

  /**
   * An image. Use it in blocks instead of `<img>`, so images follow the site's
   * base path, and the site's own images use the renderer's image component,
   * such as Next.js's `next/image`, with their size filled in. Where the build
   * makes smaller copies of the media library's photos (`imageWidths`), it
   * lists them in `srcset` instead, in both renderers alike: give it `sizes`
   * where the image is narrower than the page.
   */
  function SiteImage(props: SiteImageProps) {
    const { base, components, media, imageWidths } = useSite();
    const size = media?.[props.src];
    const src = withBase(props.src, base);
    const srcSet = imageWidths && imageSrcSet(props.src, size, imageWidths);
    if (srcSet && size) {
      const candidates = srcSet
        .split(", ")
        .map((candidate) => withBase(candidate, base))
        .join(", ");
      return (
        // biome-ignore lint/a11y/useAltText: the alt text is in props, which TypeScript requires
        <img width={size.width} height={size.height} {...props} src={src} srcSet={candidates} />
      );
    }
    const Image = components?.Image;
    if (Image && size) {
      const { width: _width, height: _height, ...rest } = props;
      return <Image {...rest} src={src} width={size.width} height={size.height} />;
    }
    // biome-ignore lint/a11y/useAltText: the alt text is in props, which TypeScript requires
    return <img {...props} src={src} />;
  }

  return { SiteLink, SiteImage };
}
