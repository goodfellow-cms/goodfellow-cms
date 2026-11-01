/**
 * The site's own fonts in the admin panel's frames. Frames are sandboxed, so
 * their address is `null`, and browsers load fonts from another address only
 * where it allows them with headers a static host can't send: frames add each
 * font from its bytes instead, which the admin panel's page reads for them
 * (`media.bytes`), with the browser's `FontFace`. `themeToCss()` leaves their
 * `@font-face` rules out there (`fontFaces: false`).
 */
import type { CustomFont } from "@goodfellow-cms/core";

type ReadBytes = (url: string) => Promise<Uint8Array | undefined>;

// The faces each document has, by what they are, so each is added once and the ones the theme drops go.
const added = new WeakMap<Document, Map<string, FontFace | Loading>>();

/** A face still being read, which marks it as asked for. */
interface Loading {
  loading: true;
}

function faceKey(family: string, file: CustomFont["files"][number]): string {
  return [family, file.src, file.weight, file.weightTo ?? "", file.style ?? "normal"].join("|");
}

/**
 * Adds the site's own fonts to a document from their bytes, and takes away
 * those no longer among them. A file that can't be read or isn't a font is
 * left out, so text shows in the fallback fonts, as it would on the site.
 */
export function installCustomFonts(doc: Document, fonts: readonly CustomFont[], read: ReadBytes): void {
  const FontFaceClass = doc.defaultView?.FontFace;
  if (!FontFaceClass || !doc.fonts) return;
  let faces = added.get(doc);
  if (!faces) {
    faces = new Map();
    added.set(doc, faces);
  }
  const wanted = new Set<string>();
  for (const font of fonts) {
    for (const file of font.files) {
      const key = faceKey(font.family, file);
      wanted.add(key);
      if (faces.has(key)) continue;
      const placeholder: Loading = { loading: true };
      faces.set(key, placeholder);
      void read(file.src)
        .then(async (bytes) => {
          if (!bytes || faces?.get(key) !== placeholder) return;
          const face = new FontFaceClass(font.family, bytes.slice().buffer, {
            weight: file.weightTo ? `${file.weight} ${file.weightTo}` : String(file.weight),
            style: file.style ?? "normal",
            display: "swap",
          });
          await face.load();
          if (faces?.get(key) !== placeholder) return;
          faces.set(key, face);
          doc.fonts.add(face);
        })
        .catch(() => {
          // Not a font the browser can read: the fallback fonts show, as on the site.
        });
    }
  }
  for (const [key, face] of faces) {
    if (wanted.has(key)) continue;
    if (!("loading" in face)) doc.fonts.delete(face);
    faces.delete(key);
  }
}
