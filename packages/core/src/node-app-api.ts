import { nodeProvenance } from "./node-provenance.js";
import { type AppApiOptions, appApi as serverAppApi } from "./server.js";

/**
 * The admin panel's API on a full-stack site's server, as `appApi()` from
 * `@goodfellow-cms/core/server` gives it, checking releases installed early
 * with `nodeProvenance()` unless `provenance` says otherwise.
 */
export function appApi(options: AppApiOptions): (request: Request, endpoint: string) => Promise<Response> {
  return serverAppApi({ provenance: nodeProvenance(), ...options });
}
