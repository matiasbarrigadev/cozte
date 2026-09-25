import { describe, expect, it } from "vitest";
import { appPath, viewFromPathname, viewFromSegments } from "./app-routes";

describe("workspace URLs", () => {
  it("gives every section its own path and reads it back", () => {
    for (const view of ["dashboard", "planilla", "analisis", "comprobantes", "asistente", "historial"] as const) {
      expect(viewFromPathname(appPath(view))).toEqual({ view });
    }
    expect(appPath("analisis")).toBe("/app/analisis");
    expect(appPath("producto", "abc-1")).toBe("/app/productos/abc-1");
    expect(viewFromPathname("/app/productos/abc-1")).toEqual({ view: "producto", productId: "abc-1" });
    expect(viewFromPathname("/app/")).toEqual({ view: "dashboard" });
  });

  it("rejects unknown sections instead of guessing", () => {
    expect(viewFromSegments(["revision"])).toBeNull();
    expect(viewFromSegments(["costos", "extra"])).toBeNull();
    expect(viewFromPathname("/demo")).toBeNull();
  });
});
