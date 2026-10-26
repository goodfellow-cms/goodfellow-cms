import { definePluginAdmin, type PluginEditorData } from "@goodfellow-cms/core";

/** A page editor that lists the page's top-level blocks, each with a text field for its text, if it has one. */
export default definePluginAdmin({
  editor: {
    mount(element, session) {
      const root = element as HTMLElement;
      const doc = root.ownerDocument;
      let data: PluginEditorData = session.data;
      const past: PluginEditorData[] = [];
      const future: PluginEditorData[] = [];
      const status = doc.createElement("p");
      status.setAttribute("role", "status");
      const list = doc.createElement("ol");
      const title = doc.createElement("input");
      title.id = "outline-title";

      const change = (next: PluginEditorData) => {
        past.push(data);
        future.length = 0;
        data = next;
        session.change(data, { past: true, future: false });
        draw();
      };
      function draw() {
        title.value = String(data.root.props?.title ?? "");
        list.replaceChildren(
          ...data.content.map((block, index) => {
            const item = doc.createElement("li");
            item.dataset.block = block.type;
            const label = doc.createElement("label");
            label.textContent = `${session.blocks[block.type]?.label ?? block.type} ${index + 1}`;
            item.append(label);
            if (typeof block.props.text === "string") {
              const input = doc.createElement("input");
              input.value = block.props.text;
              input.setAttribute("aria-label", label.textContent);
              input.addEventListener("change", () => {
                const content = data.content.map((other, at) =>
                  at === index ? { ...other, props: { ...other.props, text: input.value } } : other,
                );
                change({ ...data, content });
              });
              item.append(input);
            }
            return item;
          }),
        );
      }
      title.addEventListener("change", () => {
        change({ ...data, root: { ...data.root, props: { ...data.root.props, title: title.value } } });
      });
      const button = (text: string, onClick: () => unknown) => {
        const element = doc.createElement("button");
        element.type = "button";
        element.textContent = text;
        element.addEventListener("click", () => {
          Promise.resolve(onClick()).catch((error: Error) => {
            status.textContent = `Refused: ${error.message}`;
          });
        });
        return element;
      };
      const titleLabel = doc.createElement("label");
      titleLabel.textContent = "Page title";
      titleLabel.htmlFor = "outline-title";
      root.append(
        doc.createElement("h1"),
        titleLabel,
        title,
        list,
        button("Add a heading", () =>
          change({
            ...data,
            content: [
              ...data.content,
              {
                type: "Heading",
                props: { id: `Heading-${Date.now()}`, text: "New heading", level: "h2", align: "left", className: "" },
              },
            ],
          }),
        ),
        button("Add a script", () =>
          change({ ...data, content: [...data.content, { type: "Script", props: { id: "Script-1" } }] }),
        ),
        button("Choose a picture", async () => {
          status.textContent = `Chose ${(await session.chooseMedia("image")) ?? "nothing"}`;
        }),
        button("Preview a shared link", async () => {
          const preview = await session.sharePreview(data.root);
          status.textContent = `Shared as ${preview.title}`;
        }),
        status,
      );
      (root.firstChild as HTMLElement).textContent = `Outline of ${session.title} (${session.kind})`;
      draw();
      return {
        data: () => data,
        set: (next) => {
          change(next);
        },
        undo: () => {
          const previous = past.pop();
          if (!previous) return;
          future.push(data);
          data = previous;
          session.change(data, { past: past.length > 0, future: true });
          draw();
        },
        redo: () => {
          const next = future.pop();
          if (!next) return;
          past.push(data);
          data = next;
          session.change(data, { past: true, future: future.length > 0 });
          draw();
        },
      };
    },
  },
});
