import type { RichTextBlock, RichTextInline } from "@goodfellow-cms/core/content-api";
import {
  Children,
  type ComponentRef,
  createContext,
  Fragment,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Image,
  type ImageStyle,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  type TextStyle,
  useWindowDimensions,
  View,
  type ViewStyle,
} from "react-native";
import { type ClassStyle, classStyle, hasStyle } from "./classes.js";
import { type NativeBlock, NativeSiteProvider, useNativeSite, useSiteRoot } from "./site.js";
import { TEXT } from "./theme.js";

/** A link: the site's pages open in the app, anything else in the phone's browser. */
export function NativeLink({
  href,
  children,
  style,
  label,
}: {
  href: string;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** What screen readers say, where the link's text doesn't. */
  label?: string;
}) {
  const site = useNativeSite();
  return (
    <Pressable
      accessibilityRole="link"
      {...(label && { accessibilityLabel: label })}
      onPress={() => site.open(href)}
      style={style}
    >
      {children}
    </Pressable>
  );
}

interface BlockStyleValue {
  /** What text in the block shows, from its Style and those of the blocks it's in, as the web's text inherits. */
  text: TextStyle;
  /** The block's own Style, for a block that applies it itself. */
  own: ClassStyle;
}

const NO_STYLE: BlockStyleValue = { text: {}, own: { view: {}, text: {} } };
const BlockStyleContext = createContext<BlockStyleValue>(NO_STYLE);

/**
 * The block's Style settings (its `className`'s Tailwind classes) as React
 * Native styles: `view` for its box and `text` for its text. Blocks are drawn
 * in a box with `view` and their text takes `text`, by themselves; a block
 * marked with `stylesItself()` applies them where it wants them instead, such
 * as a button's colors on the button.
 */
export function useBlockStyle(): ClassStyle {
  return useContext(BlockStyleContext).own;
}

const STYLES_ITSELF = Symbol.for("goodfellow.stylesItself");

/**
 * Marks a native block that applies its own Style (`useBlockStyle()`), so it
 * isn't drawn in a box with it, as a button, whose colors are the button's.
 */
export function stylesItself<Block extends NativeBlock>(block: Block): Block {
  (block as unknown as Record<symbol, boolean>)[STYLES_ITSELF] = true;
  return block;
}

/** Text in the site's body font and colors, and those of the Style of the blocks it's in. */
export function SiteText({
  children,
  style,
  muted,
  heading,
  ...rest
}: {
  children: ReactNode;
  style?: StyleProp<TextStyle>;
  muted?: boolean;
  /** In the headings' font, as a heading of this level, for screen readers. */
  heading?: 1 | 2 | 3 | 4 | 5 | 6;
  numberOfLines?: number;
  selectable?: boolean;
}) {
  const { theme } = useNativeSite();
  const font = heading ? theme.fonts.heading : theme.fonts.body;
  const { text } = useContext(BlockStyleContext);
  // Muted text keeps its color, as on the web, where it names its own.
  const { color, ...shown } = text;
  return (
    <Text
      {...rest}
      {...(heading && { accessibilityRole: "header" as const, "aria-level": heading })}
      style={[
        { color: muted ? theme.colors.mutedForeground : theme.colors.foreground, fontSize: TEXT.base, lineHeight: 24 },
        font ? { fontFamily: font } : undefined,
        muted ? shown : text,
        style,
      ]}
    >
      {children}
    </Text>
  );
}

const ASPECTS = { auto: undefined, square: 1, landscape: 4 / 3, wide: 16 / 9, tall: 9 / 16 } as const;

