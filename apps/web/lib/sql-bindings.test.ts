import { describe, expect, it } from "vitest";
import { assertSqlBindings, countSqlBindings } from "./sql-bindings";

describe("D1 statement bindings", () => {
  it("ignores literals, identifiers and comments", () => {
    expect(countSqlBindings("SELECT '?', \"?\", `?`, [?], ? -- ?\n, ? /* ? */")).toBe(2);
  });
  it("catches a missing snapshot value before sending a transaction", () => {
    expect(() => assertSqlBindings([{ sql: "INSERT INTO cost_snapshots (id, warnings_json, context_json) VALUES (?, ?, ?)", params: ["id", "context"] }])).toThrow("3 placeholders but 2 values");
    expect(() => assertSqlBindings([{ sql: "INSERT INTO cost_snapshots (id, warnings_json, context_json) VALUES (?, ?, ?)", params: ["id", "[]", "{}"] }])).not.toThrow();
  });
});
