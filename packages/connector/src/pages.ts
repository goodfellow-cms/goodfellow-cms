/** The few pages people see while connecting Claude: which host to sign in with, which sites, and problems. */

export function escapeHtml(text: string): string {
  return text.replace(
    /[&<>"']/g,
    (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] as string,
  );
}

const STYLE = `body { font: 16px/1.5 system-ui, sans-serif; max-width: 36rem; margin: 3rem auto; padding: 0 1rem; color: #1f2328; background: #fff; }
a.button, button { display: inline-block; font: inherit; padding: 0.5rem 1rem; margin: 0.25rem 0.5rem 0.25rem 0; border-radius: 6px; border: 1px solid #1f883d; background: #1f883d; color: #fff; text-decoration: none; cursor: pointer; }
a.secondary { background: #fff; color: #1f2328; border-color: #d0d7de; }
label { display: block; margin: 0.5rem 0; }
.note { color: #59636e; font-size: 0.9rem; }
@media (prefers-color-scheme: dark) { body { color: #e6edf3; background: #0d1117; } a.secondary { background: #0d1117; color: #e6edf3; border-color: #3d444d; } .note { color: #9198a1; } }`;

/** The page's headers: nothing loaded from elsewhere, never shown in a frame, and forms only to `formAction`. */
export function page(title: string, body: string, options: { status?: number; formAction?: string[] } = {}): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>
`;
  return new Response(html, {
    status: options.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "content-security-policy": `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action ${[
        "'self'",
        ...(options.formAction ?? []),
      ].join(" ")}`,
    },
  });
}

export function problemPage(title: string, message: string, status = 400): Response {
  return page(title, `<p>${escapeHtml(message)}</p>`, { status });
}

/** Where Claude goes back to, as people should see it before allowing it. */
export function redirectHost(redirectUri: string): string {
  const url = new URL(redirectUri);
  return url.hostname === "127.0.0.1" || url.hostname === "localhost" ? "an app on this computer" : url.host;
}

export function connectPage(options: {
  client: string;
  redirectUri: string;
  links: Array<[string, string]>;
}): Response {
  const buttons = options.links
    .map(([label, href]) => `<a class="button" href="${escapeHtml(href)}">${escapeHtml(label)}</a>`)
    .join("\n");
  return page(
    "Connect Claude to your sites",
    `<p><strong>${escapeHtml(options.client)}</strong> wants to work on the Goodfellow sites you choose: read their pages and settings, make changes in drafts, and publish them when you say so.</p>
<p>Sign in with the host your site is stored on:</p>
<p>${buttons}</p>
<p class="note">You'll go back to <strong>${escapeHtml(redirectHost(options.redirectUri))}</strong> once you've chosen your sites.</p>`,
  );
}

export function sitesPage(options: {
  client: string;
  redirectUri: string;
  sites: string[];
  picker: string;
  formAction: string;
}): Response {
  const boxes = options.sites
    .map(
      (site) =>
        `<label><input type="checkbox" name="site" value="${escapeHtml(site)}"${options.sites.length === 1 ? " checked" : ""}> ${escapeHtml(site)}</label>`,
    )
    .join("\n");
  return page(
    "Which sites?",
    `<p>Choose the sites <strong>${escapeHtml(options.client)}</strong> may work on. You can connect again later to change them.</p>
<form method="post" action="/connect/confirm">
<input type="hidden" name="picker" value="${escapeHtml(options.picker)}">
${boxes}
<p><button type="submit">Allow</button></p>
</form>
<p class="note">You'll go back to <strong>${escapeHtml(redirectHost(options.redirectUri))}</strong>.</p>`,
    { formAction: [options.formAction] },
  );
}

export function installPage(options: { installUrl: string; again: string }): Response {
  return page(
    "Install Goodfellow for Claude",
    `<p>Claude works on a site's repository through the <strong>Goodfellow for Claude</strong> app, which isn't on any repository you can edit yet. An owner of the site installs it, for the site's repository only, and is signed in as it's installed.</p>
<p><a class="button" href="${escapeHtml(options.installUrl)}">Install it</a> <a class="button secondary" href="${escapeHtml(options.again)}">I've installed it</a></p>`,
  );
}
