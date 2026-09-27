import { describe, expect, it } from "vitest";
import { getCozteLocaleGuidance } from "./cozte-response-guidance";

describe("guía de respuesta de Cozte", () => {
  it("usa la moneda como pista de vocabulario, no como prueba de país", () => {
    const guidance = getCozteLocaleGuidance("ARS");
    expect(guidance).toContain("Argentina");
    expect(guidance).toContain("no confirma el país");
    expect(guidance).toContain("No afirmes una ubicación inferida");
  });

  it("prefiere una ubicación registrada y evita inferirla desde monedas ambiguas", () => {
    expect(getCozteLocaleGuidance("CLP", true)).toContain("El perfil de la empresa ya contiene su ubicación");
    expect(getCozteLocaleGuidance("USD")).toContain("no permite inferir un país");
  });

  it("talks like people do where the company is, once its location is known", () => {
    const argentina = getCozteLocaleGuidance("ARS", false, { country: "AR", city: "Córdoba" });
    expect(argentina).toContain("La empresa está en Córdoba, Argentina");
    expect(argentina).toContain("Trato de vos");
    expect(argentina).not.toContain("setCompanyLocation");
    expect(getCozteLocaleGuidance("USD", false, { country: "MX" })).toContain("la usual allá es MXN");
    expect(getCozteLocaleGuidance("ARS")).toContain("setCompanyLocation");
  });
});
