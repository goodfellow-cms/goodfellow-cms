/**
 * Synced blocks on the editor's canvas: a placed Synced block draws the
 * synced block's own blocks in its place, read-only, with a link to edit it,
 * since they're kept once for every page that places them. Builds put them
 * in place before rendering (`expandSyncedBlocks()`); the editor keeps the
 * placement, which is what the page saves.
 */
import {
  findSyncedBlock,
  type SiteContent,
  SYNCED_BLOCK,
  SYNCED_BLOCK_PROP,
  syncedBlockIn,
} from "@goodfellow-cms/core";
import { type Config, type Data, Render, registerOverlayPortal } from "@puckeditor/core";
import { syncedBlockEditorHref } from "../router.js";
import { useStrings } from "../strings.js";

interface Drawing {
  content: Pick<SiteContent, "syncedBlocks">;
  /** The language what's edited is in, whose own version of a synced block is shown where it has one. */
  language: string | undefined;
  /** Whether the language is the site's main one, whose synced blocks are edited without naming it. */
  main: boolean;
  metadata: Record<string, unknown>;
  navigate: (href: string) => void;
}

function SyncedBlockDrawing({ name, config, drawing }: { name: string; config: Config; drawing: Drawing }) {
  const t = useStrings();
  const block = name ? findSyncedBlock(drawing.content, name) : undefined;
  if (!block) {
    return (
      <div className="gfa-synced-block gfa-synced-block-missing">
        <p>{name ? t("synced.missing", { name }) : t("synced.choose")}</p>
      </div>
    );
  }
  const shown = syncedBlockIn(block, drawing.language);
  const href = syncedBlockEditorHref(block.name, drawing.main ? undefined : drawing.language);
  const data: Data = { root: { props: {} }, content: shown.data.content as Data["content"] };
  return (
    <div className="gfa-synced-block" data-gf-synced-block={block.name}>
      <div className="gfa-synced-block-bar">
        <span>{t("synced.label", { title: shown.title })}</span>
        <a
          href={href}
          ref={(element) => registerOverlayPortal(element, { disableDrag: true })}
          onClick={(event) => {
            event.preventDefault();
            drawing.navigate(href);
          }}
        >
          {t("synced.edit")}
        </a>
      </div>
      <div inert>
        <Render config={config} data={data} metadata={drawing.metadata} />
      </div>
    </div>
  );
}

/**
 * The config with its Synced block drawing the synced block it places, from
 * the blocks of the same config, whose own Synced block draws nothing, since
 * a synced block can't place another.
 */
export function withSyncedBlockDrawing(config: Config, drawing: Drawing): Config {
  const component = config.components[SYNCED_BLOCK];
  if (!component) return config;
  return {
    ...config,
    components: {
      ...config.components,
      [SYNCED_BLOCK]: {
        ...component,
        render: (props: Record<string, unknown>) => (
          <SyncedBlockDrawing
            name={typeof props[SYNCED_BLOCK_PROP] === "string" ? (props[SYNCED_BLOCK_PROP] as string) : ""}
            config={config}
            drawing={drawing}
          />
        ),
      },
    },
  } as Config;
}
