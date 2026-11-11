// workerd's own module, which only Cloudflare Workers have; `lib/env.ts` imports it only there.
declare module "cloudflare:workers" {
  export const env: unknown;
  export function waitUntil(work: Promise<unknown>): void;
}
