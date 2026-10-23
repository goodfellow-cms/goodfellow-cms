/**
 * What components in the site's frames share: the site's code, the
 * connection to the admin panel's page, and a stand-in for the admin panel's
 * context with what its components use there, which can't publish or read the
 * repository.
 */
import { type GoodfellowConfig, MEDIA_DIR } from "@goodfellow-cms/core";
import { adminSite, createPuckConfig } from "@goodfellow-cms/react";
import type { ComponentConfig, Config } from "@puckeditor/core";
import { createContext, type ReactNode, useContext, useEffect, useMemo } from "react";
import { AdminContext, type AdminContextValue } from "../admin-context.js";
import { mediaUrl } from "../media.js";
import { MediaChoiceContext } from "../media-library.js";
import { createMediaPreviews, type MediaPreviews } from "../media-previews.js";
import type { SiteCodeService } from "../site-code.js";
import { StringsProvider } from "../strings.js";
import type { Channel } from "./channel.js";
import { localSiteCode } from "./local-code.js";
import type { AdminRequests, FrameInit, FrameSite } from "./protocol.js";

/** The site's config, as each kind of editor uses it. */
export interface FrameCode {
  config: GoodfellowConfig;
  pageConfig: Config;
  layoutConfig: Config;
  templateConfig: Config;
  code: SiteCodeService;
}

const FrameCodeContext = createContext<FrameCode | null>(null);

export function useFrameCode(): FrameCode {
  const value = useContext(FrameCodeContext);
  if (!value) throw new Error("useFrameCode() must be used in the site's frame.");
  return value;
}

/** The admin panel's page, as a frame asks it. */
export interface AdminClient {
  call<K extends keyof AdminRequests>(
    method: K,
    ...params: Parameters<AdminRequests[K]>
  ): Promise<Awaited<ReturnType<AdminRequests[K]>>>;
  emit(name: string, payload: unknown): void;
  channel: Channel;
}

export function adminClient(channel: Channel): AdminClient {
  return {
    call: (method, ...params) => channel.call(method, params[0]),
    emit: (name, payload) => channel.emit(name, payload),
    channel,
  };
}

const AdminClientContext = createContext<AdminClient | null>(null);

export function useAdminClient(): AdminClient {
  const value = useContext(AdminClientContext);
  if (!value) throw new Error("useAdminClient() must be used in the site's frame.");
  return value;
}

/** Media from the admin panel's page, which reads files the live site doesn't have yet from the repository. */
export function frameMediaPreviews(client: AdminClient, siteUrl: string): MediaPreviews {
  return createMediaPreviews(
    {
      readBytes: async (path) => {
        if (!path.startsWith(`${MEDIA_DIR}/`)) return undefined;
        return (await client.call("media.bytes", mediaUrl(path))) ?? undefined;
      },
    },
    siteUrl,
  );
}

function refused(): never {
  throw new Error("The site's frame can't do this.");
}

/** Everything the frame's components need, around them. */
export function FrameProviders({
  config,
  client,
  init,
  site,
  children,
}: {
  config: GoodfellowConfig;
  client: AdminClient;
  init: FrameInit;
  site: FrameSite;
  children: ReactNode;
}) {
  const code = useMemo<FrameCode>(
    () => ({
      config,
      pageConfig: createPuckConfig(config, "page"),
      layoutConfig: createPuckConfig(config, "layout"),
      templateConfig: createPuckConfig(config, "template"),
      code: localSiteCode(config),
    }),
    [config],
  );
  const described = useMemo(() => adminSite(config), [config]);
  const mediaPreviews = useMemo(() => frameMediaPreviews(client, init.siteUrl), [client, init.siteUrl]);
  useEffect(
    () =>
      client.channel.handle("media.remember", (file: { url: string; bytes: Uint8Array }) => {
        if (typeof file?.url === "string" && file.bytes instanceof Uint8Array)
          mediaPreviews.remember(file.url, file.bytes);
      }),
    [client, mediaPreviews],
  );
  const { timing, visibility, syncProblem } = site.schedule;
  const admin = useMemo<AdminContextValue>(
    () => ({
      site: described,
      blocks: code.templateConfig.components as Record<string, ComponentConfig>,
      code: code.code,
      preview: init.preview,
      siteUrl: init.siteUrl,
      state: { status: "ready", content: site.content, revision: "", media: site.media },
      account: { user: { login: "" }, hostName: init.hostName, redirectAddressesListed: false },
      mediaPreviews,
      reload: async () => refused(),
      publish: async () => refused(),
      readFile: async () => refused(),
      listFiles: async () => refused(),
      registries: {},
      contentOnly: false,
      ...(timing && { scheduledBuilds: { timing: async () => timing, sync: undefined } }),
      ...(visibility && { repositoryVisibility: async () => visibility }),
      ...(syncProblem && { scheduleSyncProblem: syncProblem }),
    }),
    [described, code, init, site, mediaPreviews, timing, visibility, syncProblem],
  );
  const chooseMedia = useMemo(
    () => (kind: Parameters<AdminRequests["media.choose"]>[0]["kind"], value: string) =>
      client.call("media.choose", { kind, value }),
    [client],
  );
  return (
    <StringsProvider strings={init.strings}>
      <AdminClientContext.Provider value={client}>
        <FrameCodeContext.Provider value={code}>
          <AdminContext.Provider value={admin}>
            <MediaChoiceContext.Provider value={chooseMedia}>{children}</MediaChoiceContext.Provider>
          </AdminContext.Provider>
        </FrameCodeContext.Provider>
      </AdminClientContext.Provider>
    </StringsProvider>
  );
}
