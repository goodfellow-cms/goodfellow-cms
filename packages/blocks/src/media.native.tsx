import { fileName, mediaKind } from "@goodfellow-cms/core";
import {
  Blocks,
  Columns,
  MediaPlayer,
  NativeImage,
  NativeLink,
  SiteButton,
  SiteText,
  TEXT,
  useNativeSite,
  useWide,
} from "@goodfellow-cms/expo";
import { useState } from "react";
import { Modal, Pressable, View } from "react-native";
import type { AudioProps, FileProps, GalleryProps, MediaTextProps } from "./media.js";
import { type DocumentProps, documentAddress } from "./media-data.js";

/** A link to a file, such as a PDF, which opens in the phone's browser or viewer, with an optional button. */
export function File({ file, label, button, buttonLabel }: FileProps) {
  const site = useNativeSite();
  if (!file) return null;
  // Files open from the site, whatever the app keeps.
  const address = site.address(file);
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12, marginVertical: 16 }}>
      <NativeLink href={address}>
        <SiteText style={{ textDecorationLine: "underline" }}>{label || fileName(file)}</SiteText>
      </NativeLink>
      {button ? <SiteButton label={buttonLabel || "Download"} href={address} size="sm" /> : null}
    </View>
  );
}

/** A PDF, which the phone's own viewer opens: apps' web views can't show one on Android. */
export function Document({ file, title, linkLabel }: DocumentProps) {
  const site = useNativeSite();
  const address = documentAddress(file);
  if (!address) return null;
  return (
    <View style={{ alignItems: "flex-start", gap: 8, marginVertical: 16 }}>
      {title ? <SiteText>{title}</SiteText> : null}
      <SiteButton label={linkLabel || "Open the document"} href={site.address(address)} size="sm" />
    </View>
  );
}

/** An uploaded sound file, with the phone's own player. */
export function Audio({ src, caption, loop }: AudioProps) {
  if (!src) return null;
  return (
    <View style={{ gap: 8, marginVertical: 16 }}>
      <MediaPlayer src={src} kind="audio" loop={loop} {...(caption && { title: caption })} />
      {caption ? (
        <SiteText muted style={{ fontSize: TEXT.sm }}>
          {caption}
        </SiteText>
      ) : null}
    </View>
  );
}

const SHARES = { third: [1, 2], half: [1, 1], "two-thirds": [2, 1] } as const;
const ALIGN = { top: "flex-start", center: "center", bottom: "flex-end" } as const;

/** A picture or video beside text and other blocks; on phones, the picture on top. */
export function MediaText({
  media,
  alt,
  position = "left",
  width = "half",
  align = "center",
  rounded,
  content,
}: MediaTextProps) {
  const wide = useWide("md");
  const { colors } = useNativeSite().theme;
  const shown = !media ? (
    <View style={{ aspectRatio: 16 / 9, backgroundColor: colors.muted }} />
  ) : mediaKind(media) === "video" ? (
    <MediaPlayer src={media} kind="video" {...(alt && { title: alt })} />
  ) : (
    <NativeImage src={media} alt={alt} aspect="landscape" rounded={rounded} />
  );
  const text = <Blocks items={content} />;
  const [mediaShare, textShare] = SHARES[width] ?? SHARES.half;
  const parts = position === "right" && wide ? [text, shown] : [shown, text];
  const widths = position === "right" && wide ? [textShare, mediaShare] : [mediaShare, textShare];
  return (
    <Columns columns={{ base: 1, md: 2 }} gap={wide ? 40 : 24} widths={widths} align={ALIGN[align]}>
      {parts}
    </Columns>
  );
}

const GALLERY_COLUMNS = { "2": { base: 2 }, "3": { base: 2, md: 3 }, "4": { base: 2, md: 4 } } as const;

/** Pictures in a grid, each with an optional caption. */
export function Gallery({
  images,
  columns = "3",
  crop,
  rounded,
  caption,
  lightbox,
  closeLabel = "Close",
  previousLabel = "Previous picture",
  nextLabel = "Next picture",
}: GalleryProps) {
  const [open, setOpen] = useState<number>();
  const shown = (images ?? []).filter((image) => image.src);
  if (shown.length === 0) return null;
  const current = open === undefined ? undefined : shown[open];
  const move = (by: number) => setOpen((index) => ((((index ?? 0) + by) % shown.length) + shown.length) % shown.length);
  return (
    <View style={{ gap: 12, marginVertical: 24 }}>
      <Columns columns={GALLERY_COLUMNS[columns] ?? GALLERY_COLUMNS["3"]} gap={16}>
        {shown.map((image, index) => {
          const picture = (
            <NativeImage src={image.src} alt={image.alt} aspect={crop ? "square" : "auto"} rounded={rounded} />
          );
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: the same picture can be shown twice
            <View key={`${image.src}-${index}`} style={{ gap: 4 }}>
              {lightbox === true ? (
                <Pressable accessibilityRole="imagebutton" onPress={() => setOpen(index)}>
                  {picture}
                </Pressable>
              ) : (
                picture
              )}
              {image.caption ? (
                <SiteText muted style={{ fontSize: TEXT.sm }}>
                  {image.caption}
                </SiteText>
              ) : null}
            </View>
          );
        })}
      </Columns>
      {lightbox === true && (
        <Modal
          visible={current !== undefined}
          transparent
          animationType="fade"
          onRequestClose={() => setOpen(undefined)}
        >
          <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.9)", justifyContent: "center", padding: 16, gap: 12 }}>
            {current ? (
              <>
                <NativeImage src={current.src} alt={current.alt} aspect="auto" rounded={false} />
                {current.caption ? (
                  <SiteText style={{ color: "#ffffff", textAlign: "center" }}>{current.caption}</SiteText>
                ) : null}
              </>
            ) : null}
            <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
              {shown.length > 1 ? (
                <Pressable accessibilityRole="button" accessibilityLabel={previousLabel} onPress={() => move(-1)}>
                  <SiteText style={{ color: "#ffffff", fontSize: TEXT["3xl"] }}>‹</SiteText>
                </Pressable>
              ) : (
                <View />
              )}
              <Pressable accessibilityRole="button" accessibilityLabel={closeLabel} onPress={() => setOpen(undefined)}>
                <SiteText style={{ color: "#ffffff", fontSize: TEXT["3xl"] }}>×</SiteText>
              </Pressable>
              {shown.length > 1 ? (
                <Pressable accessibilityRole="button" accessibilityLabel={nextLabel} onPress={() => move(1)}>
                  <SiteText style={{ color: "#ffffff", fontSize: TEXT["3xl"] }}>›</SiteText>
                </Pressable>
              ) : (
                <View />
              )}
            </View>
          </View>
        </Modal>
      )}
      {caption ? (
        <SiteText muted style={{ fontSize: TEXT.sm, textAlign: "center" }}>
          {caption}
        </SiteText>
      ) : null}
    </View>
  );
}
