import { classNameField, mediaField, SiteImage, SiteLink, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { SlideshowPictures } from "./slideshow-pictures";

interface Slide {
  image: string;
  alt: string;
}

interface QuickLink {
  label: string;
  href: string;
}

export interface SlideshowHeroProps {
  slides: Slide[];
  seconds: number;
  badge: string;
  badgeAlt: string;
  links: QuickLink[];
  /** Words for the pause button and the dots, which screen readers say. */
  words: { pause: string; play: string; picture: string };
  className: string;
}

/**
 * The top of a home page: pictures that fade from one to the next across the full width, with a
 * badge (such as a logo) and a column of quick links beside them. It changes pictures on its own
 * unless the visitor asks for less motion, stops while the pointer or the keyboard is in it, and
 * has a button to stop it.
 */
const SlideshowHero: ComponentConfig<SlideshowHeroProps> = withParts(
  {
    label: "Slideshow with quick links",
    fields: {
      slides: {
        type: "array",
        label: "Pictures",
        arrayFields: {
          image: mediaField("Picture"),
          alt: { type: "text", label: "Description for screen readers" },
        },
        defaultItemProps: { image: "", alt: "" },
        getItemSummary: (slide, index) => slide.alt || `Picture ${(index ?? 0) + 1}`,
      },
      seconds: { type: "number", label: "Seconds each picture shows", min: 2, max: 30 },
      badge: mediaField("Badge above the links (optional)"),
      badgeAlt: { type: "text", label: "Badge's description for screen readers" },
      links: {
        type: "array",
        label: "Quick links",
        arrayFields: {
          label: { type: "text", label: "Label" },
          href: { type: "text", label: "Links to" },
        },
        defaultItemProps: { label: "New link", href: "/" },
        getItemSummary: (link) => link.label || "New link",
      },
      words: {
        type: "object",
        label: "Words on the buttons",
        objectFields: {
          pause: { type: "text", label: "Stop button" },
          play: { type: "text", label: "Start button" },
          picture: { type: "text", label: "Each dot, for screen readers, before its number" },
        },
      },
      className: classNameField,
    },
    defaultProps: {
      slides: [],
      seconds: 6,
      badge: "",
      badgeAlt: "",
      links: [],
      words: { pause: "Pause", play: "Play", picture: "Show picture" },
      className: "",
    },
    render: ({ slides, seconds, badge, badgeAlt, links, words, className }) => {
      const part = useParts();
      const shown = slides.filter((slide) => slide.image);
      return (
        <section className={part("gf-slideshow-hero", "relative isolate overflow-hidden bg-primary", className)}>
          {shown.length > 0 && (
            <SlideshowPictures
              slides={shown}
              seconds={seconds}
              words={{
                pause: words.pause || "Pause",
                play: words.play || "Play",
                picture: words.picture || "Show picture",
              }}
              classes={{
                picture: part(
                  "gf-slideshow-hero-picture",
                  "absolute inset-0 h-full w-full object-cover transition-opacity duration-1000",
                ),
                controls: part("gf-slideshow-hero-dots", "absolute bottom-4 left-4 z-10 flex items-center gap-2"),
                dot: part("gf-slideshow-hero-dot", "size-3.5 rounded-full border border-white/80"),
                pause: part(
                  "gf-slideshow-hero-pause",
                  "mr-1 rounded-full bg-black/60 px-3 py-1 text-sm text-white hover:bg-black/80",
                ),
              }}
            />
          )}
          <div
            className={part(
              "gf-slideshow-hero-inner",
              "relative mx-auto flex min-h-[22rem] max-w-7xl items-center justify-end px-4 py-8 md:min-h-[28rem]",
            )}
          >
            {(badge || links.length > 0) && (
              <div
                className={part("gf-slideshow-hero-links", "relative z-10 flex w-full max-w-xs flex-col gap-2 md:mr-4")}
              >
                {badge && (
                  <div className={part("gf-slideshow-hero-badge", "bg-primary/90 px-6 py-4")}>
                    <SiteImage
                      src={badge}
                      alt={badgeAlt}
                      aria-hidden={badgeAlt ? undefined : true}
                      className="mx-auto max-h-28 w-auto"
                    />
                  </div>
                )}
                {links.map((link, index) => (
                  <SiteLink
                    // biome-ignore lint/suspicious/noArrayIndexKey: links have no ids of their own
                    key={index}
                    href={link.href}
                    className={part(
                      "gf-slideshow-hero-link",
                      "bg-primary/90 px-4 py-2.5 text-center text-lg text-primary-foreground shadow transition-colors hover:bg-secondary hover:text-secondary-foreground",
                    )}
                  >
                    {link.label}
                  </SiteLink>
                ))}
              </div>
            )}
          </div>
        </section>
      );
    },
  },
  {
    "gf-slideshow-hero": "Slideshow",
    "gf-slideshow-hero-picture": "Picture",
    "gf-slideshow-hero-dots": "Dots and stop button",
    "gf-slideshow-hero-dot": "Dot",
    "gf-slideshow-hero-pause": "Stop button",
    "gf-slideshow-hero-inner": "Inner area",
    "gf-slideshow-hero-links": "Badge and links",
    "gf-slideshow-hero-badge": "Badge",
    "gf-slideshow-hero-link": "Quick link",
  },
);

export default SlideshowHero;
