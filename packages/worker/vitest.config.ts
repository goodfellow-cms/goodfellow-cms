import { fileURLToPath } from "node:url";
import { defineConfig, mergeConfig } from "vitest/config";
import shared from "../../vitest.shared.ts";

// The app's tokens are signed with universal-github-app-jwt as Workers load it, with Web Crypto, which reads only
// PKCS#8 keys, not with its Node build, which reads PKCS#1 too and so hid that GitHub's keys need converting.
export default mergeConfig(
  shared,
  defineConfig({
    resolve: {
      alias: [
        {
          find: /^#crypto$/,
          replacement: fileURLToPath(
            new URL("./node_modules/universal-github-app-jwt/lib/crypto-native.js", import.meta.url),
          ),
        },
      ],
    },
    test: { server: { deps: { inline: ["universal-github-app-jwt"] } } },
  }),
);
