// Written by the admin panel when blocks are installed or removed. Don't edit it by hand.
import type { ComponentConfig, Config } from "@puckeditor/core";

// biome-ignore lint/suspicious/noExplicitAny: blocks have arbitrary props
export const installedBlocks: Record<string, ComponentConfig<any>> = {};

export const installedCategories: NonNullable<Config["categories"]> = {};
