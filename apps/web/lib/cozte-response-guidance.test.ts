import { describe, expect, it } from "vitest";
import { COZTE_INFORMATION_POLICY, COZTE_RESPONSE_STYLE_RULES, getCozteLocaleGuidance } from "./cozte-response-guidance";

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

  it("prioriza concisión, lenguaje común y resultados comprobados", () => {
    expect(COZTE_RESPONSE_STYLE_RULES).toContain("no más de 55 palabras");
    expect(COZTE_RESPONSE_STYLE_RULES).toContain("Nunca muestres nombres de herramientas");
    expect(COZTE_RESPONSE_STYLE_RULES).toContain("Verifica el estado actual");
  });

  it("separa intención conversacional de estado vigente", () => {
    expect(COZTE_INFORMATION_POLICY).toContain("PARA ENTENDER LA INTENCIÓN");
    expect(COZTE_INFORMATION_POLICY).toContain("PARA CONOCER EL ESTADO REAL");
    expect(COZTE_INFORMATION_POLICY).toContain("no evidencia del estado");
    expect(COZTE_INFORMATION_POLICY).toContain("lectura exitosa más reciente");
  });
});
