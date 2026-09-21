import { experimental_evaluate, generateText } from "ai";
import { z } from "zod";
import { apiFailure, requirePrincipal } from "@/lib/server/auth";
import { loadState } from "@/lib/server/state";

export const runtime = "nodejs";

const requestSchema = z.object({ message: z.string().trim().min(2).max(2000) });

function parseSinglePrice(message: string): number | null {
  const tagged = [...message.matchAll(/\$\s*([\d][\d.,]*)/g)].map((match) => match[1]);
  const candidates = tagged.length ? tagged : [...message.matchAll(/\b(?:a|por|precio|cuesta|vale)\s+([\d][\d.,]*)/gi)].map((match) => match[1]);
  if (candidates.length !== 1) return null;
  const digits = candidates[0].replace(/[.,]/g, "");
  const amount = Number(digits);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : null;
}

function exactMaterial(message: string, materials: { id: string; name: string }[]): string | null {
  const normalized = message.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  const found = materials.filter((material) => normalized.includes(material.name.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase()));
  return found.length === 1 ? found[0].id : null;
}

export async function POST(request: Request) {
  try {
    const principal = await requirePrincipal();
    const { message } = requestSchema.parse(await request.json());
    const state = await loadState(principal);
    const materialCriteria: Record<string, string> = Object.fromEntries(state.materials.map((material) => [material.id, `${material.name}, proveedor ${material.supplier || "desconocido"}`]));
    materialCriteria.none = "No named material can be identified from the message";
    let intent: "update" | "question" | "unclear" = "unclear";
    let materialId: string | null = exactMaterial(message, state.materials);
    let confidence: number | null = null;

    try {
      const result = await experimental_evaluate({
        model: "typesafe-ai/jev",
        state: { message, materials: state.materials.map((item) => ({ id: item.id, name: item.name, supplier: item.supplier })) },
        questions: {
          intent: { type: "choice", instructions: "What is the user's main intent in the Spanish manufacturing cost message?", criteria: { update: "Propose a new price for a material", question: "Ask for an explanation of costs or margin", unclear: "Neither intent is clear" } },
          material: { type: "choice", instructions: "Which existing material does the user refer to? Choose none if the message does not identify one.", criteria: materialCriteria },
        },
        abortSignal: AbortSignal.timeout(12_000),
      });
      intent = result.answers.intent.choice;
      const chosen = result.answers.material.choice;
      const probability = result.answers.material.probabilities?.[chosen];
      confidence = probability ?? null;
      if (chosen !== "none" && state.materials.some((item) => item.id === chosen) && (probability == null || probability >= 0.75)) materialId = chosen;
    } catch {
      // A failed model call never blocks the manual path or writes a cost.
      if (/\b(subi[oó]|aument[oó]|pagamos|nuevo precio|cambi[oó] de precio)\b/i.test(message)) intent = "update";
      else intent = "question";
    }

    const priceMinor = parseSinglePrice(message);
    if (intent === "update" || (materialId && priceMinor !== null)) {
      if (!materialId) return Response.json({ reply: "¿Qué insumo cambió? Escríbelo como aparece en la planilla para preparar la propuesta." });
      const material = state.materials.find((item) => item.id === materialId)!;
      if (priceMinor === null) return Response.json({ reply: `Identifiqué ${material.name}, pero necesito un único precio nuevo. Por ejemplo: “${material.name} cuesta $10.000 por ${material.purchaseUnit}”.` });
      const affected = state.components.filter((item) => item.materialId === materialId).length;
      return Response.json({
        reply: `Propongo actualizar ${material.name}: ${material.priceMinor ?? "sin precio"} → ${priceMinor} ${state.organization.currency} por ${material.purchaseUnit}. Afecta ${affected} producto${affected === 1 ? "" : "s"}. Añadí la propuesta al borrador: revísala en la planilla y confirma la fuente y fecha antes de aplicar.`,
        proposal: { kind: "material-price", materialId, priceMinor, confidence },
      });
    }

    try {
      const result = await generateText({
        model: "openai/gpt-6-astra",
        instructions: "Eres un asistente breve de costos para una PyME manufacturera. Responde en español claro, en máximo 100 palabras. Usa solo los datos proporcionados. Distingue costo de fabricación, precio de venta y margen estimado. Advierte si faltan datos. No inventes cifras ni sugieras que un cambio se aplicó. No des asesoría tributaria.",
        prompt: JSON.stringify({ question: message, organization: state.organization.name, products: state.products.map((item) => ({ name: item.name, lotUnits: item.lotUnits, salePrice: item.salePriceMinor })), materials: state.materials.map((item) => ({ name: item.name, price: item.priceMinor, unit: item.purchaseUnit })), expenses: state.expenses.map((item) => ({ name: item.name, amount: item.amountMinor, basis: item.allocationBasis })) }),
        abortSignal: AbortSignal.timeout(20_000),
      });
      return Response.json({ reply: result.text });
    } catch {
      return Response.json({ reply: "Puedo ayudarte a actualizar un insumo si me dices su nombre y nuevo precio. Para revisar los cálculos actuales, abre el detalle del producto en el dashboard." });
    }
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Mensaje inválido" }, { status: 400 });
    return apiFailure(error);
  }
}
