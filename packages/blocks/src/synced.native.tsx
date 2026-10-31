import type { SyncedBlockProps } from "./synced.js";

/**
 * Draws nothing: the content API's pages already have each synced block's
 * own blocks in its place (`expandSyncedBlocks()`), so apps never see one.
 */
export function SyncedBlock(_props: SyncedBlockProps) {
  return null;
}
