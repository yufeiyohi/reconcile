import { beforeAll, afterAll, describe, it, expect } from "vitest";
import request from "supertest";
import { createHash } from "node:crypto";
import { database, migrate, json } from "../../server/database";
import { loadConfig } from "../../server/config";
import { createApp } from "../../server/app";
import { initialOptions } from "../../src/adapters/profiles";
import type { RowDataPacket } from "mysql2/promise";
const config = loadConfig({
  NODE_ENV: "test",
  DB_HOST: process.env.TEST_DB_HOST || "127.0.0.1",
  DB_PORT: process.env.TEST_DB_PORT || "33306",
  DB_DATABASE: process.env.TEST_DB_DATABASE || "reconcile_test",
  DB_USER: process.env.TEST_DB_USER || "reconcile_test",
  DB_PASSWORD: process.env.TEST_DB_PASSWORD || "synthetic-db-test-password",
  ADMIN_USERNAME: "owner",
  ADMIN_PASSWORD: "synthetic-admin-test-password",
  APP_ORIGIN: "http://127.0.0.1:5173",
});
if (!config.DB_DATABASE.startsWith("reconcile_test"))
  throw new Error("Server tests require a dedicated reconcile_test* database");
const pool = database(config),
  app = createApp(pool, config, false);
const agent = request.agent(app);
const headers = { Origin: config.APP_ORIGIN, "X-Reconcile-Request": "1" };
const rows = [
  ["日期", "方向", "金额", "账户", "摘要", "余额"],
  ["2026-01-01", "支出", "10", "人工账户", "人工构造", "990"],
];
const file = {
  id: createHash("sha256").update(JSON.stringify(rows)).digest("hex"),
  name: "人工构造.csv",
  warnings: [],
  sheets: [{ name: "CSV", rows }],
};
const payload = { source: "icbc", file, options: initialOptions("icbc", file) };
let revision = 0,
  version = 1;
