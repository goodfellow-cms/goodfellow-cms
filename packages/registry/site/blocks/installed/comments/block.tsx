import {
  CONSENT_ACCEPT_ATTRIBUTE,
  CONSENT_CODE_ATTRIBUTE,
  CONSENT_PLACEHOLDER_ATTRIBUTE,
  consentSource,
} from "@goodfellow-cms/core";
import { classNameField, useParts, useSite, withKeywords, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import type { ReactNode } from "react";
import { GiscusFrame } from "./giscus-frame";

export interface CommentsProps {
  heading: string;
  /** Giscus's code from giscus.app, which names the repository and the discussions' category. */
  code: string;
  reactions: boolean;
  /** Where the box for writing a comment is: above the comments or under them. */
  input: "top" | "bottom";
  className: string;
}

/** Giscus's script, from its own address, which loads its comments in a frame. */
export const GISCUS_SCRIPT = "https://giscus.app/client.js";

/** What Giscus needs to know where a site's discussions are. */
export interface GiscusSettings {
  repo: string;
  repoId: string;
  category: string;
  categoryId: string;
}

/** The repository and category named in Giscus's code, if it names them as Giscus writes them. */
export function giscusSettings(code: string): GiscusSettings | undefined {
  const attribute = (name: string) =>
    new RegExp(`\\sdata-${name}\\s*=\\s*["']([^"'<>]*)["']`, "i").exec(code)?.[1]?.replaceAll("&amp;", "&").trim();
  const repo = attribute("repo");
  const repoId = attribute("repo-id");
  const category = attribute("category");
  const categoryId = attribute("category-id");
  if (!repo || !/^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) return undefined;
  if (!repoId || !/^[A-Za-z0-9_-]+$/.test(repoId)) return undefined;
  if (!categoryId || !/^[A-Za-z0-9_-]+$/.test(categoryId)) return undefined;
  return { repo, repoId, category: category ?? "", categoryId };
}

const escapeText = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

function CommentsView({
  heading,
  code,
  reactions,
  input,
  className,
  puck,
}: CommentsProps & { puck?: { isEditing?: boolean } }) {
  const part = useParts();
  const { settings } = useSite();
  const giscus = giscusSettings(code ?? "");
  if (!giscus && !puck?.isEditing) return null;
  // Pages are built on the server: in the browser, it's the editor or a preview, which never load Giscus.
  const onSite = typeof document === "undefined" && !puck?.isEditing;
  const frameClass = part("gf-comments-frame", "w-full");
  let body: ReactNode;
  if (!giscus) {
    body = (
      <p className="rounded-lg bg-muted p-6 text-muted-foreground">
        {code?.trim()
          ? "This isn't Giscus's code. On giscus.app, choose the repository and category, then copy the code at the end of the page."
          : "Paste Giscus's code from giscus.app to show comments."}
      </p>
    );
  } else if (!onSite) {
    body = (
      <p className="rounded-lg bg-muted p-6 text-muted-foreground">
        Comments from {giscus.repo}'s discussions show here on the site.
      </p>
    );
  } else {
    const attributes: Record<string, string> = {
      "data-repo": giscus.repo,
      "data-repo-id": giscus.repoId,
      "data-category": giscus.category,
      "data-category-id": giscus.categoryId,
      "data-mapping": "pathname",
      "data-strict": "1",
      "data-reactions-enabled": reactions === false ? "0" : "1",
      "data-emit-metadata": "0",
      "data-input-position": input === "top" ? "top" : "bottom",
      "data-theme": settings.theme?.darkMode ? "preferred_color_scheme" : "light",
      "data-lang": (settings.language ?? "en").split("-")[0] ?? "en",
      "data-loading": "lazy",
    };
    const consent = settings.consent;
    if (consent) {
      // Held back in a template for the consent script, which runs it where it is once the visitor agrees.
      const script = `<script src="${GISCUS_SCRIPT}" crossorigin="anonymous" async${Object.entries(attributes)
        .map(([name, value]) => ` ${name}="${escapeText(value)}"`)
        .join("")}></script>`;
      const words = consent.held.replaceAll("{site}", consentSource(GISCUS_SCRIPT));
      body = (
        <div
          // biome-ignore lint/security/noDangerouslySetInnerHtml: Giscus's script with escaped settings, held back until the visitor agrees
          dangerouslySetInnerHTML={{
            __html: `<div class="giscus ${escapeText(frameClass)}"></div><template ${CONSENT_CODE_ATTRIBUTE}="body">${script}</template><div class="gf-consent-placeholder gf-consent-inline" ${CONSENT_PLACEHOLDER_ATTRIBUTE}=""><p>${escapeText(words)}</p><button type="button" ${CONSENT_ACCEPT_ATTRIBUTE}="content">${escapeText(consent.show)}</button></div>`,
          }}
        />
      );
    } else {
      body = <GiscusFrame script={GISCUS_SCRIPT} attributes={attributes} className={frameClass} />;
    }
  }
  return (
    <section className={part("gf-comments", "w-full", className)}>
      {heading && (
        <h2 className={part("gf-comments-heading", "mb-6 font-heading text-2xl font-semibold")}>{heading}</h2>
      )}
      {body}
    </section>
  );
}

/**
 * Comments on the page, kept as GitHub Discussions in a repository of the
 * site's choosing, through Giscus: visitors sign in with GitHub to comment.
 * Giscus loads only on the built site, never in the editor or previews, and
 * on a site that asks visitors before loading other sites' content, it waits
 * until they agree.
 */
const Comments: ComponentConfig<CommentsProps> = withParts(
  {
    label: "Comments",
    fields: {
      heading: { type: "text", label: "Heading", contentEditable: true },
      code: { type: "textarea", label: "Giscus's code, from giscus.app" },
      reactions: {
        type: "radio",
        label: "Reactions to the page",
        options: [
          { value: true, label: "Shown" },
          { value: false, label: "Hidden" },
        ],
      },
      input: {
        type: "radio",
        label: "Box for writing a comment",
        options: [
          { value: "bottom", label: "Under the comments" },
          { value: "top", label: "Above the comments" },
        ],
      },
      className: classNameField,
    },
    defaultProps: { heading: "Comments", code: "", reactions: true, input: "bottom", className: "" },
    render: (props) => <CommentsView {...props} />,
  },
  {
    "gf-comments": "Comments",
    "gf-comments-heading": "Heading",
    "gf-comments-frame": "Comments' frame",
  },
);

export default withKeywords(Comments, ["comments", "discussion", "giscus", "replies", "feedback", "github"]);