/** One of the site's pictures, from the app's copy where it has one. Decorative ones are hidden from screen readers. */
export function NativeImage({
  src,
  alt,
  aspect = "wide",
  rounded = true,
  style,
}: {
  src: string;
  alt: string;
  /** Its shape; `auto` keeps the picture's own, once it's loaded. */
  aspect?: keyof typeof ASPECTS;
  rounded?: boolean;
  style?: StyleProp<ImageStyle>;
}) {
  const site = useNativeSite();
  const [own, setOwn] = useState<number | undefined>();
  const ratio = ASPECTS[aspect] ?? own ?? 16 / 9;
  return (
    <Image
      source={{ uri: site.media(src) }}
      {...(alt ? { accessibilityLabel: alt, accessible: true } : { accessible: false })}
      resizeMode="cover"
      onLoad={(event) => {
        const { width, height } = event.nativeEvent.source ?? {};
        if (aspect === "auto" && width && height) setOwn(width / height);
      }}
      style={[
        { width: "100%", aspectRatio: ratio, backgroundColor: site.theme.colors.muted },
        rounded && { borderRadius: site.theme.radius },
        style,
      ]}
    />
  );
}

/** Screen widths, in points, as the web blocks' Tailwind breakpoints are. */
export const BREAKPOINTS = { sm: 640, md: 768, lg: 1024 } as const;

/** Whether the screen is at least as wide as a breakpoint, such as a tablet's for `md`. */
export function useWide(breakpoint: keyof typeof BREAKPOINTS = "md"): boolean {
  return useWindowDimensions().width >= BREAKPOINTS[breakpoint];
}

/**
 * Its children in columns, as many as `columns` gives for the screen's
 * width (by breakpoint, smallest first), one under another on phones.
 */
