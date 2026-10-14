/** The worker as Cloudflare runs it: `wrangler deploy` reads `wrangler.jsonc`, which names this file. */
import { createWorker, type WorkerEnv } from "./worker.js";

export { Limits } from "./limits.js";

const worker = createWorker();

export default {
  fetch(request: Request, env: WorkerEnv): Promise<Response> {
    return worker.fetch(request, env);
  },
};
