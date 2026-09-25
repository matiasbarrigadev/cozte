import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { dbBatch } from "./db";

describe("dbBatch transient failures", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    process.env.DATA_BRIDGE_URL = "http://bridge.test";
    process.env.DATA_BRIDGE_SECRET = "local-test-secret-for-cozte-at-least-32-chars";
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const ok = () => new Response(JSON.stringify({ results: [[{ id: 1 }]] }), { status: 200 });

  it("retries a read once when the connection drops", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("Network connection lost")).mockResolvedValueOnce(ok());
    await expect(dbBatch([{ sql: "SELECT 1" }])).resolves.toEqual([[{ id: 1 }]]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("never replays a write that may have reached D1", async () => {
    fetchMock.mockResolvedValueOnce(new Response("proxy failure", { status: 500 }));
    await expect(dbBatch([{ sql: "INSERT INTO t (id) VALUES (?)", params: [1] }])).rejects.toThrow("D1 bridge failed (500)");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a database error the bridge reported", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ requestId: "r1", cause: "D1_ERROR: boom" }), { status: 500 }));
    await expect(dbBatch([{ sql: "SELECT 1" }])).rejects.toThrow("D1 bridge failed (500) [r1]: D1_ERROR: boom");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
