import {
  NativeImage,
  RichText,
  SiteButton,
  SiteText,
  stylesItself,
  TEXT,
  useBlockStyle,
  useNativeSite,
} from "@goodfellow-cms/expo";
import { type ComponentRef, useEffect, useRef } from "react";
import { View } from "react-native";
import type { ButtonProps, HeadingProps, ImageProps, TextProps } from "./content.js";

/** A placeholder for a collection's field, such as `{photo}`, which builds fill in. */
const PLACEHOLDER = /^\{[a-z][a-z0-9]*(?:-[a-z0-9]+)*\}$/;

const LEVELS = {
  h1: { size: TEXT["4xl"], weight: "700", level: 1 },
  h2: { size: TEXT["3xl"], weight: "700", level: 2 },
  h3: { size: TEXT["2xl"], weight: "600", level: 3 },
  h4: { size: TEXT.xl, weight: "600", level: 4 },
} as const;

export function Heading({ id, text, level, align }: HeadingProps & { id?: string }) {
  const shown = LEVELS[level] ?? LEVELS.h2;
  // The heading is the block, so its Style's text size and color win over the level's, as on the web.
  const own = useBlockStyle().text;
  const site = useNativeSite();
  const ref = useRef<ComponentRef<typeof View>>(null);
  // Its link name on the page, which the page's table of contents scrolls to.
  const anchor = site.headings?.find((heading) => heading.block === id)?.anchor;
  useEffect(() => {
    if (!anchor) return;
    return site.anchor(
      anchor,
      () =>
        new Promise((resolve) =>
          ref.current ? ref.current.measureInWindow((_x, y) => resolve(y)) : resolve(undefined),
        ),
    );
  }, [anchor, site]);
  return (
    <View ref={ref}>
      <SiteText
        heading={shown.level}
        style={[
          {
            fontSize: shown.size,
            lineHeight: Math.round(shown.size * 1.2),
            fontWeight: shown.weight,
            ...(align && { textAlign: align }),
          },
          own,
        ]}
      >
        {text}
      </SiteText>
    </View>
  );
}

/** Formatted text, from the content API's structure of it: the HTML itself is never shown. */
export function Text({ id }: TextProps & { id?: string }) {
  const site = useNativeSite();
  return <RichText nodes={id ? site.richText(id, "content") : undefined} />;
}

/** A button, which takes its Style itself: its colors, space and corners are the button's, as on the web. */
export const Button = stylesItself(function Button({ label, href, variant, size }: ButtonProps) {
  const { view, text } = useBlockStyle();
  return <SiteButton label={label} href={href} variant={variant} size={size} style={view} textStyle={text} />;
});

export function Image({ src, alt, decorative, caption, aspect, rounded }: ImageProps) {
  if (!src || PLACEHOLDER.test(src)) return null;
  return (
    <View style={{ gap: 8 }}>
      <NativeImage src={src} alt={decorative ? "" : alt} aspect={aspect} rounded={rounded} />
      {caption ? (
        <SiteText muted style={{ fontSize: TEXT.sm }}>
          {caption}
        </SiteText>
      ) : null}
    </View>
  );
}
