import { NativeLink, SiteText, TEXT, useNativeSite, WebFrame } from "@goodfellow-cms/expo";
import { View } from "react-native";
import { type EmbedProps, embedHeight, embedTitle, isPlayer, shownPost } from "./embed-data.js";

/** A post or player from a social site, in a web view; a Bluesky post that couldn't be looked up, as a link. */
export function Embed(props: EmbedProps) {
  const site = useNativeSite();
  const found = shownPost(props, site.settings.url);
  if ("problem" in found) {
    return found.link ? (
      <NativeLink href={found.link}>
        <SiteText style={{ textDecorationLine: "underline" }}>{props.caption || "See the post on Bluesky"}</SiteText>
      </NativeLink>
    ) : null;
  }
  const { post } = found;
  return (
    <View style={{ gap: 8, width: "100%", ...(!isPlayer(post) && { maxWidth: 576, alignSelf: "center" }) }}>
      <WebFrame uri={post.url} title={embedTitle(props, post)} height={embedHeight(props, post)} />
      {props.caption ? (
        <SiteText muted style={{ fontSize: TEXT.sm }}>
          {props.caption}
        </SiteText>
      ) : null}
    </View>
  );
}
