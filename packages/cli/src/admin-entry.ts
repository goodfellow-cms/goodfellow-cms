import { createRequire } from "node:module";
import type { AdminSite } from "@goodfellow-cms/core";
import { DEV_API_PREFIX } from "@goodfellow-cms/core/node";
import type { Plugin } from "vite";

export const ADMIN_ENTRY = "virtual:goodfellow/admin";
const RESOLVED_ADMIN_ENTRY = `\0${ADMIN_ENTRY}`;

/** The editor's frames' entry: the site's config, Puck and every block, which the admin panel's page never loads. */
export const EDITOR_ENTRY = "virtual:goodfellow/editor";
const RESOLVED_EDITOR_ENTRY = `\0${EDITOR_ENTRY}`;

/** Where the editor's frames are served from by `goodfellow dev`, and their files by `goodfellow build`. */
export const EDITOR_PATH = "admin/editor/";

/** Where a built admin page finds the settings `goodfellow build` only knows after bundling. */
export const ADMIN_SETTINGS_GLOBAL = "__GOODFELLOW_ADMIN__";

export interface BuiltAdminSettings {
  previewStylesheets: string[];
  siteUrl: string;
  /** What the admin panel knows about the site, without its code. */
  site: AdminSite;
  /** The editor's scripts and stylesheets, for its frames. */
  frames: { scripts: string[]; stylesheets: string[] };
}

export type AdminEntryMode =
  /** `site()` is asked each time the page loads, since the config can change while the server runs. */
  { mode: "dev"; previewStylesheet: string; site: () => Promise<AdminSite> } | { mode: "build"; site: AdminSite };

/**
 * Removes WebRTC from the editor's frames before anything else runs, since a
 * Content Security Policy can't stop it reaching other computers.
 */
export const EDITOR_PRELUDE = `(()=>{for(const name of Object.getOwnPropertyNames(globalThis))if(/^(webkit|moz)?RTC/.test(name))try{delete globalThis[name]}catch{}})();`;

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
  const mount = async () => {
    if (entry.mode === "dev") {
      return [
        `import { localStore } from "@goodfellow-cms/admin/dev";`,
        ...common,
        "mountAdmin(element, {",
        `  site: ${JSON.stringify(await entry.site())},`,
        `  frames: { url: ${JSON.stringify(`/${EDITOR_PATH}`)}, sameOrigin: true },`,
        "  store: localStore(),",
        // The block registry the site's packages include, which the development server serves.
        `  registry: ${JSON.stringify(`${DEV_API_PREFIX}/registry/{name}.json`)},`,
        `  preview: { stylesheets: [${JSON.stringify(entry.previewStylesheet)}], themeCss, tailwindBrowserUrl },`,
        `  siteUrl: "/",`,
        "});",
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
  // In development the editor is a module like any other, with the prelude imported first so it runs first.
  const editor = [
    ...(entry.mode === "dev" ? [`import ${JSON.stringify(`${RESOLVED_EDITOR_ENTRY}-prelude`)};`] : []),
    `import config from ${JSON.stringify(configFile)};`,
    `import { mountEditorFrame } from "@goodfellow-cms/admin/editor";`,
    `import "@puckeditor/core/puck.css";`,
    `import "@goodfellow-cms/admin/styles.css";`,
    "mountEditorFrame(config);",
  ];

  return {
    name: "goodfellow:admin-entry",
    resolveId: (id) =>
      id === ADMIN_ENTRY
        ? RESOLVED_ADMIN_ENTRY
        : id === EDITOR_ENTRY
          ? RESOLVED_EDITOR_ENTRY
          : id === `${RESOLVED_EDITOR_ENTRY}-prelude`
            ? id
            : undefined,
    load: async (id) => {
      if (id === RESOLVED_ADMIN_ENTRY) return (await mount()).join("\n");
      if (id === RESOLVED_EDITOR_ENTRY) return editor.join("\n");
      if (id === `${RESOLVED_EDITOR_ENTRY}-prelude`) return EDITOR_PRELUDE;
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

/** The page `goodfellow dev` serves the editor's frames, whose scripts Vite adds. */
export function editorHtml(): string {
  return [
    "<!DOCTYPE html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="utf-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1" />',
    '    <meta name="robots" content="noindex" />',
    "  </head>",
    "  <body>",
    `    <script type="module" src="/@id/__x00__${EDITOR_ENTRY}"></script>`,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}
