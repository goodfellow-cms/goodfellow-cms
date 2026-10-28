import { Blocks, Columns, OnColor, useBlocks, useNativeSite } from "@goodfellow-cms/expo";
import type { ReactNode } from "react";
import { ImageBackground, View, type ViewStyle } from "react-native";
import type { FlexProps, GridProps, SectionProps, SpaceProps } from "./layout.js";
import type { Gap } from "./options.js";

/** The web's spacing, in points. */
export const GAPS: Record<Gap, number> = { none: 0, sm: 12, md: 24, lg: 40 };
const PADDING = { none: 0, sm: 24, md: 48, lg: 80 } as const;
const WIDTHS = { narrow: 672, normal: 1024, wide: 1280, full: undefined } as const;
const MIN_HEIGHTS = { none: undefined, small: 256, medium: 384, large: 576, screen: 640 } as const;
const OVERLAYS = {
  dark: { light: 0.3, medium: 0.5, strong: 0.7 },
  light: { light: 0.4, medium: 0.6, strong: 0.8 },
  primary: { light: 0.4, medium: 0.6, strong: 0.8 },
} as const;
const FOCUS = { center: "center", top: "top", bottom: "bottom", left: "left", right: "right" } as const;

/** A full-width band of the page, its content centered and as wide as it chose at most. */
export function Section({
  content,
  width,
  padding,
  background,
  backgroundImage,
  overlay = "none",
  overlayStrength = "medium",
  focus = "center",
  minHeight = "none",
}: SectionProps) {
  const site = useNativeSite();
  const { colors } = site.theme;
  const fill = background === "none" ? undefined : colors[background];
  const text =
    overlay === "dark"
      ? "#ffffff"
      : overlay === "light"
        ? "#000000"
        : overlay === "primary" || background === "primary"
          ? colors.primaryForeground
          : background === "secondary"
            ? colors.secondaryForeground
            : undefined;
  const tall = MIN_HEIGHTS[minHeight];
  const band: ViewStyle = {
    backgroundColor: fill,
    paddingVertical: PADDING[padding] ?? PADDING.md,
    paddingHorizontal: 16,
    ...(tall && { minHeight: tall, justifyContent: "center" }),
  };
  let inner: ReactNode = (
    <Blocks items={content} style={{ width: "100%", maxWidth: WIDTHS[width], alignSelf: "center" }} />
  );
  if (text) inner = <OnColor foreground={text}>{inner}</OnColor>;
  const tint =
    overlay !== "none" ? (
      <View
        pointerEvents="none"
        style={{
          position: "absolute",
          top: 0,
          right: 0,
          bottom: 0,
          left: 0,
          backgroundColor: overlay === "dark" ? "#000000" : overlay === "light" ? "#ffffff" : colors.primary,
          opacity: OVERLAYS[overlay][overlayStrength],
        }}
      />
    ) : null;
  if (backgroundImage) {
    return (
      <ImageBackground
        source={{ uri: site.media(backgroundImage) }}
        resizeMode="cover"
        imageStyle={{ objectPosition: FOCUS[focus] } as object}
        accessible={false}
        style={band}
      >
        {tint}
        {inner}
      </ImageBackground>
    );
  }
  return (
    <View style={band}>
      {tint}
      {inner}
    </View>
  );
}

const GRID_COLUMNS = {
  "1": { base: 1 },
  "2": { base: 1, md: 2 },
  "3": { base: 1, md: 3 },
  "4": { base: 1, sm: 2, lg: 4 },
} as const;

/** Columns of equal width, which stack on phones. */
export function Grid({ items, columns, gap }: GridProps) {
  return (
    <Columns columns={GRID_COLUMNS[columns] ?? GRID_COLUMNS["2"]} gap={GAPS[gap] ?? GAPS.md}>
      {useBlocks(items)}
    </Columns>
  );
}

const JUSTIFY = { start: "flex-start", center: "center", end: "flex-end", between: "space-between" } as const;
const ALIGN = { start: "flex-start", center: "center", end: "flex-end", stretch: "stretch" } as const;

/** A row or column of blocks, such as a group of buttons. */
export function Flex({ items, direction, justify, align, gap, wrap }: FlexProps) {
  return (
    <View
      style={{
        flexDirection: direction === "column" ? "column" : "row",
        flexWrap: wrap ? "wrap" : "nowrap",
        justifyContent: JUSTIFY[justify] ?? "flex-start",
        alignItems: ALIGN[align] ?? "center",
        gap: GAPS[gap] ?? GAPS.md,
      }}
    >
      {useBlocks(items)}
    </View>
  );
}

const SPACE = { sm: 16, md: 32, lg: 64, xl: 96 } as const;

/** Empty space between blocks. */
export function Space({ size }: SpaceProps) {
  return <View accessible={false} style={{ height: SPACE[size] ?? SPACE.md }} />;
}
