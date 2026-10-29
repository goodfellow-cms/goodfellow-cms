import { describe, expect, it } from "vitest";
import { embeddedPost } from "./embeds.js";

const DID = "did:plc:z72i7hdynmk6r22z27h6tvur";

function postOf(input: string, own?: string[]) {
  const found = embeddedPost(input, own);
  if (!("post" in found)) throw new Error(`no post in ${input}: ${found.problem}`);
  return found.post;
}

describe("embeddedPost", () => {
  it("reads Bluesky posts by DID, from their address, embed code or embed page", () => {
    const embed = `https://embed.bsky.app/embed/${DID}/app.bsky.feed.post/3l6oveex3ii2l`;
    for (const input of [
      `https://bsky.app/profile/${DID}/post/3l6oveex3ii2l`,
      `<blockquote class="bluesky-embed" data-bluesky-uri="at://${DID}/app.bsky.feed.post/3l6oveex3ii2l" data-bluesky-cid="bafy"><p lang="en">Hello</p></blockquote><script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script>`,
      `at://${DID}/app.bsky.feed.post/3l6oveex3ii2l`,
      embed,
    ]) {
      expect(postOf(input)).toEqual({
        site: "bluesky",
        url: embed,
        link: `https://bsky.app/profile/${DID}/post/3l6oveex3ii2l`,
        height: 400,
      });
    }
  });

  it("says when a Bluesky post names its author by handle, which needs resolving first", () => {
    expect(embeddedPost("https://bsky.app/profile/Example.bsky.social/post/3kabc")).toEqual({
      problem: "handle",
      bluesky: { handle: "example.bsky.social", post: "3kabc" },
      link: "https://bsky.app/profile/Example.bsky.social/post/3kabc",
    });
  });

  it("reads Mastodon posts on any server", () => {
    for (const input of [
      "https://mastodon.social/@Gargron/111111111111111111",
      "https://mastodon.social/users/Gargron/statuses/111111111111111111",
      `<iframe src="https://mastodon.social/@Gargron/111111111111111111/embed" class="mastodon-embed"></iframe>`,
      `<blockquote class="mastodon-embed" data-embed-url="https://mastodon.social/@Gargron/111111111111111111/embed" style="background: #FCF8FF;"> <a href="https://mastodon.social/@Gargron/111111111111111111" target="_blank">Post by @Gargron</a></blockquote> <script data-allowed-prefixes="https://mastodon.social/" async src="https://mastodon.social/embed.js"></script>`,
    ]) {
      expect(postOf(input)).toMatchObject({
        site: "mastodon",
        url: "https://mastodon.social/@Gargron/111111111111111111/embed",
        link: "https://mastodon.social/@Gargron/111111111111111111",
      });
    }
  });

  it("reads Instagram posts and reels, and their embed code", () => {
    expect(postOf("https://www.instagram.com/p/C1a2B3c4D5e/?utm_source=ig_web_copy_link")).toMatchObject({
      site: "instagram",
      url: "https://www.instagram.com/p/C1a2B3c4D5e/embed/captioned/",
    });
    expect(postOf("https://www.instagram.com/someone/reel/C1a2B3c4D5e/").url).toBe(
      "https://www.instagram.com/reel/C1a2B3c4D5e/embed/captioned/",
    );
    expect(
      postOf(
        `<blockquote class="instagram-media" data-instgrm-captioned data-instgrm-permalink="https://www.instagram.com/p/C1a2B3c4D5e/?utm_source=ig_embed&amp;utm_campaign=loading" data-instgrm-version="14"></blockquote>`,
      ).link,
    ).toBe("https://www.instagram.com/p/C1a2B3c4D5e/");
  });

  it("reads X's posts, from either address and from its embed code", () => {
    const url = "https://platform.twitter.com/embed/Tweet.html?id=1460323737035677698&dnt=true";
    expect(postOf("https://x.com/jack/status/1460323737035677698?s=20").url).toBe(url);
    expect(postOf("https://twitter.com/jack/status/1460323737035677698").link).toBe(
      "https://x.com/jack/status/1460323737035677698",
    );
    expect(
      postOf(
        `<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Hello <a href="https://t.co/abc">https://t.co/abc</a></p>&mdash; jack (@jack) <a href="https://twitter.com/jack/status/1460323737035677698?ref_src=twsrc%5Etfw">November 15, 2021</a></blockquote> <script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>`,
      ).url,
    ).toBe(url);
  });

  it("reads Spotify's tracks, albums, playlists and episodes, sized as Spotify's player is", () => {
    expect(postOf("https://open.spotify.com/intl-es/track/4uLU6hMCjMI75M1A2tKUQC?si=abc")).toEqual({
      site: "spotify",
      url: "https://open.spotify.com/embed/track/4uLU6hMCjMI75M1A2tKUQC",
      link: "https://open.spotify.com/track/4uLU6hMCjMI75M1A2tKUQC",
      height: 152,
    });
    expect(postOf("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").height).toBe(352);
    expect(
      postOf(
        `<iframe style="border-radius:12px" src="https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3?utm_source=generator" width="100%" height="352"></iframe>`,
      ).url,
    ).toBe("https://open.spotify.com/embed/album/1DFixLWuPkv3KT3TnV35m3");
  });

  it("reads SoundCloud's tracks and sets, and its player's embed code", () => {
    const track = postOf("https://soundcloud.com/forss/flickermood?si=abc");
    expect(track).toMatchObject({ site: "soundcloud", link: "https://soundcloud.com/forss/flickermood", height: 166 });
    expect(new URL(track.url).searchParams.get("url")).toBe("https://soundcloud.com/forss/flickermood");
    expect(postOf("https://soundcloud.com/forss/sets/soulhack").height).toBe(450);
    expect(
      postOf(
        `<iframe width="100%" height="166" scrolling="no" frameborder="no" allow="autoplay" src="https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/293&color=%23ff5500"></iframe>`,
      ).link,
    ).toBe("https://api.soundcloud.com/tracks/293");
  });

  it("explains what it can't show", () => {
    expect(embeddedPost("")).toEqual({ problem: "not-an-address" });
    expect(embeddedPost("hello there")).toEqual({ problem: "not-an-address" });
    expect(embeddedPost("https://example.org/a-page")).toEqual({ problem: "unknown-site" });
    expect(embeddedPost("https://spotify.link/abc123")).toEqual({ problem: "short-link" });
    expect(embeddedPost("https://on.soundcloud.com/abc123")).toEqual({ problem: "short-link" });
    expect(embeddedPost("javascript:alert(1)")).toEqual({ problem: "not-an-address" });
  });

  it("never shows a post on the site's own address, the admin panel's, or this computer", () => {
    expect(embeddedPost("https://parish.example/@someone/123456", ["parish.example"])).toEqual({
      problem: "same-site",
    });
    expect(embeddedPost("http://localhost:4321/@someone/123456")).toEqual({ problem: "same-site" });
    expect(embeddedPost("https://127.0.0.1/users/someone/statuses/1")).toEqual({ problem: "same-site" });
  });
});
