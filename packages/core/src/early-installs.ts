/**
 * Finding the plugins and themes a change installs before they're
 * `RELEASE_AGE_DAYS` old, with nothing but the change and the files as they
 * are, so a server on any runtime can see them. Checking them needs npm's
 * registry and Sigstore, which only `@goodfellow-cms/core/node` does
 * (`nodeProvenance()`, `checkEarlyInstall()`).
 */
// From the main entry, which the server's and Node's builds share rather than bundling copies of.
import {
  type EarlyInstallRecord,
  type FileChange,
  INSTALLED_PLUGINS_FILE,
  parseInstalledPlugins,
  THEME_FILE,
  themeRecordSchema,
} from "./index.js";

/** A plugin or theme an install record says was installed early. */
export interface EarlyInstall {
  kind: "plugin" | "theme";
  name: string;
  release: string;
  early: EarlyInstallRecord;
}

/** Why a release's provenance doesn't count. */
export type ProvenanceProblem = "no-provenance" | "unverified" | "unavailable";

/** Why an early install can't be used. */
export type EarlyProblem = "not-installed" | "not-newer" | "other-source" | ProvenanceProblem;

/** An early install that can't be used, and why. */
export interface EarlyInstallProblem {
  install: EarlyInstall;
  problem: EarlyProblem;
  message: string;
}

/** An early install a change brings, with the release it updates as the site has it now (`""` for none). */
export interface FoundEarlyInstall {
  install: EarlyInstall;
  installed: string;
}

/**
 * Checks early installs, giving what's wrong with each, for a server to
 * refuse them: `nodeProvenance()` from `@goodfellow-cms/core/node` checks
 * their provenance with npm's registry and Sigstore.
 */
export type EarlyInstallCheck = (installs: readonly FoundEarlyInstall[]) => Promise<EarlyInstallProblem[]>;

function changeText(change: FileChange): string | undefined {
  if ("delete" in change) return undefined;
  return "bytes" in change ? new TextDecoder().decode(change.bytes) : change.content;
}

/**
 * The early installs a set of changes brings, with the release each updates
 * as the site has it now (`read` gives a file as it is), so a server can check
 * them before it writes them: in `plugins/installed/installed.json` and the
 * theme record, those that weren't there before.
 */
export async function earlyInstallsIn(
  changes: readonly FileChange[],
  read: (path: string) => Promise<string | undefined>,
): Promise<FoundEarlyInstall[]> {
  const found: FoundEarlyInstall[] = [];
  const plugins = changes.find((change) => change.path === INSTALLED_PLUGINS_FILE);
  const pluginsText = plugins && changeText(plugins);
  if (pluginsText !== undefined) {
    const now = parseInstalledPlugins(pluginsText);
    const before = parseInstalledPlugins(await read(INSTALLED_PLUGINS_FILE)).plugins;
    for (const [name, plugin] of Object.entries(now.plugins)) {
      const was = before[name];
      if (!plugin.early || (was?.release === plugin.release && was.early)) continue;
      found.push({
        install: { kind: "plugin", name, release: plugin.release, early: plugin.early },
        installed: was?.release ?? "",
      });
    }
  }
  const theme = changes.find((change) => change.path === THEME_FILE);
  const themeText = theme && changeText(theme);
  if (themeText !== undefined) {
    const now = themeRecordSchema.safeParse(JSON.parse(themeText));
    const beforeText = await read(THEME_FILE);
    const was = beforeText === undefined ? undefined : themeRecordSchema.safeParse(JSON.parse(beforeText)).data;
    const record = now.success ? now.data : undefined;
    if (record?.early && !(was?.name === record.name && was.release === record.release && was.early)) {
      found.push({
        install: { kind: "theme", name: record.name, release: record.release, early: record.early },
        installed: was?.name === record.name ? was.release : "",
      });
    }
  }
  return found;
}
