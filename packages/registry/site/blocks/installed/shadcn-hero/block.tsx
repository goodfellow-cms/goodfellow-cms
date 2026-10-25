import { classNameField, mediaField, SiteImage, SiteLink, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { buttonVariants } from "@/components/ui/button";

type Layout = "centered" | "beside";

export interface HeroProps {
  title: string;
  text: string;
  image: string;
  imageAlt: string;
  layout: Layout;
  primaryLabel: string;
  primaryLink: string;
  secondaryLabel: string;
  secondaryLink: string;
  className: string;
}

/** A large heading at the top of a page, with text, up to two buttons and a picture. */
const Hero: ComponentConfig<HeroProps> = withParts(
  {
    label: "Hero",
    fields: {
      title: { type: "text", label: "Heading", contentEditable: true },
      text: { type: "textarea", label: "Text", contentEditable: true },
      image: mediaField("Picture"),
      imageAlt: { type: "text", label: "Description of the picture for screen readers" },
      layout: {
        type: "radio",
        label: "Layout",
        options: [
          { label: "Centered, picture below", value: "centered" },
          { label: "Picture beside the text", value: "beside" },
        ],
      },
      primaryLabel: { type: "text", label: "Main button" },
      primaryLink: { type: "text", label: "Main button links to" },
      secondaryLabel: { type: "text", label: "Second button (optional)" },
      secondaryLink: { type: "text", label: "Second button links to" },
      className: classNameField,
    },
    defaultProps: {
      title: "Welcome",
      text: "Say in a sentence or two what this site is about.",
      image: "",
      imageAlt: "",
      layout: "centered",
      primaryLabel: "Find out more",
      primaryLink: "/about",
      secondaryLabel: "",
      secondaryLink: "",
      className: "",
    },
    render: ({
      title,
      text,
      image,
      imageAlt,
      layout,
      primaryLabel,
      primaryLink,
      secondaryLabel,
      secondaryLink,
      className,
    }) => {
      const part = useParts();
      const beside = layout === "beside";
      return (
        <section className={part("gf-shadcn-hero", "mx-auto w-full max-w-6xl px-4 py-16 md:py-24", className)}>
          <div
            className={part(
              "gf-shadcn-hero-layout",
              "flex flex-col gap-10",
              beside ? "md:flex-row md:items-center" : "items-center text-center",
            )}
          >
            <div
              className={part(
                "gf-shadcn-hero-text",
                "flex flex-col gap-6",
                beside ? "md:flex-1" : "max-w-3xl items-center",
              )}
            >
              <h1
                className={part("gf-shadcn-hero-heading", "text-4xl font-bold tracking-tight text-balance md:text-6xl")}
              >
                {title}
              </h1>
              {text && (
                <p className={part("gf-shadcn-hero-intro", "text-lg text-muted-foreground md:text-xl")}>{text}</p>
              )}
              {(primaryLabel || secondaryLabel) && (
                <div className={part("gf-shadcn-hero-buttons", "flex flex-wrap gap-3")}>
                  {primaryLabel && (
                    <SiteLink
                      href={primaryLink || "/"}
                      className={part("gf-shadcn-hero-button", buttonVariants({ size: "lg" }))}
                    >
                      {primaryLabel}
                    </SiteLink>
                  )}
                  {secondaryLabel && (
                    <SiteLink
                      href={secondaryLink || "/"}
                      className={part("gf-shadcn-hero-button", buttonVariants({ size: "lg", variant: "outline" }))}
                    >
                      {secondaryLabel}
                    </SiteLink>
                  )}
                </div>
              )}
            </div>
            {image && (
              <SiteImage
                src={image}
                alt={imageAlt}
                className={part(
                  "gf-shadcn-hero-image",
                  "w-full rounded-xl object-cover",
                  beside ? "md:w-1/2" : "max-w-4xl",
                )}
              />
            )}
          </div>
        </section>
      );
    },
  },
  {
    "gf-shadcn-hero": "Hero",
    "gf-shadcn-hero-layout": "Text and picture",
    "gf-shadcn-hero-text": "Text",
    "gf-shadcn-hero-heading": "Heading",
    "gf-shadcn-hero-intro": "Introduction",
    "gf-shadcn-hero-buttons": "Buttons",
    "gf-shadcn-hero-button": "Button",
    "gf-shadcn-hero-image": "Picture",
  },
);

export default Hero;