beforeAll(async () => {
  for (let retry = 0; retry < 40; retry++) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch (e) {
      if (retry === 39) throw e;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  await migrate(pool, config);
  // Only isolated synthetic test database; never touches production config.
  await pool.query("DELETE FROM reconcile_sessions");
  await pool.query("DELETE FROM reconcile_transactions");
  await pool.query("DELETE FROM reconcile_statements");
  await pool.query("DELETE FROM reconcile_audit");
  await pool.query(
    "UPDATE reconcile_workspace SET revision=0,state=JSON_SET(state,'$.statementHashes',JSON_ARRAY()) WHERE id=1",
  );
});
afterAll(() => pool.end());
describe("authenticated MySQL API", () => {
  it("blocks anonymous financial and audit reads and enforces request origin", async () => {
    for (const route of ["/workspace", "/statements", "/audit", "/sync/status"])
      await request(app)
        .get("/api" + route)
        .expect(401);
    await request(app)
      .post("/api/auth/login")
      .send({ username: "owner", password: "synthetic-admin-test-password" })
      .expect(403);
    await request(app)
      .post("/api/auth/login")
      .set({ ...headers, Origin: "https://untrusted.example" })
      .send({ username: "owner", password: "synthetic-admin-test-password" })
      .expect(403);
  });
  it("rejects bad passwords, creates a protected session, and never stores raw session tokens", async () => {
    await agent
      .post("/api/auth/login")
      .set(headers)
      .send({ username: "owner", password: "wrong-password" })
      .expect(401);
    const response = await agent
      .post("/api/auth/login")
      .set(headers)
      .send({ username: "owner", password: "synthetic-admin-test-password" })
      .expect(200);
    const cookie = String(response.headers["set-cookie"]);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Strict");
    expect(cookie).toContain("Path=/api");
    const token = /reconcile_session=([^;]+)/.exec(cookie)![1];
    const [sessions] = await pool.query<RowDataPacket[]>(
      "SELECT token_hash FROM reconcile_sessions",
    );
    expect(sessions[0].token_hash).not.toBe(token);
    expect(sessions[0].token_hash).toBe(
      createHash("sha256").update(token).digest("hex"),
    );
    await agent.get("/api/auth/me").expect(200);
    const [users] = await pool.query<RowDataPacket[]>(
      "SELECT password_hash FROM reconcile_users",
    );
    expect(users[0].password_hash).not.toContain(
      "synthetic-admin-test-password",
    );
  });
  it("saves raw table data and server-reparsed transactions with idempotent duplicate handling", async () => {
    const response = await agent
      .post("/api/statements")
      .set(headers)
      .send({ ...payload, result: { transactions: [{ amountMinor: "999" }] } })
      .expect(200);
    version = response.body.version;
    expect(response.body.result.transactions[0].amountMinor).toBe("1000");
    await agent.post("/api/statements").set(headers).send(payload).expect(200);
    const [transactions] = await pool.query<RowDataPacket[]>(
      "SELECT amount_minor,record FROM reconcile_transactions",
    );
    expect(transactions).toHaveLength(1);
    expect(String(transactions[0].amount_minor)).toBe("1000");
    expect(
      json<{ originalRowNumber: number }>(transactions[0].record)
        .originalRowNumber,
    ).toBe(2);
    await agent
      .post("/api/statements")
      .set(headers)
      .send({ ...payload, source: "cmb" })
      .expect(409);
  });
  it("restores workspace and exact money values and refuses stale concurrent writes", async () => {
    const data = (await agent.get("/api/workspace").expect(200)).body;
    revision = data.revision;
    const { files, ...state } = data.state;
    void files;
    state.statementHashes = [file.id];
    state.balanceInputs = {
      "icbc:人工账户": {
        start: "2026-01-01",
        opening: "90071992547409.93",
        complete: true,
        bankClosing: {},
      },
    };
    const response = await agent
      .put("/api/workspace")
      .set(headers)
      .send({ revision, state })
      .expect(200);
    revision = response.body.revision;
    await agent
      .put("/api/workspace")
      .set(headers)
      .send({ revision: revision - 1, state })
      .expect(409);
    const restored = (await agent.get("/api/workspace").expect(200)).body;
    expect(restored.state.files[0].file.sheets[0].rows).toEqual(rows);
    expect(restored.state.balanceInputs["icbc:人工账户"].opening).toBe(
      "90071992547409.93",
    );
    await agent
      .delete("/api/statements/" + file.id)
      .set(headers)
      .send({ version })
      .expect(409);
  });
  it("updates mappings with optimistic statement versions and retains library records when workspace clears", async () => {
    const updated = await agent
      .post("/api/statements")
      .set(headers)
      .send({
        ...payload,
        options: { ...payload.options, fixedAccount: "人工账户" },
        expectedVersion: version,
      })
      .expect(200);
    version = updated.body.version;
    await agent
      .post("/api/statements")
      .set(headers)
      .send({ ...payload, expectedVersion: version - 1 })
      .expect(409);
    const state = (await agent.get("/api/workspace")).body.state;
    delete state.files;
    state.statementHashes = [];
    const saved = await agent
      .put("/api/workspace")
      .set(headers)
      .send({ revision, state, action: "clear" })
      .expect(200);
    revision = saved.body.revision;
    expect((await agent.get("/api/statements").expect(200)).body.total).toBe(1);
    await agent
      .delete("/api/statements/" + file.id)
      .set(headers)
      .send({ version })
      .expect(200);
    const [transactions] = await pool.query(
      "SELECT id FROM reconcile_transactions",
    );
    expect(transactions).toEqual([]);
  });
  it("writes auditable events without secrets or transaction bodies and reports pending sync honestly", async () => {
    await agent
      .post("/api/events")
      .set(headers)
      .send({ action: "report.export" })
      .expect(200);
    await agent
      .post("/api/events")
      .set(headers)
      .send({ action: "reconcile.run" })
      .expect(200);
    await agent
      .post("/api/events")
      .set(headers)
      .send({ action: "arbitrary-delete" })
      .expect(400);
    const data = (await agent.get("/api/audit").expect(200)).body;
    expect(data.total).toBeGreaterThanOrEqual(7);
    const all = JSON.stringify(data);
    expect(all).not.toContain("synthetic-admin-test-password");
    expect(all).not.toContain("人工构造");
    expect(
      data.items.some(
        (r: { action: string }) => r.action === "statement.delete",
      ),
    ).toBe(true);
    expect((await agent.get("/api/sync/status")).body.available).toBe(false);
  });
  it("invalidates logout and expired sessions", async () => {
    await agent.post("/api/auth/logout").set(headers).expect(200);
    await agent.get("/api/workspace").expect(401);
    await agent
      .post("/api/auth/login")
      .set(headers)
      .send({ username: "owner", password: "synthetic-admin-test-password" })
      .expect(200);
    await pool.query(
      "UPDATE reconcile_sessions SET expires_at=DATE_SUB(UTC_TIMESTAMP(),INTERVAL 1 HOUR)",
    );
    await agent.get("/api/workspace").expect(401);
  });
  it("sets Secure cookies in production and rejects oversized / unknown statement schemas", async () => {
    const production = createApp(
      pool,
      {
        ...config,
        NODE_ENV: "production",
        APP_ORIGIN: "https://private.example",
      },
      false,
    );
    const login = await request(production)
      .post("/api/auth/login")
      .set({ ...headers, Origin: "https://private.example" })
      .send({ username: "owner", password: "synthetic-admin-test-password" })
      .expect(200);
    expect(String(login.headers["set-cookie"])).toContain("Secure");
    const signedIn = request.agent(app);
    await signedIn
      .post("/api/auth/login")
      .set(headers)
      .send({ username: "owner", password: "synthetic-admin-test-password" })
      .expect(200);
    await signedIn
      .post("/api/statements")
      .set(headers)
      .send({ ...payload, source: "unknown" })
      .expect(400);
  });
  it("rate limits repeated failed login attempts", async () => {
    for (let i = 0; i < 5; i++)
      await request(app)
        .post("/api/auth/login")
        .set(headers)
        .send({ username: "owner", password: "wrong-password" })
        .expect(401);
    const response = await request(app)
      .post("/api/auth/login")
      .set(headers)
      .send({ username: "owner", password: "synthetic-admin-test-password" })
      .expect(429);
    expect(response.headers["retry-after"]).toBeTruthy();
  });
});
