import type { ModelCallStreamPart } from "@ai-sdk/workflow";

type Execution = { toolName: string; output: unknown; input?: unknown };

const writes = new Set(["updateMaterialPrice", "updateExpenseAmount", "updateProductionMap", "upsertProductDraft", "applyCostAction"]);
const successClaim = /\b(?:cree|guarde|actualice|registre|aplique|cargue|incorpore|elimine|hice|deje)\b|\b(?:se|ya)\s+(?:creo|guardo|actualizo|registro|aplico|cargo)\b|\b(?:quedo|quedaron)\s+(?:cread[oa]s?|guardad[oa]s?|actualizad[oa]s?)\b/i;
const productCreationClaim = /\b(?:cree|creo|creado|creada|creados|creadas)\b.{0,40}\b(?:producto|productos|ficha|fichas)\b|\b(?:producto|productos|ficha|fichas)\b.{0,30}\b(?:creado|creada|creados|creadas)\b/i;

export function verifiedCozteResponse(response: string, executions: Execution[]): string {
  const plain = response.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!successClaim.test(plain) && !productCreationClaim.test(plain)) return response;
  const failed = executions.some(({ toolName, output }) => writes.has(toolName) && output && typeof output === "object" && "error" in output);
  if (productCreationClaim.test(plain) && !executions.some(({ toolName, input, output }) => {
    if (toolName !== "applyCostAction" || !output || typeof output !== "object" || (output as Record<string, unknown>).applied !== true) return false;
    const change = input && typeof input === "object" ? (input as Record<string, unknown>).change : null;
    return !!change && typeof change === "object" && ["create-product", "create-products"].includes(String((change as Record<string, unknown>).action));
  })) {
    const draftSaved = executions.some(({ toolName, output }) => ["upsertProductDraft", "updateProductionMap"].includes(toolName) && !!output && typeof output === "object" && ["building", "applied"].includes(String((output as Record<string, unknown>).status)));
    if (draftSaved) return "Guardé el avance en el mapa de producción, pero todavía no creé una ficha de producto en los costos operativos. Para eso necesito completar sus datos pendientes.";
    return failed ? "No pude crear la ficha del producto: ocurrió un problema al guardar los costos." : "Todavía no creé la ficha del producto. Necesito completar sus datos pendientes antes de confirmarte el alta.";
  }
  const saved = executions.some(({ toolName, output }) => {
    if (!writes.has(toolName) || !output || typeof output !== "object") return false;
    const receipt = output as Record<string, unknown>;
    return !receipt.error && (receipt.applied === true || receipt.status === "applied" || receipt.status === "building");
  });
  if (saved) return response;
  return failed
    ? "No pude guardar el cambio: ocurrió un problema al actualizar los costos. Tus datos siguen disponibles en la conversación; no voy a decirte que quedó hecho hasta confirmarlo."
    : "Todavía no guardé ese cambio. Revisé el estado actual, pero necesito completar la acción o confirmar los datos que faltan antes de decirte que quedó hecho.";
}

/** Forward tool activity immediately; only release assistant prose after checking write receipts. */
export function createCozteVerifiedStreamTransform(): TransformStream<ModelCallStreamPart, ModelCallStreamPart> {
  let text = "";
  let textId = "cozte-verified-response";
  const executions: Execution[] = [];
  return new TransformStream<ModelCallStreamPart, ModelCallStreamPart>({
    transform(part, controller) {
      if (part.type === "reset-step") text = "";
      if (part.type === "text-start") { textId = part.id; return; }
      if (part.type === "text-delta") { text += part.text; return; }
      if (part.type === "text-end") return;
      if (part.type === "tool-result") executions.push({ toolName: part.toolName, input: part.input, output: part.output });
      controller.enqueue(part);
    },
    flush(controller) {
      const answer = verifiedCozteResponse(text, executions);
      if (!answer) return;
      controller.enqueue({ type: "text-start", id: textId });
      controller.enqueue({ type: "text-delta", id: textId, text: answer });
      controller.enqueue({ type: "text-end", id: textId });
    },
  });
}
