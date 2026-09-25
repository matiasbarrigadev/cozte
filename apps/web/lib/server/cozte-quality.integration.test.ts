import { existsSync, readFileSync } from "node:fs";
import { experimental_evaluate as evaluate } from "ai";
import { describe, expect, it } from "vitest";
import { QUALITY_QUESTIONS, qualityState, summarizeQuality, type QualityAnswers } from "@/lib/cozte-quality";

// Scores sample answers with TypeSafe Jev through the AI Gateway. Run with COZTE_QUALITY_TEST=1 and
// AI_GATEWAY_API_KEY in apps/web/.env.local.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = /^\s*(AI_GATEWAY_API_KEY)\s*=\s*(.*?)\s*$/.exec(line);
    if (match?.[2] && !process.env[match[1]]) process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, "$2");
  }
}
const enabled = Boolean(process.env.AI_GATEWAY_API_KEY && process.env.COZTE_QUALITY_TEST);

const score = async (level: "simple" | "advanced", answer: string) => {
  const result = await evaluate({
    model: "typesafe-ai/jev",
    state: qualityState({ level, userMessage: "Compramos una laptop para la oficina por 900000.", actions: ["recordPurchase: Compra registrada: Laptop, 900000 ARS (Inversión, Administración)"], answer }),
    questions: QUALITY_QUESTIONS,
  });
  const answers = result.answers as QualityAnswers;
  return { answers, summary: summarizeQuality(answers) };
};

describe.skipIf(!enabled)("Jev quality scoring", { timeout: 60_000 }, () => {
  it("tells an unexplained assumption from an explained, educational answer", async () => {
    const bare = await score("simple", "Listo, laptop registrada. Amortización lineal a 60 meses: $15.000 mensuales imputados a administración. Estructura mensual total: $2.146.667.");
    const good = await score("simple", "Guardé la laptop como una inversión, no como un gasto de este mes, porque la vas a usar varios años. Le puse 36 meses, que es lo habitual para una computadora: así cada mes suma $25.000 a tus gastos de administración. Si crees que te va a durar más, dime y lo cambio.\n\n> **Para entender:** lo que dura años no se paga de golpe en un mes: se reparte en el tiempo que lo usas.");
    console.log(JSON.stringify({ bare: bare.summary, good: good.summary }, null, 1));
    expect(bare.summary.explainsAssumptions!).toBeLessThan(good.summary.explainsAssumptions!);
    expect(bare.summary.teaches!).toBeLessThan(good.summary.teaches!);
    expect(good.summary.flags).toEqual([]);
  });
});
