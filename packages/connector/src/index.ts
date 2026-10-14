/** The connector as Cloudflare runs it: `wrangler deploy` reads `wrangler.jsonc`, which names this file. */
import { type ConnectorEnv, createConnector, type ExecutionContextLike } from "./connector.js";

const connector = createConnector();

export default {
  fetch(request: Request, env: ConnectorEnv, context: ExecutionContextLike): Promise<Response> {
    return connector.fetch(request, env, context);
  },
};
