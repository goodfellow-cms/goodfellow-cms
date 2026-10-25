import { classNameField, mediaField, SiteImage, SiteLink, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, RichText } from "@puckeditor/core";
import { options, yesNo } from "./options.js";
import { BUTTON_PARTS, HEADING_PARTS, IMAGE_PARTS, TEXT_PARTS } from "./parts.js";

type Level = "h1" | "h2" | "h3" | "h4";
type TextAlign = "left" | "center" | "right";

const alignClasses: Record<TextAlign, string> = { left: "text-left", center: "text-center", right: "text-right" };
const alignOptions = options({ left: "Left", center: "Center", right: "Right" });

export interface HeadingProps {
  text: string;
  level: Level;
  align: TextAlign;
  className: string;
}

const levelClasses: Record<Level, string> = {
  h1: "text-4xl md:text-5xl font-bold tracking-tight",
  h2: "text-3xl md:text-4xl font-bold tracking-tight",
  h3: "text-2xl font-semibold",
  h4: "text-xl font-semibold",
};

export const Heading: ComponentConfig<HeadingProps> = withParts(
  {
    label: "Heading",
    fields: {
      text: { type: "text", label: "Text", contentEditable: true },
      level: {
        type: "select",
        label: "Level",
        options: options({ h1: "Page title (H1)", h2: "Section (H2)", h3: "Subsection (H3)", h4: "Small (H4)" }),
      },
      align: { type: "radio", label: "Alignment", options: alignOptions },
      className: classNameField,
    },
    defaultProps: { text: "Heading", level: "h2", align: "left", className: "" },
    render: ({ text, level: Tag, align, className }) => {
      const part = useParts();
      return (
        <Tag className={part("gf-heading", ["text-balance", levelClasses[Tag]], alignClasses[align], className)}>
          {text}
        </Tag>
      );
    },
  },
  HEADING_PARTS,
);

export interface TextProps {
  content: RichText;
  align: TextAlign;
  className: string;
}

/** Formatted text: paragraphs, lists, links and subheadings. */
export const Text: ComponentConfig<TextProps> = withParts(
  {
    label: "Text",
    fields: {
      content: {
        type: "richtext",
        label: "Text",
        contentEditable: true,
        // Tiptap opens every link in a new tab by default; keep links in the same tab like the rest of the site.
        options: { link: { HTMLAttributes: { target: null, rel: null } } },
      },
      align: { type: "radio", label: "Alignment", options: alignOptions },
      className: classNameField,
    },
    defaultProps: { content: "<p>Write something here.</p>", align: "left", className: "" },
    render: ({ content, align, className }) => {
      const part = useParts();
      return <div className={part("gf-text", "gf-prose", alignClasses[align], className)}>{content}</div>;
    },
  },
  TEXT_PARTS,
);

type Variant = "primary" | "secondary" | "outline" | "link";
type Size = "sm" | "md" | "lg";

export interface ButtonProps {
  label: string;
  href: string;
  variant: Variant;
  size: Size;
  newTab: boolean;
  className: string;
}

const variantClasses: Record<Variant, string> = {
  primary: "bg-primary text-primary-foreground hover:opacity-90",
  secondary: "bg-secondary text-secondary-foreground hover:opacity-90",
  outline: "border border-current hover:bg-accent hover:text-accent-foreground",
  link: "text-primary underline-offset-4 hover:underline",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-5",
  lg: "h-12 px-8 text-lg",
};

export const Button: ComponentConfig<ButtonProps> = withParts(
  {
    label: "Button",
    fields: {
      label: { type: "text", label: "Label", contentEditable: true },
      href: { type: "text", label: "Link to" },
      variant: {
        type: "select",
        label: "Style",
        options: options({ primary: "Primary", secondary: "Secondary", outline: "Outline", link: "Text link" }),
      },
      size: { type: "radio", label: "Size", options: options({ sm: "Small", md: "Medium", lg: "Large" }) },
      newTab: { type: "radio", label: "Open in a new tab", options: yesNo },
      className: classNameField,
    },
    defaultProps: { label: "Learn more", href: "/", variant: "primary", size: "md", newTab: false, className: "" },
    render: ({ label, href, variant, size, newTab, className }) => {
      const part = useParts();
      return (
        <SiteLink
          href={href}
          className={part(
            "gf-button",
            [
              "inline-flex items-center justify-center rounded-md font-medium whitespace-nowrap transition",
              variantClasses[variant],
              sizeClasses[size],
            ],
            className,
          )}
          {...(newTab && { target: "_blank", rel: "noopener noreferrer" })}
        >
          {label}
        </SiteLink>
      );
    },
  },
  BUTTON_PARTS,
);

type Aspect = "auto" | "square" | "landscape" | "wide";

/** A placeholder for a collection's field, such as `{photo}`. */
const PLACEHOLDER = /^\{[a-z][a-z0-9]*(?:-[a-z0-9]+)*\}$/;

export interface ImageProps {
  src: string;
  alt: string;
  /** Only decoration, such as a pattern, which people who can't see it needn't hear about. Stored images may predate it. */
  decorative?: boolean;
  caption: string;
  aspect: Aspect;
  rounded: boolean;
  className: string;
}

const aspectClasses: Record<Aspect, string> = {
  auto: "",
  square: "aspect-square object-cover",
  landscape: "aspect-[4/3] object-cover",
  wide: "aspect-video object-cover",
};

export const Image: ComponentConfig<ImageProps> = withParts(
  {
    label: "Image",
    fields: {
      src: mediaField("Image"),
      alt: { type: "text", label: "Description for screen readers" },
      decorative: { type: "radio", label: "Only decoration, with nothing to describe", options: yesNo },
      caption: { type: "text", label: "Caption" },
      aspect: {
        type: "select",
        label: "Shape",
        options: options({ auto: "Original", square: "Square", landscape: "Landscape (4:3)", wide: "Wide (16:9)" }),
      },
      rounded: { type: "radio", label: "Rounded corners", options: yesNo },
      className: classNameField,
    },
    defaultProps: { src: "", alt: "", decorative: false, caption: "", aspect: "auto", rounded: true, className: "" },
    render: ({ src, alt, decorative, caption, aspect, rounded, className }) => {
      const part = useParts();
      // Square corners are a choice, so they win over a theme's rounded ones.
      const corners = rounded ? "rounded-lg" : "rounded-none";
      return (
        <figure className={part("gf-image", undefined, className)}>
          {PLACEHOLDER.test(src) ? (
            // A field's placeholder, such as {photo} in a collection's template or loop, filled in where pages are built.
            <div
              className={part(
                "gf-image-picture",
                "flex w-full items-center justify-center bg-muted text-sm text-muted-foreground",
                aspectClasses[aspect] || "aspect-video",
                corners,
              )}
            >
              {src}
            </div>
          ) : src ? (
            <SiteImage
              src={src}
              alt={decorative ? "" : alt}
              aria-hidden={decorative || undefined}
              loading="lazy"
              className={part("gf-image-picture", "w-full", aspectClasses[aspect], corners)}
            />
          ) : (
            <div className={part("gf-image-picture", "w-full bg-muted aspect-video", corners)} />
          )}
          {caption && (
            <figcaption className={part("gf-image-caption", "mt-2 text-sm text-muted-foreground")}>
              {caption}
            </figcaption>
          )}
        </figure>
      );
    },
  },
  IMAGE_PARTS,
);
