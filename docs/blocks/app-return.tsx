"use client";

import { useEffect, useState } from "react";
import { APP_CHANNEL, type AppReturn, appReturnOf } from "./publishing-app";
import { Note } from "./site-setup-ui";

/**
 * The page GitHub sends people back to after making or installing a full-stack site's publishing app
 * (`/new-site/full-stack/app/`): it tells the setup page's tab what GitHub said, on a channel only this browser's
 * pages at this address hear, and takes it out of the address. The setup page's tab checks the state is its own.
 */
export function AppReturnPage() {
  const [said, setSaid] = useState<AppReturn | null>();
  useEffect(() => {
    const found = appReturnOf(window.location.search) ?? null;
    window.history.replaceState(null, "", window.location.pathname);
    if (found && typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel(APP_CHANNEL);
      channel.postMessage(found);
      channel.close();
    }
    setSaid(found);
  }, []);
  if (said === undefined) return <p aria-live="polite">Loading…</p>;
  return (
    <div aria-live="polite">
      {said ? (
        <Note>
          {said.kind === "created" ? "The app is made." : "The app is installed."} Go back to the setup page's tab,
          which carries on from here. You can close this one.
        </Note>
      ) : (
        <Note tone="warning">
          This page is where GitHub sends you back to while you set up a full-stack site, and there's nothing for it to
          pass on. Go back to the setup page's tab.
        </Note>
      )}
    </div>
  );
}
