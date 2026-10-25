import { definePlugin } from "@goodfellow-cms/core";
import { Greeting } from "./greeting";

/**
 * A plugin for the end-to-end tests: a screen that publishes the one file it
 * declared, and a service its block asks from the editor.
 */
export const greeter = definePlugin({
  name: "goodfellow-plugin-greeter",
  title: "Greeter",
  version: "1.0.0",
  permissions: { connect: ["https://greeting.example"], files: ["content/greeter.json"] },
  blocks: {
    Greeting: {
      label: "Greeting",
      fields: { name: { type: "text", label: "Name" } },
      defaultProps: { name: "world" },
      render: ({ name }) => <Greeting name={name} />,
    },
  },
  admin: "./plugins/greeter/admin.ts",
  screens: [{ id: "settings", title: "Greeter" }],
});
