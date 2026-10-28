import { NativeImage, RichText, SiteButton, SiteText, TEXT, useNativeSite } from "@goodfellow-cms/expo";
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

export function Heading({ text, level, align }: HeadingProps) {
  const shown = LEVELS[level] ?? LEVELS.h2;
  return (
    <SiteText
      heading={shown.level}
      style={{
        fontSize: shown.size,
        lineHeight: Math.round(shown.size * 1.2),
        fontWeight: shown.weight,
        textAlign: align,
      }}
    >
      {text}
    </SiteText>
  );
}

/** Formatted text, from the content API's structure of it: the HTML itself is never shown. */
export function Text({ id }: TextProps & { id?: string }) {
  const site = useNativeSite();
  return <RichText nodes={id ? site.richText(id, "content") : undefined} />;
}

export function Button({ label, href, variant, size }: ButtonProps) {
  return <SiteButton label={label} href={href} variant={variant} size={size} />;
}

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
