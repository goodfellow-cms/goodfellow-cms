// The part of expo-file-system's API (SDK 54 and later) the file storage uses, so the package builds without
// installing Expo. Apps install expo-file-system themselves, whose own types are the real ones.
declare module "expo-file-system" {
  type PathPart = string | File | Directory;
  export class File {
    constructor(...parts: PathPart[]);
    readonly uri: string;
    readonly exists: boolean;
    readonly parentDirectory: Directory;
    text(): Promise<string>;
    write(content: string): void;
    delete(): void;
    static downloadFileAsync(
      url: string,
      destination: File | Directory,
      options?: { idempotent?: boolean },
    ): Promise<File>;
  }
  export class Directory {
    constructor(...parts: PathPart[]);
    readonly uri: string;
    readonly exists: boolean;
    create(options?: { intermediates?: boolean; idempotent?: boolean }): void;
    list(): Array<File | Directory>;
  }
  export const Paths: { readonly document: Directory; readonly cache: Directory };
}
