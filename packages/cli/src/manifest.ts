/** A file in Vite's build manifest. */
export interface ManifestChunk {
  file: string;
  name?: string;
  src?: string;
  isEntry?: boolean;
  css?: string[];
  imports?: string[];
}

export type Manifest = Record<string, ManifestChunk>;

/** Finds a build input in Vite's manifest by the name it was given in `input`. */
export function findEntry(manifest: Manifest, name: string): ManifestChunk | undefined {
  return Object.values(manifest).find((chunk) => chunk.isEntry && chunk.name === name);
}

/** The CSS files a build input produced: the file itself for CSS inputs, or the CSS its JavaScript imports. */
export function cssFiles(manifest: Manifest, name: string): string[] {
  const entry = findEntry(manifest, name);
  if (!entry) return [];
  return entry.file.endsWith(".css") ? [entry.file] : (entry.css ?? []);
}
