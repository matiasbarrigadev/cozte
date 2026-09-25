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

  it("quita palabras sueltas en otro alfabeto que a veces agrega el modelo", () => {
    const html = renderToStaticMarkup(<AssistantMarkdown text={"La tela de filtrado フィルム cuesta ARS 348 por m²."} />);
    expect(html).toContain("La tela de filtrado cuesta ARS 348 por m².");
    expect(html).not.toContain("フィルム");
  });
});
