import { definePluginAdmin } from "@goodfellow-cms/core";

const FILE = "content/greeter.json";

export default definePluginAdmin({
  services: {
    greet: ([name]) => `Hello, ${String(name)}, from the plugin!`,
  },
  screens: {
    async settings(element, api) {
      const root = element as HTMLElement;
      const doc = root.ownerDocument;
      const saved = (await api.read([FILE]))[FILE];
      const message = saved ? (JSON.parse(saved) as { message: string }).message : "";

      // Plugins draw their screens' headings themselves.
      const heading = doc.createElement("h1");
      heading.textContent = api.plugin.title;
      const label = doc.createElement("label");
      label.textContent = "Message";
      label.htmlFor = "message";
      const input = doc.createElement("input");
      input.id = "message";
      input.value = message;
      const status = doc.createElement("p");
      status.setAttribute("role", "status");
      const button = (text: string, onClick: () => Promise<string>) => {
        const element = doc.createElement("button");
        element.type = "button";
        element.textContent = text;
        element.addEventListener("click", () => {
          onClick().then(
            (result) => {
              status.textContent = result;
            },
            (error: Error) => {
              status.textContent = `Refused: ${error.message}`;
            },
          );
        });
        return element;
      };
      root.append(
        heading,
        label,
        input,
        button("Save", async () => {
          const { published } = await api.publish(
            [{ path: FILE, text: `${JSON.stringify({ message: input.value })}\n` }],
            "Change the greeting",
          );
          return published ? "Saved" : "Not saved";
        }),
        button("Change the site's title", async () => {
          await api.publish([{ path: "content/site.json", text: "{}" }], "Not allowed");
          return "Changed";
        }),
        button("Reach another site", async () => {
          await fetch("https://elsewhere.example/");
          return "Reached";
        }),
        status,
      );
    },
  },
});
