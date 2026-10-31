import { getPageHead, type PageFile } from "@goodfellow-cms/core";
import { createUsePuck } from "@puckeditor/core";
import { useAdmin, useSiteContent } from "./admin-context.js";
import { useStrings } from "./strings.js";

const usePuck = createUsePuck();

/**
 * How the page looks when a link to it is shared, such as in a message or on
 * social media: its title, description and image as link previews show them,
 * from the page's settings or else Site Settings', updated as they're edited,
 * with the picture large over the title or small beside it, as its settings say.
 */
export function SharePreview({ path }: { path: string }) {
  const t = useStrings();
  const { mediaPreviews } = useAdmin();
  const { content } = useSiteContent();
  const root = usePuck((state) => state.appState.data.root);
  const page = { path, file: "", content: { version: 1, data: { root, content: [] } } as PageFile };
  const head = getPageHead(content.settings, page);
  const { url } = content.settings;
  const host = url ? new URL(url).hostname : undefined;
  const image = head.socialImage ? mediaPreviews.resolve(head.socialImage) : undefined;

  return (
    <section className="gfa-share-preview" aria-labelledby="gfa-share-preview-title">
      <h3 id="gfa-share-preview-title" className="gfa-label">
        {t("sharePreview.title")}
      </h3>
      <div className={head.card === "summary" ? "gfa-share-card gfa-share-card-small" : "gfa-share-card"}>
        {image ? (
          <img src={image} alt="" className="gfa-share-image" />
        ) : (
          <div className="gfa-share-image gfa-share-no-image">{t("sharePreview.noImage")}</div>
        )}
        <div className="gfa-share-text">
          {host && <span className="gfa-share-host">{host}</span>}
          <strong>{head.title}</strong>
          {head.description && <span className="gfa-share-description">{head.description}</span>}
        </div>
      </div>
      {!url && <p className="gfa-hint">{t("sharePreview.noAddress")}</p>}
      {head.noIndex && <p className="gfa-hint">{t("sharePreview.hidden")}</p>}
    </section>
  );
}
