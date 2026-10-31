import { ConsentFrame, classNameField, useParts, withKeywords, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

type MapService = "google" | "openstreetmap";

export interface MapProps {
  /** Whose map it shows: Google Maps where it's missing. */
  service?: MapService;
  query: string;
  title: string;
  zoom: number;
  height: number;
  className: string;
}

const OSM = "https://www.openstreetmap.org";

/** A latitude and longitude written as `51.5055, -0.0754`, or `undefined`. */
function coordinates(text: string): { lat: number; lon: number } | undefined {
  const match = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(text);
  if (!match) return undefined;
  const lat = Number(match[1]);
  const lon = Number(match[2]);
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : undefined;
}

/** OpenStreetMap's embedded map around a point, with a marker on it, about as wide as a page's column at `zoom`. */
function osmMapAt(lat: number, lon: number, zoom: number): string {
  const z = Math.min(19, Math.max(1, Math.round(zoom || 15)));
  const width = (360 / 2 ** z) * (700 / 256);
  const height = width * 0.6 * Math.cos((lat * Math.PI) / 180);
  const round = (value: number) => Number(value.toFixed(6));
  const bbox = [lon - width / 2, lat - height / 2, lon + width / 2, lat + height / 2].map(round).join(",");
  return `${OSM}/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${round(lat)},${round(lon)}`;
}

/**
 * OpenStreetMap's embedded map: from the embed code its Share button gives
 * (or that address), a link to a place on it (`#map=17/51.5/-0.07`, with
 * `mlat` and `mlon` for a marker), or a latitude and longitude. Addresses
 * can't be looked up without asking OpenStreetMap's search, which pages
 * and the editor don't, so they're refused.
 */
export function osmMapAddress(input: string, zoom: number): string | undefined {
  const text = input.trim();
  if (!text) return undefined;
  const point = coordinates(text);
  if (point) return osmMapAt(point.lat, point.lon, zoom);
  const given = /<iframe\b[^>]*\bsrc=["']([^"']+)["']/i.exec(text)?.[1]?.replaceAll("&amp;", "&") ?? text;
  let url: URL;
  try {
    url = new URL(given);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || !/^(www\.)?openstreetmap\.org$/.test(url.hostname)) return undefined;
  if (url.pathname === "/export/embed.html") {
    const bbox = url.searchParams.get("bbox") ?? "";
    if (!/^-?[\d.]+,-?[\d.]+,-?[\d.]+,-?[\d.]+$/.test(bbox)) return undefined;
    const marker = url.searchParams.get("marker");
    const params = new URLSearchParams({ bbox, layer: "mapnik" });
    if (marker && coordinates(marker)) params.set("marker", marker);
    return `${OSM}/export/embed.html?${params.toString().replaceAll("%2C", ",")}`;
  }
  const view = /map=(\d+)\/(-?[\d.]+)\/(-?[\d.]+)/.exec(url.hash);
  const mlat = url.searchParams.get("mlat");
  const mlon = url.searchParams.get("mlon");
  const marked = mlat && mlon ? coordinates(`${mlat},${mlon}`) : undefined;
  const centre = marked ?? (view ? coordinates(`${view[2]},${view[3]}`) : undefined);
  return centre ? osmMapAt(centre.lat, centre.lon, view ? Number(view[1]) : zoom) : undefined;
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

function MapView({
  service,
  query,
  title,
  zoom,
  height,
  className,
  puck,
}: MapProps & { puck?: { isEditing?: boolean } }) {
  const part = useParts();
  const osm = service === "openstreetmap";
  const src = osm ? osmMapAddress(query, zoom) : mapAddress(query, zoom);
  if (!src) {
    // Only editors see why there's no map; visitors see nothing.
    if (!puck?.isEditing) return null;
    return (
      <div className={part("gf-map", "rounded-lg bg-muted p-6 text-muted-foreground", className)}>
        {osm
          ? query.trim()
            ? "OpenStreetMap needs its embed code, a link to a place on it, or a latitude and longitude, such as 51.5055, -0.0754. It can't look addresses up."
            : "Paste the embed code from OpenStreetMap's Share button, or a latitude and longitude, to show a map."
          : query.trim()
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
      // The map needs its scripts and its own address; it can open its site in a new tab, but nothing else.
      sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
      boxClassName={className}
      className={part("gf-map", "w-full rounded-lg border border-border")}
      style={{ height: Math.max(200, height || 400) }}
    />
  );
}

/**
 * A map of an address or place, which visitors can move around: Google
 * Maps', or OpenStreetMap's from its embed code or a place's position. No API
 * key needed for either.
 */
const MapBlock: ComponentConfig<MapProps> = withParts(
  {
    label: "Map",
    fields: {
      service: {
        type: "radio",
        label: "Map",
        options: [
          { label: "Google Maps", value: "google" },
          { label: "OpenStreetMap", value: "openstreetmap" },
        ],
      },
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
    defaultProps: { service: "google", query: "", title: "Map", zoom: 15, height: 400, className: "" },
    // OpenStreetMap's maps are found by their embed code or a place's position, never an address.
    resolveFields: (data, { fields }) =>
      data.props.service === "openstreetmap"
        ? ({
            ...fields,
            query: {
              type: "textarea",
              label:
                "The embed code from OpenStreetMap's Share button, a link to a place on it, or a latitude and longitude",
              placeholder: "51.5055, -0.0754",
            },
            zoom: {
              type: "number",
              label: "Zoom, for a latitude and longitude (1 is the world, 19 a building)",
              min: 1,
              max: 19,
            },
          } as typeof fields)
        : fields,
    render: (props) => <MapView {...props} />,
  },
  { "gf-map": "Map" },
);

export default withKeywords(MapBlock, [
  "map",
  "google maps",
  "openstreetmap",
  "osm",
  "address",
  "location",
  "directions",
]);
