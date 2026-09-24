/** Count positional SQL parameters without counting question marks in quoted text or comments. */
export function countSqlBindings(sql: string): number {
  let count = 0;
  let quote: "single" | "double" | "backtick" | "bracket" | null = null;
  let lineComment = false;
  let blockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const char = sql[i];
    const next = sql[i + 1];
    if (lineComment) { if (char === "\n") lineComment = false; continue; }
    if (blockComment) { if (char === "*" && next === "/") { blockComment = false; i++; } continue; }
    if (quote) {
      const closing = quote === "single" ? "'" : quote === "double" ? '"' : quote === "backtick" ? "`" : "]";
      if (char === closing) { if (next === closing) i++; else quote = null; }
      continue;
    }
    if (char === "-" && next === "-") { lineComment = true; i++; continue; }
    if (char === "/" && next === "*") { blockComment = true; i++; continue; }
    if (char === "'") quote = "single";
    else if (char === '"') quote = "double";
    else if (char === "`" ) quote = "backtick";
    else if (char === "[") quote = "bracket";
    else if (char === "?") count++;
  }
  return count;
}

export function assertSqlBindings(statements: { sql: string; params?: unknown[] }[]): void {
  statements.forEach(({ sql, params }, index) => {
    const expected = countSqlBindings(sql);
    const actual = params?.length ?? 0;
    if (expected !== actual) throw new Error(`D1 statement ${index + 1} has ${expected} placeholders but ${actual} values`);
  });
}
