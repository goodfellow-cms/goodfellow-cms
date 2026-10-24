import { createRequire } from "node:module";
import { ADMIN_POLICY, type AdminSite } from "@goodfellow-cms/core";
import { DEV_API_PREFIX } from "@goodfellow-cms/core/node";
import type { Plugin } from "vite";

export const ADMIN_ENTRY = "virtual:goodfellow/admin";
const RESOLVED_ADMIN_ENTRY = `\0${ADMIN_ENTRY}`;

/** The editor's frames' entry: the site's config, Puck and every block, which the admin panel's page never loads. */
export const EDITOR_ENTRY = "virtual:goodfellow/editor";
const RESOLVED_EDITOR_ENTRY = `\0${EDITOR_ENTRY}`;

/** What `goodfellow dev` tells the admin page once it has rebuilt the editor's frames. */
export const EDITOR_REBUILT_EVENT = "goodfellow:editor-rebuilt";

/** Where the editor's frames are served from by `goodfellow dev`, and their files by `goodfellow build`. */
export const EDITOR_PATH = "admin/editor/";

/** Where a built admin page finds the settings `goodfellow build` only knows after bundling. */
export const ADMIN_SETTINGS_GLOBAL = "__GOODFELLOW_ADMIN__";

export interface BuiltAdminSettings {
  previewStylesheets: string[];
  siteUrl: string;
  /** What the admin panel knows about the site, without its code. */
  site: AdminSite;
  /** The editor's frames' page. */
  frames: { url: string };
}

/** Where `goodfellow dev` serves what the admin panel knows about the site, read afresh each time, as the config changes. */
export const DEV_ADMIN_SITE_PATH = `${DEV_API_PREFIX}/admin-site`;

export type AdminEntryMode = { mode: "dev"; previewStylesheet: string } | { mode: "build"; site: AdminSite };

/**
 * The admin panel's entry module: the admin panel, told about the site's
 * blocks by a description of them (never the site's config, which runs only
 * in the editor's frames), plus what previews need to look like the site.
 * - In development it uses the local backend, which reads and writes files on disk.
 * - In builds it signs in to the config's git backend, made again from the
 *   package and options the config gave it; the local backend is never included.
 */
export function adminEntryPlugin(configFile: string, entry: AdminEntryMode): Plugin {
  const tailwindBrowser = createRequire(import.meta.url).resolve("@tailwindcss/browser");
  const common = [
    `import { mountAdmin } from "@goodfellow-cms/admin";`,
    `import "@goodfellow-cms/admin/styles.css";`,
    `import themeCss from "@goodfellow-cms/react/theme.css?raw";`,
    `import tailwindBrowserUrl from ${JSON.stringify(`${tailwindBrowser}?url`)};`,
    `const element = document.getElementById("gf-admin");`,
  ];
  const mount = () => {
    if (entry.mode === "dev") {
      return [
        `import { localStore } from "@goodfellow-cms/admin/dev";`,
        `import { reloadFrames } from "@goodfellow-cms/admin";`,
        ...common,
        "mountAdmin(element, {",
        `  site: await fetch(${JSON.stringify(DEV_ADMIN_SITE_PATH)}).then((response) => response.json()),`,
        `  frames: { url: ${JSON.stringify(`/${EDITOR_PATH}`)} },`,
        "  store: localStore(),",
        // The block registry the site's packages include, which the development server serves.
        `  registry: ${JSON.stringify(`${DEV_API_PREFIX}/registry/{name}.json`)},`,
        `  preview: { stylesheets: [${JSON.stringify(entry.previewStylesheet)}], themeCss, tailwindBrowserUrl },`,
        `  siteUrl: "/",`,
        "});",
        // The editor's frames are rebuilt as the site's code changes; reloading them shows the new blocks,
        // and leaves whatever is open on the admin panel's page as it is.
        `import.meta.hot?.on(${JSON.stringify(EDITOR_REBUILT_EVENT)}, () => reloadFrames());`,
      ];
    }
    const backend = entry.site.backend;
    return [
      ...(backend ? [`import { ${backend.export} as host } from ${JSON.stringify(backend.package)};`] : []),
      ...common,
      `const settings = window[${JSON.stringify(ADMIN_SETTINGS_GLOBAL)}];`,
      "mountAdmin(element, {",
      "  site: settings.site,",
      "  frames: settings.frames,",
      ...(backend ? ["  host: host(settings.site.backend.options),"] : []),
      "  preview: { stylesheets: settings.previewStylesheets, themeCss, tailwindBrowserUrl },",
      "  siteUrl: settings.siteUrl,",
      "});",
    ];
  };
  // Bundled as one classic script, in development too, with the prelude as its banner (see buildEditor()).
  const editor = [
    `import config from ${JSON.stringify(configFile)};`,
    `import { mountEditorFrame } from "@goodfellow-cms/admin/editor";`,
    `import "@puckeditor/core/puck.css";`,
    `import "@goodfellow-cms/admin/styles.css";`,
    "mountEditorFrame(config);",
  ];

  return {
    name: "goodfellow:admin-entry",
    resolveId: (id) =>
      id === ADMIN_ENTRY ? RESOLVED_ADMIN_ENTRY : id === EDITOR_ENTRY ? RESOLVED_EDITOR_ENTRY : undefined,
    load: async (id) => {
      if (id === RESOLVED_ADMIN_ENTRY) return mount().join("\n");
      if (id === RESOLVED_EDITOR_ENTRY) return editor.join("\n");
      return undefined;
    },
  };
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The admin page. In development Vite adds its own scripts; built pages list the bundled files. */
export function adminHtml(options: {
  scripts: string[];
  stylesheets?: string[];
  settings?: BuiltAdminSettings;
  /** The site's icon, for the tab before the admin panel has loaded the site. */
  icon?: string;
}): string {
  const links = (options.stylesheets ?? []).map((href) => `    <link rel="stylesheet" href="${escapeHtml(href)}" />`);
  const settings = options.settings
    ? [
        // JSON with "<" escaped can't close the script element.
        `    <script>window.${ADMIN_SETTINGS_GLOBAL} = ${JSON.stringify(options.settings).replace(/</g, "\\u003c")};</script>`,
      ]
    : [];
  const scripts = options.scripts.map((src) => `    <script type="module" src="${escapeHtml(src)}"></script>`);
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    `    <meta http-equiv="Content-Security-Policy" content="${ADMIN_POLICY}" />`,
    '    <meta name="robots" content="noindex" />',
    "    <title>Site admin</title>",
    ...(options.icon ? [`    <link rel="icon" href="${escapeHtml(options.icon)}" />`] : []),
    ...links,
    ...settings,
    "  </head>",
    "  <body>",
    '    <div id="gf-admin"></div>',
    ...scripts,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}
