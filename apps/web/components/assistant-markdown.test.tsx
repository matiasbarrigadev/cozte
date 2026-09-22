import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantMarkdown } from "./assistant-markdown";

describe("Markdown de Cozte", () => {
  it("muestra énfasis y listas en vez de asteriscos literales", () => {
    const html = renderToStaticMarkup(<AssistantMarkdown text={"**Producto:** Tofu\n\n1. **Unidad:** 300 g\n2. 500 g"} />);
    expect(html).toContain("<strong>Producto:</strong>");
    expect(html).toContain("<ol");
    expect(html).toContain("<strong>Unidad:</strong>");
  });

  it("no incorpora HTML ni imágenes indicadas por el modelo", () => {
    const html = renderToStaticMarkup(<AssistantMarkdown text={'<script>alert(1)</script>\n\n![archivo](https://example.com/a.png)'} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
  });
});
