import type { PluginDescription, PluginSecretsHelp, TaskSecretsPlace } from "@goodfellow-cms/core";
import type { Translate } from "./strings.js";

/** The lines a plugin's secrets take in `.env.local`, each waiting for its value after the `=`. */
function envLines(names: readonly string[]): string {
  return names.map((name) => `${name}=`).join("\n");
}

/** How to add a plugin's secrets where a site keeps them, as its screens show it, in the admin panel's words. */
function helpFor(place: TaskSecretsPlace, names: readonly string[], t: Translate): PluginSecretsHelp | undefined {
  const list = names.join(", ");
  switch (place.kind) {
    case "github":
      return {
        where: "github",
        title: t("plugins.secrets.github.title"),
        link: { url: place.url, label: t("plugins.secrets.github.link") },
        steps: [
          { text: t("plugins.secrets.github.open") },
          ...names.map((name) => ({ text: t("plugins.secrets.github.add", { name }), code: name })),
        ],
        notes: [t("plugins.secrets.github.who"), t("plugins.secrets.github.kind")],
      };
    case "gitlab":
      return {
        where: "gitlab",
        title: t("plugins.secrets.gitlab.title"),
        link: { url: place.url, label: t("plugins.secrets.gitlab.link") },
        steps: [
          { text: t("plugins.secrets.gitlab.open") },
          ...names.map((name) => ({ text: t("plugins.secrets.gitlab.add", { name }), code: name })),
        ],
        notes: [t("plugins.secrets.gitlab.who")],
      };
    case "goodfellow-dev":
    case "next-dev":
      return {
        where: "development",
        title: t("plugins.secrets.development.title"),
        steps: [
          { text: t("plugins.secrets.development.file", { names: list }), code: envLines(names) },
          { text: t("plugins.secrets.development.values") },
        ],
        notes: [t("plugins.secrets.development.local")],
      };
    case "server":
      return {
        where: "server",
        title: t("plugins.secrets.server.title"),
        steps: [
          { text: t("plugins.secrets.server.add", { names: list }) },
          { text: t("plugins.secrets.server.deploy") },
        ],
        notes: [t("plugins.secrets.server.who")],
      };
  }
}

/**
 * How the site's owner adds the secrets a plugin declared, for this site as
 * it's set up: where its tasks get them, and, on a full-stack site whose
 * plugin has a server module, the server first, with the CI as well.
 */
export function pluginSecretsHelp(
  place: TaskSecretsPlace | undefined,
  plugin: PluginDescription,
  t: Translate,
): PluginSecretsHelp[] {
  const names = plugin.permissions.secrets ?? [];
  if (!place || names.length === 0) return [];
  if (place.kind === "server") {
    const ci = place.ci && helpFor(place.ci, names, t);
    // A plugin without a server module has nothing on the server to give them to.
    const server = plugin.server ? helpFor(place, names, t) : undefined;
    return [server, ci].filter((help): help is PluginSecretsHelp => help !== undefined);
  }
  const help = helpFor(place, names, t);
  return help ? [help] : [];
}
