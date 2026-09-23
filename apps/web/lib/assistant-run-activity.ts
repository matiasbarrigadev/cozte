function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function assistantToolOutcome(output: unknown): string {
  if (output === undefined) return "Sin resultado registrado";
  const result = record(output);
  if (!result) return "Completada";
  if (typeof result.error === "string") return `Error: ${result.error}`;
  if (result.kind === "profile-draft") {
    return Array.isArray(result.evaluableProducts) && result.evaluableProducts.length
      ? "Producto listo para evaluación; requiere revisión"
      : "Avance guardado como borrador";
  }
  if (result.applied === true) return "Cambio aplicado y guardado";
  const proposal = record(result.proposal);
  if (typeof proposal?.title === "string") return `Propuesta: ${proposal.title}`;
  if (typeof result.title === "string" && typeof result.proposalId === "string") return `Propuesta: ${result.title}`;
  if (proposal?.proposalId || typeof result.proposalId === "string") return "Propuesta creada para revisión";
  if (result.material) return "Insumo identificado";
  if ("confidence" in result) return "Insumo por confirmar";
  if (result.organization) return "Datos de costos revisados";
  if ("monthlyMinor" in result || "directPerFinishedUnitMinor" in result) return "Cálculo listo";
  return "Resultado disponible";
}
