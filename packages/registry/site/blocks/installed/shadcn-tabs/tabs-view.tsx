"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Runs with Preact as well as React, so sites whose Client Components all do load Preact instead (see Islands). */
export const worksWithPreact = true;

/** The tabs, with every tab's content in the page and the others hidden, and their parts' classes from the block. */
export function TabsView({
  tabs,
  classes,
}: {
  tabs: Array<{ label: string; content: ReactNode }>;
  classes: { list: string; tab: string; content: string };
}) {
  if (tabs.length === 0) return null;
  return (
    <Tabs defaultValue="tab-0">
      <TabsList className={classes.list}>
        {tabs.map((tab, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: tabs have no ids of their own
          <TabsTrigger key={index} value={`tab-${index}`} className={classes.tab}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: tabs have no ids of their own
        <TabsContent key={index} value={`tab-${index}`} forceMount className={classes.content}>
          <div className="gf-prose">{tab.content}</div>
        </TabsContent>
      ))}
    </Tabs>
  );
}
