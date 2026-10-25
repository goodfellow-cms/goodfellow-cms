import { classNameField, mediaField, useParts, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import { ImageCarousel } from "./image-carousel";

interface Slide {
  image: string;
  alt: string;
  caption: string;
}

export interface CarouselProps {
  slides: Slide[];
  loop: boolean;
  className: string;
}

/** Pictures shown one at a time, with buttons to move between them. */
const Carousel: ComponentConfig<CarouselProps> = withParts(
  {
    label: "Image carousel",
    fields: {
      slides: {
        type: "array",
        label: "Pictures",
        arrayFields: {
          image: mediaField("Picture"),
          alt: { type: "text", label: "Description for screen readers" },
          caption: { type: "text", label: "Caption" },
        },
        defaultItemProps: { image: "", alt: "", caption: "" },
        getItemSummary: (slide, index) => slide.caption || slide.alt || `Picture ${(index ?? 0) + 1}`,
      },
      loop: {
        type: "radio",
        label: "Start again after the last picture",
        options: [
          { label: "Yes", value: true },
          { label: "No", value: false },
        ],
      },
      className: classNameField,
    },
    defaultProps: { slides: [], loop: true, className: "" },
    render: ({ slides, loop, className }) => {
      const part = useParts();
      const image = part("gf-shadcn-carousel-image", "aspect-video w-full rounded-xl object-cover");
      return (
        <section className={part("gf-shadcn-carousel", "mx-auto w-full max-w-4xl px-14 py-8", className)}>
          {slides.length > 0 ? (
            <ImageCarousel
              slides={slides.filter((slide) => slide.image)}
              loop={loop}
              classes={{
                image,
                caption: part("gf-shadcn-carousel-caption", "mt-2 text-center text-sm text-muted-foreground"),
              }}
            />
          ) : (
            <div className={part("gf-shadcn-carousel-image", "aspect-video w-full rounded-xl bg-muted")} />
          )}
        </section>
      );
    },
  },
  {
    "gf-shadcn-carousel": "Carousel",
    "gf-shadcn-carousel-image": "Picture",
    "gf-shadcn-carousel-caption": "Caption",
  },
);

export default Carousel;
