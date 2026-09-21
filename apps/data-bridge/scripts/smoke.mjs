import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";

const url = process.env.BRIDGE_URL ?? "http://127.0.0.1:8787/internal/d1";
const secret = process.env.DATA_BRIDGE_SECRET ?? "local-test-secret-for-cozte-at-least-32-chars";

async function batch(statements) {
  const timestamp = String(Date.now());
  const body = JSON.stringify({ statements });
  const signature = createHmac("sha256", secret).update(`${timestamp}\n${body}`).digest("hex");
  return fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-cozte-time": timestamp, "x-cozte-signature": signature }, body });
}

const unauthorized = await fetch(url, { method: "POST", body: "{}" });
assert.equal(unauthorized.status, 401);

const organizationId = `smoke-${randomUUID()}`;
let response = await batch([{ sql: "INSERT INTO organizations (id, name) VALUES (?, ?)", params: [organizationId, "Smoke test"] }]);
assert.equal(response.status, 200);

const changeId = randomUUID();
response = await batch([
  { sql: "INSERT INTO change_sets (id, organization_id, idempotency_key, actor_id, expected_revision, payload_json) VALUES (?, ?, ?, ?, 0, '{}')", params: [changeId, organizationId, randomUUID(), "smoke"] },
  { sql: "INSERT INTO commit_assertions (change_set_id, valid) VALUES (?, 0)", params: [changeId] },
]);
assert.equal(response.status, 409);

response = await batch([{ sql: "SELECT id FROM change_sets WHERE id=?", params: [changeId] }]);
assert.equal(response.status, 200);
const result = await response.json();
assert.equal(result.results[0].length, 0, "failed batch must roll back completely");
const materialId = randomUUID();
response = await batch([{ sql: "INSERT INTO materials (id, organization_id, name, purchase_unit) VALUES (?, ?, 'Papel', 'resma')", params: [materialId, organizationId] }]);
assert.equal(response.status, 200);
response = await batch([{
  sql: `INSERT INTO cost_alerts (id, organization_id, material_id, kind, status, message)
    SELECT lower(hex(randomblob(16))), m.organization_id, m.id, 'stale_price', 'open', 'Verificar precio de ' || m.name
    FROM materials m LEFT JOIN material_prices p ON p.material_id=m.id AND p.version=m.version
    WHERE p.id IS NULL OR p.effective_date < date('now', '-30 days')
    ON CONFLICT (organization_id, material_id, kind) DO UPDATE SET
      status='open', message=excluded.message, last_checked_at=CURRENT_TIMESTAMP, resolved_at=NULL`,
}]);
assert.equal(response.status, 200, "freshness alert insertion must work");
response = await batch([{ sql: "SELECT status FROM cost_alerts WHERE material_id=?", params: [materialId] }]);
assert.equal((await response.json()).results[0][0].status, "open");
response = await batch([
  { sql: "INSERT INTO material_prices (id, organization_id, material_id, version, amount_minor, source, effective_date, actor_id) VALUES (?, ?, ?, 1, 10000, 'test', date('now'), 'smoke')", params: [randomUUID(), organizationId, materialId] },
  { sql: "UPDATE cost_alerts SET status='resolved', resolved_at=CURRENT_TIMESTAMP WHERE organization_id=? AND material_id=?", params: [organizationId, materialId] },
]);
assert.equal(response.status, 200);
response = await batch([{ sql: "SELECT status FROM cost_alerts WHERE material_id=?", params: [materialId] }]);
assert.equal((await response.json()).results[0][0].status, "resolved");
console.log("D1 bridge smoke test passed");
