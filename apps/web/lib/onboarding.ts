/** The first-time questions of a new company and what they start from (names already known, country if set). */
export type Onboarding = { needed: boolean; personName: string; companyName: string; country: string | null; /** The company's owner: the one who names it. */ owner: boolean };

/** The first word of a name, to greet the person. */
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? "";
