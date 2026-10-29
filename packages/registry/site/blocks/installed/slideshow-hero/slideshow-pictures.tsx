"use client";

import { SiteImage } from "@goodfellow-cms/react";
import { useEffect, useState } from "react";

/** Runs with Preact as well as React, so sites whose Client Components all do load Preact instead (see Islands). */
export const worksWithPreact = true;

/**
 * The pictures, fading from one to the next every few seconds, with a dot for
 * each and a button that stops them. They stop while the pointer is over them
 * or the keyboard is in them, and don't change by themselves at all for
 * visitors who ask for less motion.
 */
export function SlideshowPictures({
  slides,
  seconds,
  words,
  classes,
}: {
  slides: Array<{ image: string; alt: string }>;
  seconds: number;
  words: { pause: string; play: string; picture: string };
  classes: { picture: string; controls: string; dot: string; pause: string };
}) {
  const [shown, setShown] = useState(0);
  const [hovered, setHovered] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [still, setStill] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(query.matches);
    const changed = () => setStill(query.matches);
    query.addEventListener("change", changed);
    return () => query.removeEventListener("change", changed);
  }, []);

  const moving = slides.length > 1 && !still && !stopped;
  useEffect(() => {
    if (!moving || hovered) return;
    const timer = window.setInterval(
      () => setShown((index) => (index + 1) % slides.length),
      Math.max(2, seconds) * 1000,
    );
    return () => window.clearInterval(timer);
  }, [moving, hovered, slides.length, seconds]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: it only notices the pointer and the keyboard in it, to stop the pictures; its buttons are what visitors use
    <div
      className="absolute inset-0"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
    >
      {slides.map((slide, index) => (
        <SiteImage
          // biome-ignore lint/suspicious/noArrayIndexKey: pictures have no ids of their own
          key={index}
          src={slide.image}
          alt={index === shown ? slide.alt : ""}
          // Pictures not shown, and ones without a description, are only there to look at.
          aria-hidden={index === shown && slide.alt ? undefined : true}
          className={`${classes.picture} ${index === shown ? "opacity-100" : "opacity-0"}`}
        />
      ))}
      {slides.length > 1 && (
        <div className={classes.controls}>
          {!still && (
            <button type="button" onClick={() => setStopped(!stopped)} className={classes.pause}>
              {stopped ? words.play : words.pause}
            </button>
          )}
          {slides.map((slide, index) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: pictures have no ids of their own
              key={index}
              type="button"
              aria-label={`${words.picture} ${index + 1}${slide.alt ? `: ${slide.alt}` : ""}`}
              aria-current={index === shown}
              onClick={() => setShown(index)}
              className={`${classes.dot} ${index === shown ? "bg-white" : "bg-black/50 hover:bg-white/70"}`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
