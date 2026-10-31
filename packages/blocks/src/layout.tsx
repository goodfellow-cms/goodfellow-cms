import { withBase } from "@goodfellow-cms/core";
import { classNameField, mediaField, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, Slot, SlotComponent } from "@puckeditor/core";
import { type Gap, gapClasses, gapLabels, options, yesNo } from "./options.js";
import { COLUMNS_PARTS, ROW_PARTS, SECTION_PARTS, SPACE_PARTS } from "./parts.js";

type Width = "narrow" | "normal" | "wide" | "full";
type Padding = "none" | "sm" | "md" | "lg";
type Background = "none" | "muted" | "primary" | "secondary";
type Overlay = "none" | "dark" | "light" | "primary";
type OverlayStrength = "light" | "medium" | "strong";
type MinHeight = "none" | "small" | "medium" | "large" | "screen";
type Focus = "center" | "top" | "bottom" | "left" | "right";

export interface SectionProps {
  content: Slot;
  width: Width;
  padding: Padding;
  background: Background;
  backgroundImage: string;
  /**
   * A color over the background, so text on a photo can be read, as
   * WordPress's Cover block has, how strongly, and the part of the photo
   * kept in view. Stored sections may predate them.
   */
  overlay?: Overlay;
  overlayStrength?: OverlayStrength;
  focus?: Focus;
  /** How tall the section is at least, with its content in the middle. */
  minHeight?: MinHeight;
  className: string;
}

const widthClasses: Record<Width, string> = {
  narrow: "max-w-2xl",
  normal: "max-w-5xl",
  wide: "max-w-7xl",
  full: "max-w-none",
};

// "none" adds no class, so padding can come from the block's CSS classes instead.
const paddingClasses: Record<Padding, string> = { none: "", sm: "py-6", md: "py-12", lg: "py-20" };

const backgroundClasses: Record<Background, string> = {
  none: "",
  muted: "bg-muted",
  primary: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
};

/** Overlays' colors at each strength, with the text color that reads on them. */
const overlayClasses: Record<Exclude<Overlay, "none">, Record<OverlayStrength, string>> = {
  dark: { light: "bg-black/30", medium: "bg-black/50", strong: "bg-black/70" },
  light: { light: "bg-white/40", medium: "bg-white/60", strong: "bg-white/80" },
  primary: { light: "bg-primary/40", medium: "bg-primary/60", strong: "bg-primary/80" },
};

const overlayTextClasses: Record<Exclude<Overlay, "none">, string> = {
  dark: "text-white",
  light: "text-black",
  primary: "text-primary-foreground",
};

const minHeightClasses: Record<MinHeight, string> = {
  none: "",
  small: "flex min-h-64 flex-col justify-center",
  medium: "flex min-h-96 flex-col justify-center",
  large: "flex min-h-[36rem] flex-col justify-center",
  screen: "flex min-h-screen flex-col justify-center",
};

const focusClasses: Record<Focus, string> = {
  center: "bg-center",
  top: "bg-top",
  bottom: "bg-bottom",
  left: "bg-left",
  right: "bg-right",
};

/** A Section's band, with its background image at the site's own address. */
function SectionView({
  content: Content,
  width,
  padding,
  background,
  backgroundImage,
  overlay = "none",
  overlayStrength = "medium",
  focus = "center",
  minHeight = "none",
  className,
}: Omit<SectionProps, "content"> & { content: SlotComponent }) {
  const { base, focus: focalPoints } = useSite();
  const part = useParts();
  const image = backgroundImage && withBase(backgroundImage, base);
  // The media library's focal point, where the Section's own "Keep in view" is left in the middle.
  const position = image && focus === "center" ? focalPoints?.[backgroundImage] : undefined;
  const tinted = overlay !== "none";
  return (
    <section
      className={part(
        "gf-section",
        [image && "bg-cover", image && focusClasses[focus], tinted && "relative isolate", minHeightClasses[minHeight]],
        paddingClasses[padding],
        backgroundClasses[background],
        tinted && overlayTextClasses[overlay],
        className,
      )}
      style={
        image
          ? { backgroundImage: `url(${JSON.stringify(image)})`, ...(position && { backgroundPosition: position }) }
          : undefined
      }
    >
      {tinted && (
        <span
          aria-hidden="true"
          className={part("gf-section-overlay", ["absolute inset-0 -z-10", overlayClasses[overlay][overlayStrength]])}
        />
      )}
      <Content className={part("gf-section-content", "mx-auto px-4", widthClasses[width])} />
    </section>
  );
}

