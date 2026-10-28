import { MediaPlayer, SiteText, TEXT, useNativeSite, WebFrame } from "@goodfellow-cms/expo";
import type { ReactNode } from "react";
import { View } from "react-native";
import { playerAddress, type VideoProps } from "./video-data.js";

const SHAPES = { auto: 16 / 9, wide: 16 / 9, landscape: 4 / 3, square: 1, tall: 9 / 16 } as const;

/** An uploaded video with the phone's player, or YouTube's, Vimeo's or another site's player. */
export function Video(props: VideoProps) {
  const site = useNativeSite();
  const { source, shape, caption, title } = props;
  const aspect = SHAPES[shape] ?? SHAPES.wide;
  let player: ReactNode;
  if (source === "upload") {
    if (!props.file) return null;
    player = (
      <MediaPlayer
        src={props.file}
        kind="video"
        aspect={aspect}
        loop={props.loop}
        autoplay={props.autoplay}
        muted={props.muted}
        language={site.settings.language}
        {...(title && { title })}
        {...(props.poster && { poster: props.poster })}
        {...(props.captions && { captions: props.captions })}
      />
    );
  } else {
    const address = playerAddress(props, site.settings.url);
    if ("problem" in address) return null;
    player = <WebFrame uri={address.url} title={title || "Video"} aspect={aspect} />;
  }
  return (
    <View style={{ gap: 8, ...(shape === "tall" && { maxWidth: 384, width: "100%", alignSelf: "center" }) }}>
      {player}
      {caption ? (
        <SiteText muted style={{ fontSize: TEXT.sm }}>
          {caption}
        </SiteText>
      ) : null}
    </View>
  );
}
