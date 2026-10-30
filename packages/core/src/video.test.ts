import { describe, expect, it } from "vitest";
import { embedPlayerUrl, parseStartTime, vimeoPlayerUrl, vimeoVideo, youtubePlayerUrl, youtubeVideo } from "./video.js";

describe("YouTube", () => {
  it("reads a video's ID and any of its addresses", () => {
    const id = "dQw4w9WgXcQ";
    for (const input of [
      id,
      ` ${id} `,
      `https://www.youtube.com/watch?v=${id}`,
      `https://youtube.com/watch?feature=share&v=${id}`,
      `youtube.com/watch?v=${id}`,
      `https://m.youtube.com/watch?v=${id}`,
      `https://music.youtube.com/watch?v=${id}&list=RD`,
      `https://youtu.be/${id}`,
      `https://youtu.be/${id}?si=abc`,
      `https://www.youtube.com/shorts/${id}`,
      `https://www.youtube.com/live/${id}?feature=shared`,
      `https://www.youtube.com/embed/${id}`,
      `https://www.youtube-nocookie.com/embed/${id}`,
      `<iframe width="560" height="315" src="https://www.youtube.com/embed/${id}?si=x&amp;start=5" title="YouTube video player"></iframe>`,
    ]) {
      expect(youtubeVideo(input)?.id, input).toBe(id);
    }
  });

  it("keeps where a video starts", () => {
    expect(youtubeVideo("https://youtu.be/dQw4w9WgXcQ?t=90")).toEqual({ id: "dQw4w9WgXcQ", start: 90 });
    expect(youtubeVideo("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s")?.start).toBe(90);
    expect(parseStartTime("1h2m3s")).toBe(3723);
    expect(parseStartTime("45s")).toBe(45);
    expect(parseStartTime("soon")).toBeUndefined();
  });

  it("isn't fooled by other addresses", () => {
    for (const input of [
      "",
      "dQw4w9WgXc",
      "https://example.org/watch?v=dQw4w9WgXcQ",
      "https://youtube.com.example.org/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw",
      "https://www.youtube.com/watch?v=<script>",
    ]) {
      expect(youtubeVideo(input), input).toBeUndefined();
    }
  });

  it("plays it in the privacy-enhanced player", () => {
    expect(youtubePlayerUrl({ id: "dQw4w9WgXcQ", start: 90 })).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&start=90",
    );
    // Autoplay needs the sound off, and looping a playlist of one.
    expect(youtubePlayerUrl({ id: "dQw4w9WgXcQ" }, { autoplay: true, loop: true })).toBe(
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1&mute=1&loop=1&playlist=dQw4w9WgXcQ",
    );
  });
});

describe("Vimeo", () => {
  it("reads a video's number and any of its addresses", () => {
    for (const input of [
      "76979871",
      "https://vimeo.com/76979871",
      "vimeo.com/76979871",
      "https://vimeo.com/channels/staffpicks/76979871",
      "https://vimeo.com/groups/shortfilms/videos/76979871",
      "https://vimeo.com/showcase/12345/video/76979871",
      "https://player.vimeo.com/video/76979871?badge=0",
      '<iframe src="https://player.vimeo.com/video/76979871?h=abc123def&amp;dnt=1" allow="fullscreen"></iframe>',
    ]) {
      expect(vimeoVideo(input)?.id, input).toBe("76979871");
    }
    expect(vimeoVideo("https://example.org/76979871")).toBeUndefined();
    expect(vimeoVideo("https://vimeo.com/about")).toBeUndefined();
  });

  it("keeps an unlisted video's hash and where it starts", () => {
    expect(vimeoVideo("https://vimeo.com/76979871/abc123def")).toEqual({ id: "76979871", hash: "abc123def" });
    expect(vimeoVideo("https://player.vimeo.com/video/76979871?h=abc123def#t=1m5s")).toEqual({
      id: "76979871",
      hash: "abc123def",
      start: 65,
    });
    expect(vimeoPlayerUrl({ id: "76979871", hash: "abc123def", start: 65 }, { autoplay: true })).toBe(
      "https://player.vimeo.com/video/76979871?h=abc123def&dnt=1&autoplay=1&muted=1#t=65s",
    );
  });
});

describe("other sites' players", () => {
  it("shows an embed address, or the one in an embed code", () => {
    expect(embedPlayerUrl("https://fast.wistia.net/embed/iframe/abc123")).toEqual({
      url: "https://fast.wistia.net/embed/iframe/abc123",
    });
    expect(
      embedPlayerUrl('<iframe src="https://www.loom.com/embed/abc?sid=1&amp;t=2" frameborder="0"></iframe>'),
    ).toEqual({
      url: "https://www.loom.com/embed/abc?sid=1&t=2",
    });
  });

  it("only shows secure addresses on other sites", () => {
    expect(embedPlayerUrl("http://player.example.org/1")).toEqual({ problem: "not-secure" });
    expect(embedPlayerUrl("javascript:alert(1)")).toEqual({ problem: "not-an-address" });
    expect(embedPlayerUrl("/media/video.mp4")).toEqual({ problem: "not-an-address" });
    expect(embedPlayerUrl("https://localhost:4321/admin")).toEqual({ problem: "same-site" });
    expect(embedPlayerUrl("https://127.0.0.1/")).toEqual({ problem: "same-site" });
    expect(embedPlayerUrl("https://localhost./")).toEqual({ problem: "same-site" });
    expect(embedPlayerUrl("https://admin.localhost/")).toEqual({ problem: "same-site" });
    expect(embedPlayerUrl("https://[::ffff:127.0.0.1]/")).toEqual({ problem: "same-site" });
    expect(embedPlayerUrl("https://parish.example.org/admin", ["parish.example.org"])).toEqual({
      problem: "same-site",
    });
  });
});
