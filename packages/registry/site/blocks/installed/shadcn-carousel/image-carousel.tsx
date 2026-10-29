"use client";

import { SiteImage } from "@goodfellow-cms/react";
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel";

/** Runs with Preact as well as React, so sites whose Client Components all do load Preact instead (see Islands). */
export const worksWithPreact = true;

/** The pictures, one at a time, with previous and next buttons, and their parts' classes from the block. */
export function ImageCarousel({
  slides,
  loop,
  classes,
}: {
  slides: Array<{ image: string; alt: string; caption: string }>;
  loop: boolean;
  classes: { image: string; caption: string };
}) {
  return (
    <Carousel opts={{ loop }}>
      <CarouselContent>
        {slides.map((slide, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: pictures have no ids of their own
          <CarouselItem key={index}>
            <figure>
              <SiteImage src={slide.image} alt={slide.alt} className={classes.image} />
              {slide.caption && <figcaption className={classes.caption}>{slide.caption}</figcaption>}
            </figure>
          </CarouselItem>
        ))}
      </CarouselContent>
      <CarouselPrevious />
      <CarouselNext />
    </Carousel>
  );
}
