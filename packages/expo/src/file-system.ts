/**
 * The app's copy of the site in its own files, with expo-file-system, so it's
 * there when the app opens offline. Kept in the app's documents, which the
 * phone doesn't clear the way it clears caches.
 */
import { Directory, File, Paths } from "expo-file-system";
import type { ContentStorage } from "./sync.js";

function parts(name: string): string[] {
  return name.split("/").filter((part) => part && part !== "." && part !== "..");
}

/** Every file in a folder and those within it, by name from `root`. */
function listed(folder: Directory, prefix: string): string[] {
  if (!folder.exists) return [];
  return folder.list().flatMap((item) => {
    const name = `${prefix}${decodeURIComponent(item.uri.replace(/\/$/, "").split("/").pop() ?? "")}`;
    return item instanceof Directory ? listed(item, `${name}/`) : [name];
  });
}

/** Keeps the site's copy in a folder of the app's documents, `goodfellow` unless given. */
export function fileStorage(folder = "goodfellow"): ContentStorage {
  const root = new Directory(Paths.document, folder);
  const fileAt = (name: string) => new File(root, ...parts(name));
  const ready = (file: File) => {
    const parent = file.parentDirectory;
    if (!parent.exists) parent.create({ intermediates: true, idempotent: true });
    return file;
  };
  return {
    read: async (name) => {
      const file = fileAt(name);
      return file.exists ? file.text() : undefined;
    },
    write: async (name, text) => {
      ready(fileAt(name)).write(text);
    },
    remove: async (name) => {
      const file = fileAt(name);
      if (file.exists) file.delete();
    },
    list: async () => listed(root, ""),
    download: async (url, name) => {
      const file = ready(fileAt(name));
      if (file.exists) file.delete();
      return (await File.downloadFileAsync(url, file, { idempotent: true })).uri;
    },
    fileUri: async (name) => {
      const file = fileAt(name);
      return file.exists ? file.uri : undefined;
    },
  };
}
