import { embeddedPost } from "@goodfellow-cms/core";
import { ConsentFrame, classNameField, cx, SiteLink, useParts, useSite, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig, Fields } from "@puckeditor/core";
import {
  blueskyDid,
  type EmbedProps,
  embedHeight,
  embedProblems,
  embedTitle,
  isPlayer,
  shownPost,
} from "./embed-data.js";
import { EMBED_PARTS } from "./parts.js";

export type { EmbedProps } from "./embed-data.js";

/** What the sites' embeds may do: play, go full screen, and open links in a new tab. */
const ALLOW = "autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture";

/**
 * The same as other sites' video players get: their own scripts and storage,
 * which can't reach this site's, since they're never on its address.
 */
const SANDBOX = "allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox";

function Notice({ text, className }: { text: string; className: string }) {
  return (
    <p className={cx("rounded-md border border-dashed border-border p-4 text-muted-foreground", className)}>{text}</p>
  );
}

function EmbedView({ isEditing, ...props }: EmbedProps & { isEditing: boolean }) {
  const { settings } = useSite();
  const part = useParts();
  const { caption, className } = props;
  const found = shownPost(props, settings.url, typeof window === "undefined" ? undefined : window.location.hostname);

  if ("problem" in found) {
    if (isEditing) return <Notice text={embedProblems[found.problem]} className={className} />;
    // A Bluesky post that couldn't be looked up is still linked.
    if (!found.link) return null;
    return (
      <p className={part("gf-embed", undefined, className)}>
        <SiteLink href={found.link} className={part("gf-embed-link", "text-primary underline")}>
          {caption || "See the post on Bluesky"}
        </SiteLink>
      </p>
    );
  }

  const { post } = found;
  const height = embedHeight(props, post);
  return (
    <figure className={part("gf-embed", cx("w-full", !isPlayer(post) && "mx-auto max-w-xl"), className)}>
      <div className={part("gf-embed-frame", "relative w-full overflow-hidden rounded-lg")} style={{ height }}>
        <ConsentFrame
          className="absolute inset-0 h-full w-full border-0"
          src={post.url}
          title={embedTitle(props, post)}
          loading="lazy"
          allow={ALLOW}
          allowFullScreen
          referrerPolicy="strict-origin-when-cross-origin"
          sandbox={SANDBOX}
        />
      </div>
      {caption && (
        <figcaption className={part("gf-embed-caption", "mt-2 text-sm text-muted-foreground")}>{caption}</figcaption>
      )}
    </figure>
  );
}

const embedFields: Fields<EmbedProps> = {
  post: {
    type: "textarea",
    label:
      "The post's address, or the embed code its site gives (Bluesky, Mastodon, Instagram, X, Spotify, SoundCloud)",
  },
  title: { type: "text", label: "What the post is, for screen readers" },
  height: { type: "number", label: "Height in pixels (leave at 0 for the usual height)", min: 0, max: 2000 },
  caption: { type: "text", label: "Caption" },
  className: classNameField,
};

/** A post or player from a social site, held back until visitors agree where the site asks them. */
export const Embed: ComponentConfig<EmbedProps> = withParts(
  {
    label: "Social post",
    fields: embedFields,
    defaultProps: { post: "", title: "", height: 0, caption: "", className: "" },
    // Bluesky's embed needs its author's DID, which only Bluesky knows: it's looked up where pages are built,
    // never in the editor, which can't ask other sites anything.
    resolveData: async ({ props }) => {
      const { blueskyDid: _, ...rest } = props;
      if (typeof document !== "undefined") return { props: rest };
      const found = embeddedPost(props.post);
      if (!("problem" in found) || found.problem !== "handle") return { props: rest };
      const did = await blueskyDid(found.bluesky.handle);
      return { props: did ? { ...rest, blueskyDid: did } : rest };
    },
    render: ({ puck, ...props }) => <EmbedView {...props} isEditing={puck.isEditing} />,
  },
  EMBED_PARTS,
);
