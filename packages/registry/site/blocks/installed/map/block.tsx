import { ConsentFrame, classNameField, useParts, withKeywords, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

export interface MapProps {
  query: string;
  title: string;
  zoom: number;
  height: number;
  className: string;
}

/**
 * The map's address: Google Maps' own embed address, from the embed code its
 * Share button gives (or that address itself), or else a map of the address
 * or place, which needs no key. Nothing but Google Maps' embedded maps is shown.
 */
export function mapAddress(input: string, zoom: number): string | undefined {
  const text = input.trim();
  if (!text) return undefined;
  const embedded = /<iframe\b[^>]*\bsrc=["']([^"']+)["']/i.exec(text)?.[1]?.replaceAll("&amp;", "&") ?? text;
  if (/^https:\/\//i.test(embedded)) {
    try {
      const url = new URL(embedded);
      return url.hostname === "www.google.com" && url.pathname === "/maps/embed" ? url.href : undefined;
    } catch {
      return undefined;
    }
  }
  if (text.includes("<")) return undefined;
  const params = new URLSearchParams({ q: text, z: String(Math.min(21, Math.max(1, zoom || 15))), output: "embed" });
  return `https://maps.google.com/maps?${params}`;
}

function MapView({ query, title, zoom, height, className, puck }: MapProps & { puck?: { isEditing?: boolean } }) {
  const part = useParts();
  const src = mapAddress(query, zoom);
  if (!src) {
    // Only editors see why there's no map; visitors see nothing.
    if (!puck?.isEditing) return null;
    return (
      <div className={part("gf-map", "rounded-lg bg-muted p-6 text-muted-foreground", className)}>
        {query.trim()
          ? "This isn't an address or Google Maps' embed code, so no map is shown."
          : "Enter an address to show a map."}
      </div>
    );
  }
  return (
    // On a site that asks visitors before loading other sites' content, Google's map waits until they agree.
    <ConsentFrame
      box
      src={src}
      title={title || "Map"}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      // Google's map needs its scripts and its own address; it can open Google Maps, but nothing else.
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      boxClassName={className}
      className={part("gf-map", "w-full rounded-lg border border-border")}
      style={{ height: Math.max(200, height || 400) }}
    />
  );
}

/** A Google map of an address or place, which visitors can move around and open in Google Maps. No API key needed. */
const MapBlock: ComponentConfig<MapProps> = withParts(
  {
    label: "Map",
    fields: {
      query: {
        type: "textarea",
        label: "Address or place, or the embed code from Google Maps' Share button",
        placeholder: "1600 Pennsylvania Ave NW, Washington, DC",
      },
      title: { type: "text", label: "What the map shows, for screen readers" },
      zoom: { type: "number", label: "Zoom, for an address (1 is the world, 21 a building)", min: 1, max: 21 },
      height: { type: "number", label: "Height in pixels", min: 200, max: 900 },
      className: classNameField,
    },
    defaultProps: { query: "", title: "Map", zoom: 15, height: 400, className: "" },
    render: (props) => <MapView {...props} />,
  },
  { "gf-map": "Map" },
);

export default withKeywords(MapBlock, ["map", "google maps", "address", "location", "directions"]);
