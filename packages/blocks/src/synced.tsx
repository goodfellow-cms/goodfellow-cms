import { SYNCED_BLOCK_PROP, type SyncedBlock as SyncedBlockData } from "@goodfellow-cms/core";
import { withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";

export interface SyncedBlockProps {
  /** The synced block it places, by its name, such as `mass-times`. */
  block: string;
}

/**
 * Places a synced block: blocks kept once, in `content/synced-blocks/`, that
 * every page placing it shows. Where pages are built, the synced block's own
 * blocks go in its place (`expandSyncedBlocks()`), so it renders nothing of
 * its own and has no Style: give the blocks inside the synced block theirs.
 * The admin panel's editor draws the synced block in its place, read-only,
 * with a link to edit it.
 */
export const SyncedBlock: ComponentConfig<SyncedBlockProps> = withParts(
  {
    label: "Synced block",
    // The synced block's name, which tools without the site's synced blocks, such as the Claude connector, write
    // as it is. The editor offers the site's synced blocks to choose from instead.
    fields: {
      [SYNCED_BLOCK_PROP]: { type: "text", label: "Synced block" },
    } as ComponentConfig<SyncedBlockProps>["fields"],
    defaultProps: { block: "" },
    resolveFields: (_data, { fields, metadata }) => {
      const synced = (metadata.syncedBlocks as SyncedBlockData[] | undefined) ?? [];
      return {
        ...fields,
        [SYNCED_BLOCK_PROP]: {
          type: "select",
          label: "Synced block",
          options: [
            { label: "Choose…", value: "" },
            ...synced.map((block) => ({ label: block.content.title, value: block.name })),
          ],
        },
      } as typeof fields;
    },
    render: () => <></>,
  },
  // Nothing of its own to name: the synced block's blocks have theirs.
  {},
);
