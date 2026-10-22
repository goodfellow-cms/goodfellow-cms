/**
 * The worker for tests: the same code Cloudflare runs, called directly, with
 * GitHub's requests going to a fake, and test GitHub Apps with keys made for
 * the test. Never import this from code that ships.
 */
import { createWorker, type WorkerEnv } from "./worker.js";

export { challengeFor } from "./seal.js";
export {
  createWorker,
  isLocalAddress,
  PERMISSIONS,
  type SignInProblem,
  type WorkerEnv,
  type WorkerOptions,
} from "./worker.js";

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** An RSA key pair, as a GitHub App's: the private key in PEM, for the worker, and the public key, for the fake. */
export async function testKeyPair() {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
  return {
    pkcs8,
    pem: `-----BEGIN PRIVATE KEY-----\n${base64(pkcs8)}\n-----END PRIVATE KEY-----`,
    publicKey: pair.publicKey,
  };
}

/** Where an app is installed, as `fakeGitHub()` describes it. */
export interface TestInstallation {
  id: number;
  account: string;
  accountType?: "User" | "Organization";
  repositories: string[] | "all";
}

/**
 * Goodfellow's two GitHub Apps, as `fakeGitHub({ apps })` takes them, and the
 * worker's settings for them, with keys made for the test.
 */
export async function testSignIn(
  options: {
    edit?: TestInstallation[];
    owner?: TestInstallation[];
    setupOrigins?: string[];
    env?: Partial<WorkerEnv>;
  } = {},
) {
  const [editKey, ownerKey] = await Promise.all([testKeyPair(), testKeyPair()]);
  const edit = {
    id: "101",
    slug: "goodfellow-cms",
    clientId: "Iv1.edit",
    clientSecret: "edit-secret",
    publicKey: editKey.publicKey,
    permissions: {
      contents: "write",
      metadata: "read",
      deployments: "read",
      actions: "read",
      pages: "read",
      checks: "read",
      statuses: "read",
    } as Record<string, "read" | "write">,
    installations: options.edit ?? [],
  };
  const owner = {
    id: "102",
    slug: "goodfellow-cms-owner",
    clientId: "Iv1.owner",
    clientSecret: "owner-secret",
    publicKey: ownerKey.publicKey,
    permissions: {
      administration: "write",
      contents: "write",
      workflows: "write",
      pages: "write",
      actions: "write",
      secrets: "write",
      metadata: "read",
    } as Record<string, "read" | "write">,
    installations: options.owner ?? [],
  };
  const env: WorkerEnv = {
    EDIT_APP_ID: edit.id,
    EDIT_APP_SLUG: edit.slug,
    EDIT_CLIENT_ID: edit.clientId,
    EDIT_CLIENT_SECRET: edit.clientSecret,
    EDIT_PRIVATE_KEY: editKey.pem,
    OWNER_APP_ID: owner.id,
    OWNER_APP_SLUG: owner.slug,
    OWNER_CLIENT_ID: owner.clientId,
    OWNER_CLIENT_SECRET: owner.clientSecret,
    // As a secret pasted on one line would have it.
    OWNER_PRIVATE_KEY: ownerKey.pem.replace(/\n/g, "\\n"),
    SESSION_KEY: base64(crypto.getRandomValues(new Uint8Array(32))),
    SETUP_ORIGINS: (options.setupOrigins ?? []).join(","),
    ...options.env,
  };
  return {
    apps: { edit, owner },
    keys: { edit: editKey, owner: ownerKey },
    env,
    /** The worker, sending GitHub's requests to `fetch`, such as a fake's. */
    worker(fetch: typeof globalThis.fetch, now?: () => number) {
      const worker = createWorker({ fetch, now });
      return { fetch: (request: Request) => worker.fetch(request, env) };
    },
  };
}
