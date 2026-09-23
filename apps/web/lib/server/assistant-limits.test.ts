import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { dbBatchMock } = vi.hoisted(() => ({ dbBatchMock: vi.fn() }));

vi.mock("./db", () => ({ dbBatch: dbBatchMock }));
vi.mock("server-only", () => ({}));

import { reserveAssistantRequest } from "./assistant-limits";

describe("assistant request limits", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-23T21:45:12.000Z"));
    dbBatchMock.mockReset().mockResolvedValue([[], []]);
  });

  afterEach(() => vi.useRealTimers());

  it("counts minute requests per user and daily requests across the organization", async () => {
    await reserveAssistantRequest({ userId: "user_123", organizationId: "org_456", role: "owner" });

    expect(dbBatchMock).toHaveBeenCalledWith([
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO assistant_request_limits"),
        params: ["org_456", "user_123", "minute:2026-09-23T21:45"],
      }),
      expect.objectContaining({
        sql: expect.stringContaining("INSERT INTO assistant_organization_request_limits"),
        params: ["org_456", "day:2026-09-23"],
      }),
    ]);
  });
});
