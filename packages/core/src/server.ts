// The admin panel's API for full-stack sites' servers, with Web `Request` and `Response` only, so it runs on any
// runtime that has them: Node, Cloudflare Workers, Deno, and Bun. Nothing here reads files or starts programs; what
// needs Node, such as checking releases' provenance with Sigstore, comes from `@goodfellow-cms/core/node` as options.
export {
  type EarlyInstall,
  type EarlyInstallCheck,
  type EarlyInstallProblem,
  type EarlyProblem,
  earlyInstallsIn,
  type FoundEarlyInstall,
  type ProvenanceProblem,
} from "./early-installs.js";
export { type AppApiOptions, appApi, isPluginInstallPath, type PluginServer } from "./server-app-api.js";
export { isCleanSvg, unsafeMediaChanges } from "./svg-check.js";
