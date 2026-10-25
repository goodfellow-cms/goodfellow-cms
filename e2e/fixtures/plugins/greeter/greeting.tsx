"use client";

import { useSite } from "@goodfellow-cms/react";
import { useEffect, useState } from "react";

/** Asks the plugin's service for a greeting in the editor; the site shows the name alone. */
export function Greeting({ name }: { name: string }) {
  const { callPlugin } = useSite();
  const [greeting, setGreeting] = useState(name);
  useEffect(() => {
    if (!callPlugin) return;
    callPlugin("goodfellow-plugin-greeter", "greet", name).then(
      (answer) => setGreeting(String(answer)),
      (error: Error) => setGreeting(`Refused: ${error.message}`),
    );
  }, [callPlugin, name]);
  return <p data-greeting="">{greeting}</p>;
}