export function Columns({
  children,
  columns,
  gap = 0,
  widths,
  align,
  style,
}: {
  children: ReactNode;
  /** Columns from each breakpoint up, such as `{ base: 1, md: 3 }`. */
  columns: Partial<Record<"base" | keyof typeof BREAKPOINTS, number>>;
  gap?: number;
  /** The columns' shares of the width, such as `[1, 2]`; equal unless given. */
  widths?: number[];
  align?: ViewStyle["alignItems"];
  style?: StyleProp<ViewStyle>;
}) {
  const { width } = useWindowDimensions();
  const count =
    (["lg", "md", "sm"] as const)
      .map((name) => (width >= BREAKPOINTS[name] ? columns[name] : undefined))
      .find(Boolean) ??
    columns.base ??
    1;
  const items = Children.toArray(children);
  if (count <= 1) return <View style={[{ gap }, style]}>{items}</View>;
  const rows: ReactNode[][] = [];
  items.forEach((item, index) => {
    if (index % count === 0) rows.push([]);
    rows.at(-1)?.push(item);
  });
  return (
    <View style={[{ gap }, style]}>
      {rows.map((row, rowIndex) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are only where the items fall
        <View key={rowIndex} style={{ flexDirection: "row", gap, alignItems: align ?? "stretch" }}>
          {Array.from({ length: count }, (_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: as above
            <View key={index} style={{ flex: widths?.[index] ?? 1, minWidth: 0 }}>
              {row[index]}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/** A summary that opens to show more, as the web's `<details>`. */
export function Disclosure({
  summary,
  open: initial = false,
  children,
  style,
}: {
  summary: ReactNode;
  open?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <View style={[{ gap: 8 }, style]}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(!open)}
        style={{ flexDirection: "row", gap: 8, alignItems: "center" }}
      >
        <SiteText style={{ fontWeight: "600" }}>{open ? "▾" : "▸"}</SiteText>
        {typeof summary === "string" ? <SiteText style={{ fontWeight: "600", flex: 1 }}>{summary}</SiteText> : summary}
      </Pressable>
      {open && children}
    </View>
  );
}

const BUTTON_HEIGHTS = { sm: 32, md: 40, lg: 48 } as const;

/** A button in the theme's colors, as the Button block's styles are: it opens `href`, or does `onPress`. */
export function SiteButton({
  label,
  href,
  onPress,
  variant = "primary",
  size = "md",
  disabled,
  style,
  textStyle,
}: {
  label: string;
  href?: string;
  onPress?: () => void;
  variant?: "primary" | "secondary" | "outline" | "link";
  size?: keyof typeof BUTTON_HEIGHTS;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
}) {
  const site = useNativeSite();
  const { colors, radius } = site.theme;
  const fill = variant === "primary" ? colors.primary : variant === "secondary" ? colors.secondary : "transparent";
  const text =
    variant === "primary"
      ? colors.primaryForeground
      : variant === "secondary"
        ? colors.secondaryForeground
        : variant === "link"
          ? colors.primary
          : colors.foreground;
  return (
    <Pressable
      accessibilityRole={href ? "link" : "button"}
      accessibilityState={{ disabled: disabled === true }}
      disabled={disabled}
      onPress={() => (href ? site.open(href) : onPress?.())}
      style={({ pressed }) => [
        {
          alignSelf: "flex-start",
          justifyContent: "center",
          backgroundColor: fill,
          opacity: pressed || disabled ? 0.8 : 1,
        },
        variant !== "link" && {
          height: BUTTON_HEIGHTS[size],
          paddingHorizontal: size === "sm" ? 12 : size === "lg" ? 32 : 20,
          borderRadius: radius,
        },
        variant === "outline" && { borderWidth: 1, borderColor: colors.foreground },
        style,
      ]}
    >
      <SiteText
        style={[
          { color: text, fontWeight: "500", fontSize: size === "sm" ? TEXT.sm : size === "lg" ? TEXT.lg : TEXT.base },
          variant === "link" && { textDecorationLine: "underline" },
          textStyle,
        ]}
      >
        {label}
      </SiteText>
    </Pressable>
  );
}

/**
 * Blocks on a background of another color, such as a Section's: their text
 * takes `foreground`, as it would on the web, where text inherits its color.
 */
export function OnColor({ foreground, muted, children }: { foreground: string; muted?: string; children: ReactNode }) {
  const site = useNativeSite();
  const value = useMemo(
    () => ({
      ...site,
      theme: {
        ...site.theme,
        colors: { ...site.theme.colors, foreground, mutedForeground: muted ?? foreground },
      },
    }),
    [site, foreground, muted],
  );
  return <NativeSiteProvider value={value}>{children}</NativeSiteProvider>;
}

/** A box that says something instead, such as a block the app can't show. */
export function Notice({ children }: { children: ReactNode }) {
  const { theme } = useNativeSite();
  return (
    <View
      style={{
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: theme.colors.border,
        borderRadius: theme.radius,
        padding: 12,
      }}
    >
      <SiteText muted style={{ fontSize: TEXT.sm }}>
        {children}
      </SiteText>
    </View>
  );
}

/** A block the app has no code for: a note that opens the page on the website, or the app's fallback. */
export function MissingBlock({ type, props }: { type: string; props: Record<string, unknown> }) {
  const root = useSiteRoot();
  const site = useNativeSite();
  const Fallback = root.fallback;
  if (Fallback) return <Fallback type={type} props={props} path={site.path || "/"} />;
  return (
    <Pressable
      accessibilityRole="link"
      onPress={() => site.open(site.address(site.path || "/"))}
      style={{ backgroundColor: site.theme.colors.muted, borderRadius: site.theme.radius, padding: 16 }}
    >
      <SiteText muted style={{ fontSize: TEXT.sm }}>
        Open this page on the website to see all of it.
      </SiteText>
    </Pressable>
  );
}

interface BlockData {
  type: string;
  props: Record<string, unknown> & { id?: string };
}

function isBlockData(value: unknown): value is BlockData {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof (value as BlockData).type === "string" &&
    typeof (value as BlockData).props === "object"
  );
}

/** Blocks such as a slot's, each drawn by the app's block of its name, for a block to lay out itself. */
export function useBlocks(items: unknown): ReactNode[] {
  const { blocks } = useSiteRoot();
  const list = Array.isArray(items) ? items.filter(isBlockData) : [];
  return list.map((block, index) => {
    const Block = blocks[block.type];
    const key = block.props.id ?? `${block.type}-${index}`;
    return Block ? (
      <Styled key={key} className={block.props.className} itself={isStyledItself(Block)}>
        <Block {...block.props} />
      </Styled>
    ) : (
      <MissingBlock key={key} type={block.type} props={block.props} />
    );
  });
}

function isStyledItself(block: NativeBlock): boolean {
  return (block as unknown as Record<symbol, boolean>)[STYLES_ITSELF] === true;
}

/** A block with its Style: in a box with it, unless it applies it itself, and its text taking it. */
function Styled({ className, itself, children }: { className: unknown; itself: boolean; children: ReactNode }) {
  const site = useNativeSite();
  const { width } = useWindowDimensions();
  const outer = useContext(BlockStyleContext);
  const own = useMemo(
    () => classStyle(className, { settings: site.settings, theme: site.theme, width }),
    [className, site.settings, site.theme, width],
  );
  const value = useMemo(() => {
    const styled = hasStyle(own.text) || hasStyle(own.view);
    if (!styled && outer.own === NO_STYLE.own) return outer;
    // The blocks in this one take its text, but not its own Style.
    return { text: { ...outer.text, ...own.text }, own: styled ? own : NO_STYLE.own };
  }, [outer, own]);
  const shown = itself || !hasStyle(own.view) ? children : <View style={own.view}>{children}</View>;
  return value === outer ? shown : <BlockStyleContext.Provider value={value}>{shown}</BlockStyleContext.Provider>;
}

/** The space between blocks one under another, in points. */
export const BLOCK_GAP = 16;

/** Blocks, one under another, such as a page's or a slot's: each drawn by the app's block of its name. */
export function Blocks({
  items,
  gap = BLOCK_GAP,
  style,
}: {
  items: unknown;
  gap?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const shown = useBlocks(items);
  if (shown.length === 0) return null;
  return <View style={[{ gap }, style]}>{shown}</View>;
}

// Rich text ---------------------------------------------------------------------

function Inline({ nodes, base }: { nodes: RichTextInline[]; base?: StyleProp<TextStyle> }) {
  const site = useNativeSite();
  const { colors } = site.theme;
  return (
    <Text style={base}>
      {nodes.map((node, index) => {
        // biome-ignore lint/suspicious/noArrayIndexKey: rich text has no ids, and only changes all together
        if (node.type === "break") return <Text key={index}>{"\n"}</Text>;
        if (node.type === "image") {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: as above
            <Text key={index} accessibilityLabel={node.alt}>
              {node.alt ? `[${node.alt}]` : ""}
            </Text>
          );
        }
        const style: TextStyle = {
          ...(node.bold && { fontWeight: "700" }),
          ...(node.italic && { fontStyle: "italic" }),
          ...((node.underline || node.link) && {
            textDecorationLine: node.strike ? "underline line-through" : "underline",
          }),
          ...(node.strike && !node.underline && !node.link && { textDecorationLine: "line-through" }),
          ...(node.code && { fontFamily: site.theme.fonts.mono ?? "monospace", backgroundColor: colors.muted }),
          ...(node.superscript && { fontSize: TEXT.xs, lineHeight: 14 }),
          ...(node.subscript && { fontSize: TEXT.xs, lineHeight: 14 }),
          ...(node.link && { color: colors.primary }),
        };
        const link = node.link;
        return (
          <Text
            // biome-ignore lint/suspicious/noArrayIndexKey: as above
            key={index}
            style={style}
            {...(link && { accessibilityRole: "link" as const, onPress: () => site.open(link) })}
          >
            {node.text}
          </Text>
        );
      })}
    </Text>
  );
}

const HEADING_SIZES = { 1: TEXT["4xl"], 2: TEXT["3xl"], 3: TEXT["2xl"], 4: TEXT.xl, 5: TEXT.lg, 6: TEXT.base } as const;

function Heading({ node }: { node: Extract<RichTextBlock, { type: "heading" }> }) {
  const site = useNativeSite();
  const ref = useRef<ComponentRef<typeof View>>(null);
  const { id } = node;
  useEffect(() => {
    if (!id) return;
    return site.anchor(
      id,
      () =>
        new Promise((resolve) => {
          const view = ref.current;
          if (!view) return resolve(undefined);
          view.measureInWindow((_x, y) => resolve(y));
        }),
    );
  }, [id, site]);
  const size = HEADING_SIZES[node.level];
  return (
    <View ref={ref}>
      <SiteText heading={node.level} style={{ fontSize: size, lineHeight: Math.round(size * 1.25), fontWeight: "700" }}>
        <Inline nodes={node.children} />
      </SiteText>
    </View>
  );
}

function Part({ node, depth }: { node: RichTextBlock; depth: number }): ReactNode {
  const site = useNativeSite();
  const { colors, radius } = site.theme;
  switch (node.type) {
    case "paragraph":
      return (
        <SiteText>
          <Inline nodes={node.children} />
        </SiteText>
      );
    case "heading":
      return <Heading node={node} />;
    case "quote":
      return (
        <View style={{ borderLeftWidth: 3, borderLeftColor: colors.border, paddingLeft: 12 }}>
          <RichText nodes={node.children} depth={depth + 1} />
        </View>
      );
    case "list":
      return (
        <View style={{ gap: 4 }}>
          {node.items.map((item, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: list items have no ids
            <View key={index} style={{ flexDirection: "row", gap: 8 }}>
              <SiteText>{node.ordered ? `${(node.start ?? 1) + index}.` : "•"}</SiteText>
              <View style={{ flex: 1 }}>
                <RichText nodes={item} depth={depth + 1} />
              </View>
            </View>
          ))}
        </View>
      );
    case "code":
      return (
        <View style={{ backgroundColor: colors.muted, borderRadius: radius, padding: 12 }}>
          <SiteText selectable style={{ fontFamily: site.theme.fonts.mono ?? "monospace", fontSize: TEXT.sm }}>
            {node.code}
          </SiteText>
        </View>
      );
    case "image":
      return (
        <View style={{ gap: 4 }}>
          <NativeImage src={node.src} alt={node.alt} aspect="landscape" />
          {node.caption && (
            <SiteText muted style={{ fontSize: TEXT.sm }}>
              <Inline nodes={node.caption} />
            </SiteText>
          )}
        </View>
      );
    case "rule":
      return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: 8 }} />;
    case "table":
      return (
        <View style={{ borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: radius }}>
          {node.rows.map((row, rowIndex) => (
            <View
              // biome-ignore lint/suspicious/noArrayIndexKey: rows have no ids
              key={rowIndex}
              style={[{ flexDirection: "row" }, row.header && { backgroundColor: colors.muted }]}
            >
              {row.cells.map((cell, cellIndex) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: cells have no ids
                <View key={cellIndex} style={{ flex: 1, padding: 8 }}>
                  <SiteText style={row.header ? { fontWeight: "600" } : undefined}>
                    <Inline nodes={cell} />
                  </SiteText>
                </View>
              ))}
            </View>
          ))}
        </View>
      );
  }
}

/** Rich text from the content API's simple structure, drawn with React Native's own parts. */
export function RichText({
  nodes,
  depth = 0,
  style,
}: {
  nodes: RichTextBlock[] | undefined;
  depth?: number;
  style?: StyleProp<ViewStyle>;
}) {
  if (!nodes || nodes.length === 0) return null;
  return (
    <View style={[{ gap: 12 }, style]}>
      {nodes.map((node, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rich text has no ids, and only changes all together
        <Fragment key={index}>
          <Part node={node} depth={depth} />
        </Fragment>
      ))}
    </View>
  );
}
