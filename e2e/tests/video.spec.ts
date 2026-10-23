import { canvas, editor, expect, test, writeSiteFile } from "./helpers.js";

function videosPage() {
  const video = (id: string, props: Record<string, unknown>) => ({
    type: "Video",
    props: { id, shape: "auto", rounded: true, title: "", caption: "", ...props },
  });
  return `${JSON.stringify(
    {
      version: 1,
      data: {
        root: { props: { title: "Videos" } },
        content: [
          video("Video-youtube", { source: "youtube", youtube: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m" }),
          video("Video-upload", { source: "upload", file: "/media/welcome.mp4", caption: "Our welcome" }),
        ],
      },
    },
    null,
    2,
  )}\n`;
}

test("shows YouTube's player and an uploaded video, and chooses videos from the media library", async ({
  page,
  request,
}) => {
  // Tests never reach YouTube.
  await page.route(/youtube-nocookie\.com/, (route) =>
    route.fulfill({ contentType: "text/html", body: "<p>Player</p>" }),
  );
  writeSiteFile("public/media/welcome.mp4", "not really a video");
  writeSiteFile("content/pages/videos.json", videosPage());

  const html = await (await request.get("/videos")).text();
  expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&amp;start=60"');
  expect(html).toMatch(/<video [^>]*src="\/media\/welcome.mp4"/);

  await page.goto(`/admin#/pages/edit?path=${encodeURIComponent("/videos")}`);
  await expect(canvas(page).locator('iframe[title="Video"]')).toHaveAttribute(
    "src",
    /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/,
  );
  await canvas(page).locator('[data-puck-component="Video-upload"]').click();
  await editor(page).getByRole("button", { name: "Choose video" }).filter({ visible: true }).click();
  const dialog = page.getByRole("dialog", { name: "Choose a video" });
  await expect(dialog.getByText("welcome.mp4")).toBeVisible();
  // Only videos: the starter's pictures aren't offered.
  await expect(dialog.getByText("placeholder.svg")).toHaveCount(0);
});