/** A full-width band of the page that centers its content. */
export const Section: ComponentConfig<SectionProps> = withParts(
  {
    label: "Section",
    fields: {
      content: { type: "slot" },
      width: {
        type: "select",
        label: "Content width",
        options: options({ narrow: "Narrow", normal: "Normal", wide: "Wide", full: "Full width" }),
      },
      padding: {
        type: "select",
        label: "Space above and below",
        options: options({ none: "None", sm: "Small", md: "Medium", lg: "Large" }),
      },
      background: {
        type: "select",
        label: "Background color",
        options: options({ none: "None", muted: "Subtle", primary: "Primary", secondary: "Secondary" }),
      },
      backgroundImage: mediaField("Background image"),
      focus: {
        type: "select",
        label: "Part of the picture to keep in view",
        options: options({ center: "Middle", top: "Top", bottom: "Bottom", left: "Left", right: "Right" }),
      },
      overlay: {
        type: "select",
        label: "Color over the background",
        options: options({ none: "None", dark: "Dark", light: "Light", primary: "Primary" }),
      },
      overlayStrength: {
        type: "radio",
        label: "How strong a color",
        options: options({ light: "Light", medium: "Medium", strong: "Strong" }),
      },
      minHeight: {
        type: "select",
        label: "Height at least",
        options: options({
          none: "As tall as its content",
          small: "Small",
          medium: "Medium",
          large: "Large",
          screen: "The whole screen",
        }),
      },
      className: classNameField,
    },
    defaultProps: {
      content: [],
      width: "normal",
      padding: "md",
      background: "none",
      backgroundImage: "",
      focus: "center",
      overlay: "none",
      overlayStrength: "medium",
      minHeight: "none",
      className: "",
    },
    render: (props) => <SectionView {...props} />,
  },
  SECTION_PARTS,
);

type Columns = "1" | "2" | "3" | "4";

export interface GridProps {
  items: Slot;
  columns: Columns;
  gap: Gap;
  className: string;
}

const columnClasses: Record<Columns, string> = {
  "1": "grid-cols-1",
  "2": "grid-cols-1 md:grid-cols-2",
  "3": "grid-cols-1 md:grid-cols-3",
  "4": "grid-cols-1 sm:grid-cols-2 lg:grid-cols-4",
};

/** Columns of equal width. On phones, they stack. */
export const Grid: ComponentConfig<GridProps> = withParts(
  {
    label: "Columns",
    fields: {
      items: { type: "slot" },
      columns: { type: "select", label: "Columns", options: options({ "1": "1", "2": "2", "3": "3", "4": "4" }) },
      gap: { type: "select", label: "Space between", options: options(gapLabels) },
      className: classNameField,
    },
    defaultProps: { items: [], columns: "2", gap: "md", className: "" },
    render: ({ items: Items, columns, gap, className }) => {
      const part = useParts();
      return <Items className={part("gf-columns", "grid", columnClasses[columns], gapClasses[gap], className)} />;
    },
  },
  COLUMNS_PARTS,
);

type Direction = "row" | "column";
type Justify = "start" | "center" | "end" | "between";
type Align = "start" | "center" | "end" | "stretch";

export interface FlexProps {
  items: Slot;
  direction: Direction;
  justify: Justify;
  align: Align;
  gap: Gap;
  wrap: boolean;
  className: string;
}

const justifyClasses: Record<Justify, string> = {
  start: "justify-start",
  center: "justify-center",
  end: "justify-end",
  between: "justify-between",
};

const alignClasses: Record<Align, string> = {
  start: "items-start",
  center: "items-center",
  end: "items-end",
  stretch: "items-stretch",
};

/** A row or column of blocks, such as a group of buttons. */
export const Flex: ComponentConfig<FlexProps> = withParts(
  {
    label: "Row",
    fields: {
      items: { type: "slot" },
      direction: { type: "radio", label: "Direction", options: options({ row: "Across", column: "Down" }) },
      justify: {
        type: "select",
        label: "Arrange",
        options: options({ start: "Start", center: "Center", end: "End", between: "Spread out" }),
      },
      align: {
        type: "select",
        label: "Align",
        options: options({ start: "Start", center: "Center", end: "End", stretch: "Stretch" }),
      },
      gap: { type: "select", label: "Space between", options: options(gapLabels) },
      wrap: { type: "radio", label: "Wrap onto new lines", options: yesNo },
      className: classNameField,
    },
    defaultProps: {
      items: [],
      direction: "row",
      justify: "start",
      align: "center",
      gap: "md",
      wrap: true,
      className: "",
    },
    render: ({ items: Items, direction, justify, align, gap, wrap, className }) => {
      const part = useParts();
      return (
        <Items
          className={part(
            "gf-row",
            "flex",
            direction === "column" ? "flex-col" : "flex-row",
            wrap ? "flex-wrap" : "flex-nowrap",
            justifyClasses[justify],
            alignClasses[align],
            gapClasses[gap],
            className,
          )}
        />
      );
    },
  },
  ROW_PARTS,
);

type SpaceSize = "sm" | "md" | "lg" | "xl";

export interface SpaceProps {
  size: SpaceSize;
  className: string;
}

const spaceClasses: Record<SpaceSize, string> = { sm: "h-4", md: "h-8", lg: "h-16", xl: "h-24" };

/** Empty vertical space. */
export const Space: ComponentConfig<SpaceProps> = withParts(
  {
    label: "Space",
    fields: {
      size: {
        type: "select",
        label: "Size",
        options: options({ sm: "Small", md: "Medium", lg: "Large", xl: "Extra large" }),
      },
      className: classNameField,
    },
    defaultProps: { size: "md", className: "" },
    render: ({ size, className }) => {
      const part = useParts();
      return <div aria-hidden="true" className={part("gf-space", undefined, spaceClasses[size], className)} />;
    },
  },
  SPACE_PARTS,
);
