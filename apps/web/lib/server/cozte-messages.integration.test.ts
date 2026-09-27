import { beforeAll, describe, expect, it, vi } from "vitest";

// Runs the chat's message storage (import of old conversations, pages, archive, search) against a local D1 bridge when COZTE_BRIDGE_TEST_URL is set.
const bridgeUrl = process.env.COZTE_BRIDGE_TEST_URL;
vi.mock("server-only", () => ({}));
vi.mock("./assistant-trace", async (original) => ({ ...(await original<typeof import("./assistant-trace")>()), addAssistantToolEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./fx", () => ({ officialFxTable: async () => ({ asOf: new Date().toISOString(), rates: { USD: 1 }, source: "FXRatesAPI" }), quotesFor: () => ({}) }));

import type { UIMessage } from "ai";
import { createCozteTools } from "./cozte-agent-tools";
import { archiveMessages, loadMessagePage, loadRecentMessages, saveMessages, searchMessages } from "./cozte-messages";
import { dbBatch } from "./db";
import { messageCreatedAt, withCreatedAt } from "@/lib/cozte-conversation-memory";

const text = (id: string, role: "user" | "assistant", body: string): UIMessage => ({ id, role, parts: [{ type: "text", text: body }] });

describe.skipIf(!bridgeUrl)("chat messages against D1", { timeout: 90_000 }, () => {
  const principal = { userId: "tester", organizationId: `org-test-${crypto.randomUUID()}`, role: "owner" as const };
  const tools = createCozteTools(principal, crypto.randomUUID());
  // Run ids are global in the run log, so each test run uses its own.
  const runId = crypto.randomUUID();
  const answerId = `cozte-v2-${runId}`;

  beforeAll(async () => {
    process.env.DATA_BRIDGE_URL = bridgeUrl;
    process.env.DATA_BRIDGE_SECRET = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";
    await (tools.readCosts.execute as (input: unknown, options: { toolCallId: string }) => Promise<unknown>)({}, { toolCallId: "setup" });
    // A conversation stored the old way (one JSON value), with an archive, and the run log that dates it.
    const archived = [text("old-u", "user", "El proveedor de soja se llama Granos del Sur"), text("cozte-v2-run-old", "assistant", "Anotado, Granos del Sur.")];
    const current = [text("u1", "user", "Mañana tengo reunión con el contador"), text(answerId, "assistant", "¡Suerte en la reunión! Nos vemos mañana.")];
    await dbBatch([
      { sql: "INSERT INTO assistant_conversation_archives (id, organization_id, user_id, messages_json, created_at) VALUES (?, ?, ?, ?, '2026-09-01 10:00:00')", params: [crypto.randomUUID(), principal.organizationId, principal.userId, JSON.stringify(archived)] },
      { sql: "INSERT INTO assistant_conversations (organization_id, user_id, messages_json) VALUES (?, ?, ?) ON CONFLICT (organization_id, user_id) DO UPDATE SET messages_json=excluded.messages_json", params: [principal.organizationId, principal.userId, JSON.stringify(current)] },
      { sql: "INSERT INTO assistant_runs (id, organization_id, user_id, message_id, model_id, settings_json, status, started_at, finished_at) VALUES (?, ?, ?, 'u1', 'test', '{}', 'completed', '2026-09-26 23:10:00', '2026-09-26 23:11:30')", params: [runId, principal.organizationId, principal.userId] },
    ]);
  });

  it("imports the old conversation once, dated from the run log, with its archive kept apart", async () => {
    const page = await loadMessagePage(principal, { limit: 20 });
    expect(page.messages.map((message) => message.id)).toEqual(["u1", answerId]);
    expect(page.hasMore).toBe(false);
    expect(messageCreatedAt(page.messages[0])).toBe("2026-09-26T23:10:00.000Z");
    expect(messageCreatedAt(page.messages[1])).toBe("2026-09-26T23:11:30.000Z");
    // Loading again does not import twice.
    expect((await loadMessagePage(principal, { limit: 20 })).messages).toHaveLength(2);
  });

  it("stores new messages with their time, keeps the first time on update, and pages from the latest", async () => {
    for (let index = 0; index < 25; index += 1) await saveMessages(principal, [withCreatedAt(text(`m${index}`, index % 2 ? "assistant" : "user", `Mensaje número ${index}`), new Date(Date.UTC(2026, 8, 27, 12, index)).toISOString())]);
    await saveMessages(principal, [withCreatedAt(text("m3", "assistant", "Mensaje número 3, corregido"), "2030-01-01T00:00:00.000Z")]);
    const latest = await loadMessagePage(principal, { limit: 20 });
    expect(latest.messages).toHaveLength(20);
    expect(latest.messages.at(-1)?.id).toBe("m24");
    expect(latest.hasMore).toBe(true);
    const older = await loadMessagePage(principal, { before: latest.messages[0].id, limit: 20 });
    expect(older.messages.map((message) => message.id)).toEqual(["u1", answerId, "m0", "m1", "m2", "m3", "m4"]);
    expect(older.hasMore).toBe(false);
    const corrected = older.messages.find((message) => message.id === "m3")!;
    expect(corrected.parts).toEqual([{ type: "text", text: "Mensaje número 3, corregido" }]);
    expect(messageCreatedAt(corrected)).toBe("2026-09-27T12:03:00.000Z");
    expect((await loadRecentMessages(principal, 3)).map((message) => message.id)).toEqual(["m22", "m23", "m24"]);
  });

  it("searches every conversation without accents, archived ones included, most recent first", async () => {
    const found = await searchMessages(principal, { query: "reunion" });
    expect(found.map((match) => match.messageId)).toEqual([answerId, "u1"]);
    expect(found[1]).toMatchObject({ role: "user", archived: false, createdAt: "2026-09-26T23:10:00.000Z" });
    const archived = await searchMessages(principal, { query: "granos sur" });
    expect(archived.map((match) => [match.messageId, match.archived])).toEqual([["cozte-v2-run-old", true], ["old-u", true]]);
    expect(await searchMessages(principal, { query: "reunion", from: "2026-09-27" })).toEqual([]);
    const output = await (tools.searchConversation.execute as (input: unknown, options: { toolCallId: string }) => Promise<{ ok: boolean; matches: { when: string; who: string; conversation: string }[] }>)({ query: "contador" }, { toolCallId: "search" });
    expect(output.ok).toBe(true);
    expect(output.matches[0]).toMatchObject({ who: "la persona", conversation: "actual" });
  });

  it("archives the current conversation on a new one, and it stays searchable", async () => {
    expect(await archiveMessages(principal)).toBe(true);
    expect((await loadMessagePage(principal, { limit: 20 })).messages).toEqual([]);
    expect(await archiveMessages(principal)).toBe(false);
    expect((await searchMessages(principal, { query: "contador" }))[0]?.archived).toBe(true);
  });
});
