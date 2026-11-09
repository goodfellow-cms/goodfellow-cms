// How vinext builds the site into a Cloudflare Worker (`npm run build`). `npm run dev` still runs Next.js.
import { cloudflare } from "@cloudflare/vite-plugin";
import { staticAssetsAdapter } from "@vinext/cloudflare/cache/static-assets-adapter";
import { imagesOptimizer } from "@vinext/cloudflare/images/images-optimizer";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    vinext({
      // Every page is rendered while the site builds and served from Workers Static Assets, so a visit renders
      // nothing.
      cache: { cdn: staticAssetsAdapter() },
      prerender: { routes: "*" },
      images: { optimizer: imagesOptimizer() },
    }),
    // Pages render in workerd, Cloudflare's runtime, as they will on Cloudflare.
    cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } }),
  ],
});
