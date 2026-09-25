/** Questions Cozte shows as a form (the askQuestions tool) and the reply the person sends back. */
export type CozteQuestion = { question: string; options: string[]; multiple: boolean };
export type CozteQuestionSet = { intro?: string; questions: CozteQuestion[] };
export type CozteQuestionAnswer = { choices: string[]; other: string };

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

/** Reads the tool input defensively: it comes from the model and from stored history. */
export function parseCozteQuestions(input: unknown): CozteQuestionSet | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  if (!Array.isArray(record.questions)) return null;
  const questions = record.questions.flatMap((item): CozteQuestion[] => {
    if (!item || typeof item !== "object") return [];
    const entry = item as Record<string, unknown>;
    const question = text(entry.question);
    const options = Array.isArray(entry.options) ? [...new Set(entry.options.map(text).filter(Boolean))] : [];
    return question ? [{ question, options, multiple: entry.multiple === true }] : [];
  });
  if (!questions.length) return null;
  const intro = text(record.intro);
  return intro ? { intro, questions } : { questions };
}

export function answered(answer: CozteQuestionAnswer | undefined): boolean {
  return Boolean(answer && (answer.choices.length || answer.other.trim()));
}

/** The message sent on the person's behalf: one line per question, in the order asked. */
export function formatCozteAnswers(set: CozteQuestionSet, answers: (CozteQuestionAnswer | undefined)[]): string {
  const lines = set.questions.map((question, index) => {
    const answer = answers[index];
    const parts = [...(answer?.choices ?? []), ...(answer?.other.trim() ? [answer.other.trim()] : [])];
    return `- ${question.question} → ${parts.length ? parts.join("; ") : "prefiero no responder por ahora"}`;
  });
  return ["Mis respuestas:", ...lines].join("\n");
}
