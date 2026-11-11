import { encode } from "uqr";

/** `text` as a QR code, drawn as squares, with the quiet border scanners need. */
export function QrCode({ text, label }: { text: string; label: string }) {
  const { data, size } = encode(text, { border: 4 });
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      width={size * 5}
      height={size * 5}
      shapeRendering="crispEdges"
      className="bg-white"
    >
      <rect width={size} height={size} fill="white" />
      {data.flatMap((row, y) =>
        row.map((dark, x) =>
          // biome-ignore lint/suspicious/noArrayIndexKey: a module's place in the grid is what it is.
          dark ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="black" /> : null,
        ),
      )}
    </svg>
  );
}
