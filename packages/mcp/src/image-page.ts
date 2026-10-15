/**
 * A page showing one image at most as wide as the screenshot, which both
 * screenshot setups open in place of the image's own address: browsers show
 * an image opened on its own in a document of their own, which can't always
 * be screenshotted (an SVG's never finishes).
 */
function attribute(text: string): string {
  return text.replace(
    /[&"<>]/g,
    (character) => ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character] ?? "",
  );
}

export function imagePage(url: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: #fff; }
img { display: block; max-width: 100%; height: auto; }
img[src$=".svg" i] { width: 100%; }
</style></head>
<body><img src="${attribute(url)}" alt=""></body></html>`;
}
