function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function assistantToolOutcome(output: unknown): string {
  if (output === undefined) return "Sin resultado registrado";
  const result = record(output);
  if (!result) return "Completada";
  if (typeof result.error === "string") return `Error: ${result.error}`;
  if (result.pendingReview === true) return "Pendiente de tu confirmación";
  if (result.unchanged === true) return "Sin cambios: ya estaba así";
  if (result.ok === true && Array.isArray(result.done) && result.done.length) return result.done.map(String).join(" · ");
  if (result.ok === true && "result" in result && "expression" in result) return `Resultado: ${String(result.result)}`;
  if (result.ok === true && result.saved === false) return "Simulación sin guardar";
  if (result.kind === "profile-draft") {
    return "Avance guardado en el mapa";
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
