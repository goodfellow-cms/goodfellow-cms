import { aiServer, type ServerKeys } from "@goodfellow-cms/ai";

/**
 * The admin panel's AI requests, sent on with the editor's keys from the broker's page, which is a browser: Anthropic's
 * API answers a browser only when the request says it comes from one.
 */
export function brokerAi(keys: ServerKeys, options: { fetch?: typeof fetch } = {}) {
  return aiServer(keys, { ...options, browser: true });
}
