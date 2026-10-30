import {
  CONSENT_ACCEPT_ATTRIBUTE,
  CONSENT_CODE_ATTRIBUTE,
  CONSENT_PLACEHOLDER_ATTRIBUTE,
  consentSource,
  disqusEmbedUrl,
  disqusShortname,
  garrulAddress,
  garrulEmbedUrl,
  garrulSlug,
  isDisqus,
  isGarrul,
} from "@goodfellow-cms/core";
import { classNameField, useParts, useSite, withKeywords, withParts } from "@goodfellow-cms/react";
import type { ComponentConfig } from "@puckeditor/core";
import type { ReactNode } from "react";
import { DisqusFrame, type DisqusPage } from "./disqus-frame";
import { GarrulFrame } from "./garrul-frame";
import { GiscusFrame } from "./giscus-frame";

export interface CommentsProps {
  heading: string;
  /**
   * Giscus's code from giscus.app, which names the repository and the
   * discussions' category, Disqus's code or shortname, or Garrul's code or
   * address, for comments kept
   * somewhere other than where Site Settings' Comments says; left empty, the
   * block shows those.
   */
  code: string;
  /** Giscus's reactions to the page. Disqus has its own setting, on Disqus. */
  reactions: boolean;
  /** Where Giscus's box for writing a comment is: above the comments or under them. */
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

/**
 * What `DisqusFrame` does, as a script of its own, for a site that asks
 * visitors first: held back in a template until they agree, then run where it
 * is by the consent script. `<` is escaped, so nothing in it can end it.
 */
export function disqusLoader({ script, identifier, url }: DisqusPage): string {
  const json = (value: unknown) => JSON.stringify(value).replace(/</g, "\\u003c");
  return `(function(){var w=window,c=function(){this.page.identifier=${identifier ? json(identifier) : "location.pathname"};this.page.url=${url ? json(url) : "location.href"}};if(w.DISQUS){w.DISQUS.reset({reload:true,config:c});return}w.disqus_config=c;var s=document.createElement("script");s.src=${json(script)};s.async=true;s.setAttribute("data-timestamp",String(Date.now()));document.head.appendChild(s)})();`;
}

/**
 * Names Garrul's thread by the browser's address, as `garrulSlug()` does,
 * where the block can't know the page (in a Next.js layout), for a site that
 * asks visitors first.
 */
export function garrulSlugScript(): string {
  return `(function(){var e=document.getElementById("garrul");if(e&&!e.dataset.slug)e.dataset.slug=location.pathname.replace(/[^a-zA-Z0-9_\\-./]/g,"-").slice(0,200)||"/"})();`;
}

/** The page's full address, where the site has a Site address. */
function pageUrl(siteUrl: string | undefined, path: string): string | undefined {
  if (!siteUrl) return undefined;
  return `${siteUrl.replace(/\/+$/, "")}${path === "/" ? "/" : path}`;
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
  const { settings, adminLink, path, pages, entry } = useSite();
  const pasted = code?.trim() ?? "";
  const giscus = giscusSettings(pasted);
  const disqus = giscus ? undefined : disqusShortname(pasted);
  const garrul = giscus || disqus ? undefined : garrulAddress(pasted);
  const kept = pasted ? undefined : settings.comments;
  const place = giscus ?? (disqus ? { disqus } : garrul ? { garrul } : kept);
  if (!place && !puck?.isEditing) return null;
  // Pages are built on the server: in the browser, it's the editor or a preview, which never load comments.
  const onSite = typeof document === "undefined" && !puck?.isEditing;
  const frameClass = part("gf-comments-frame", "w-full");
  const consent = settings.consent;
  /** Another site's script, held back until the visitor agrees, beside the placeholder that asks. */
  const held = (frame: string, script: string, from: string) => (
    <div
      // biome-ignore lint/security/noDangerouslySetInnerHtml: the service's script with escaped settings, held back until the visitor agrees
      dangerouslySetInnerHTML={{
        __html: `${frame}<template ${CONSENT_CODE_ATTRIBUTE}="body">${script}</template><div class="gf-consent-placeholder gf-consent-inline" ${CONSENT_PLACEHOLDER_ATTRIBUTE}=""><p>${escapeText((consent?.held ?? "").replaceAll("{site}", consentSource(from)))}</p><button type="button" ${CONSENT_ACCEPT_ATTRIBUTE}="content">${escapeText(consent?.show ?? "")}</button></div>`,
      }}
    />
  );
  let body: ReactNode;
  if (!place) {
    const link = pasted ? undefined : adminLink?.("comments-settings");
    const text = pasted
      ? "This isn't Giscus's, Disqus's or Garrul's code. On giscus.app, choose the repository and category, then copy the code at the end of the page; or paste Disqus's code or its site's shortname, or Garrul's code or its address."
      : "Set up comments in Site settings' Comments to show them here.";
    body = (
      <p className="rounded-lg bg-muted p-6 text-muted-foreground">
        {link ? (
          <a {...link} className="underline underline-offset-2 hover:text-foreground">
            {text}
          </a>
        ) : (
          text
        )}
      </p>
    );
  } else if (!onSite) {
    body = (
      <p className="rounded-lg bg-muted p-6 text-muted-foreground">
        {isDisqus(place)
          ? `Comments from Disqus, for its site ${place.disqus}, show here on the site.`
          : isGarrul(place)
            ? `Comments from Garrul, at ${place.garrul}, show here on the site.`
            : `Comments from ${place.repo}'s discussions show here on the site.`}
      </p>
    );
  } else if (isDisqus(place)) {
    const page: DisqusPage = {
      script: disqusEmbedUrl(place.disqus),
      identifier: path || undefined,
      url: path ? pageUrl(settings.url, path) : undefined,
    };
    body = consent ? (
      held(
        `<div id="disqus_thread" class="${escapeText(frameClass)}"></div>`,
        `<script>${disqusLoader(page)}</script>`,
        "https://disqus.com",
      )
    ) : (
      <DisqusFrame {...page} className={frameClass} />
    );
  } else if (isGarrul(place)) {
    const script = garrulEmbedUrl(place.garrul);
    const title =
      (entry?.content.fields.title as string | undefined) || pages?.find((page) => page.path === path)?.title;
    const url = path ? pageUrl(settings.url, path) : undefined;
    // In a Next.js layout, where the page isn't known, Garrul names the thread by the browser's address.
    const attributes: Record<string, string> = {
      "data-api": place.garrul,
      ...(path ? { "data-slug": garrulSlug(path) } : {}),
      ...(title ? { "data-title": title } : {}),
      ...(url ? { "data-url": url } : {}),
      "data-lang": (settings.language ?? "en").split("-")[0] ?? "en",
      ...(settings.theme?.darkMode ? {} : { "data-theme": "light" }),
    };
    if (!path) attributes["data-slug"] = "";
    if (consent) {
      const element = `<div id="garrul" class="${escapeText(frameClass)}"${Object.entries(attributes)
        .map(([name, value]) => ` ${name}="${escapeText(value)}"`)
        .join("")}></div>`;
      // Fills in the thread's name from the browser's address where the page isn't known, then loads Garrul.
      const name = path ? "" : `<script>${garrulSlugScript()}</script>`;
      body = held(element, `${name}<script src="${escapeText(script)}" async></script>`, place.garrul);
    } else {
      body = <GarrulFrame script={script} attributes={attributes} className={frameClass} />;
    }
  } else {
    const attributes: Record<string, string> = {
      "data-repo": place.repo,
      "data-repo-id": place.repoId,
      "data-category": place.category,
      "data-category-id": place.categoryId,
      "data-mapping": "pathname",
      "data-strict": "1",
      "data-reactions-enabled": reactions === false ? "0" : "1",
      "data-emit-metadata": "0",
      "data-input-position": input === "top" ? "top" : "bottom",
      "data-theme": settings.theme?.darkMode ? "preferred_color_scheme" : "light",
      "data-lang": (settings.language ?? "en").split("-")[0] ?? "en",
      "data-loading": "lazy",
    };
    if (consent) {
      // Held back in a template for the consent script, which runs it where it is once the visitor agrees.
      const script = `<script src="${GISCUS_SCRIPT}" crossorigin="anonymous" async${Object.entries(attributes)
        .map(([name, value]) => ` ${name}="${escapeText(value)}"`)
        .join("")}></script>`;
      body = held(`<div class="giscus ${escapeText(frameClass)}"></div>`, script, GISCUS_SCRIPT);
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
 * Comments on the page, kept as GitHub Discussions in a repository of their
 * own, through Giscus, where visitors sign in with GitHub to comment, by
 * Disqus, or by Garrul, which the site's owner runs on Cloudflare. Where they're kept is Site Settings' Comments (`content/site.json`'s
 * `comments`), unless the block is given Giscus's, Disqus's or Garrul's code
 * for somewhere else.
 * Either loads only on the built site, never in the editor or previews, and
 * on a site that asks visitors before loading other sites' content, it waits
 * until they agree.
 */
const Comments: ComponentConfig<CommentsProps> = withParts(
  {
    label: "Comments",
    fields: {
      heading: { type: "text", label: "Heading", contentEditable: true },
      code: {
        type: "textarea",
        label: "Giscus's, Disqus's or Garrul's code, for comments kept elsewhere than Site settings says (optional)",
      },
      reactions: {
        type: "radio",
        label: "Reactions to the page (Giscus)",
        options: [
          { value: true, label: "Shown" },
          { value: false, label: "Hidden" },
        ],
      },
      input: {
        type: "radio",
        label: "Box for writing a comment (Giscus)",
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

export default withKeywords(Comments, [
  "comments",
  "discussion",
  "giscus",
  "disqus",
  "garrul",
  "replies",
  "feedback",
  "github",
]);
