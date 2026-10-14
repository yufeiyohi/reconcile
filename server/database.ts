import { createPool, type Pool, type PoolConnection } from "mysql2/promise";
import { readFileSync } from "node:fs";
import type { Config } from "./config";
import { hashPassword, validPasswordHash } from "./password";
export function database(config: Config): Pool {
  const pool = createPool({
    host: config.DB_HOST,
    port: config.DB_PORT,
    user: config.DB_USER,
    password: config.DB_PASSWORD,
    database: config.DB_DATABASE,
    connectionLimit: 5,
    connectTimeout: 10000,
    queueLimit: 20,
    charset: "utf8mb4",
    timezone: "Z",
    dateStrings: true,
    multipleStatements: false,
    // MySQL 8.0.24 stalls prepared SELECTs when query attributes are negotiated.
    // This app does not use query attributes; keep normal prepared parameters.
    flags: ["-CLIENT_QUERY_ATTRIBUTES"],
    ssl: config.DB_SSL_CA_FILE
      ? { ca: readFileSync(config.DB_SSL_CA_FILE), rejectUnauthorized: true }
      : undefined,
  });
  pool.on("connection", (connection) => {
    connection.query("SET time_zone = '+00:00'");
  });
  return pool;
}
export async function transaction<T>(
  pool: Pool,
  fn: (c: PoolConnection) => Promise<T>,
): Promise<T> {
  const c = await pool.getConnection();
  try {
    await c.beginTransaction();
    const result = await fn(c);
    await c.commit();
    return result;
  } catch (e) {
    await c.rollback();
    throw e;
  } finally {
    c.release();
  }
}
export const migrations = [
  `CREATE TABLE IF NOT EXISTS reconcile_users (id INT PRIMARY KEY, username VARCHAR(64) NOT NULL UNIQUE, password_hash VARCHAR(256) NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS reconcile_sessions (token_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY, user_id INT NOT NULL, expires_at DATETIME NOT NULL, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, INDEX(expires_at), FOREIGN KEY(user_id) REFERENCES reconcile_users(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS reconcile_statements (id INT AUTO_INCREMENT PRIMARY KEY, hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL UNIQUE, source VARCHAR(32) NOT NULL, name VARCHAR(255) NOT NULL, entry JSON NOT NULL, version INT NOT NULL DEFAULT 1, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS reconcile_transactions (id BIGINT AUTO_INCREMENT PRIMARY KEY, statement_id INT NOT NULL, account_name VARCHAR(255) NOT NULL, business_date DATE NULL, direction VARCHAR(16) NOT NULL, currency VARCHAR(16) NOT NULL, amount_minor DECIMAL(32,0) NOT NULL, balance_minor DECIMAL(32,0) NULL, record JSON NOT NULL, INDEX(statement_id), INDEX(account_name,business_date), FOREIGN KEY(statement_id) REFERENCES reconcile_statements(id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS reconcile_workspace (id INT PRIMARY KEY, revision INT NOT NULL DEFAULT 0, state JSON NOT NULL, updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
  `CREATE TABLE IF NOT EXISTS reconcile_audit (id BIGINT AUTO_INCREMENT PRIMARY KEY, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, actor VARCHAR(64) NOT NULL, action VARCHAR(32) NOT NULL, outcome VARCHAR(16) NOT NULL, target VARCHAR(128) NOT NULL DEFAULT '', ip VARCHAR(64) NOT NULL DEFAULT '', details JSON NOT NULL, INDEX(created_at))`,
];
export async function migrate(pool: Pool, config: Config) {
  // Explicit migration command; normal server startup never creates/replaces tables.
  for (const ddl of migrations) await pool.query(ddl);
  const [columns] = await pool.query(
    "SHOW COLUMNS FROM reconcile_transactions",
  );
  const existingColumns = new Set(
    (columns as { Field: string }[]).map((c) => c.Field),
  );
  if (!existingColumns.has("excluded_duplicate"))
    await pool.query(
      "ALTER TABLE reconcile_transactions ADD COLUMN excluded_duplicate TINYINT NOT NULL DEFAULT 0",
    );
  if (!existingColumns.has("duplicate_of"))
    await pool.query(
      "ALTER TABLE reconcile_transactions ADD COLUMN duplicate_of BIGINT NULL",
    );
  if (!existingColumns.has("duplicate_issue"))
    await pool.query(
      "ALTER TABLE reconcile_transactions ADD COLUMN duplicate_issue VARCHAR(16) NULL",
    );
  const [users] = await pool.query("SELECT id FROM reconcile_users WHERE id=1");
  if (!(users as unknown[]).length) {
    const hash =
      config.ADMIN_PASSWORD_HASH ||
      (config.ADMIN_PASSWORD ? await hashPassword(config.ADMIN_PASSWORD) : "");
    if (!validPasswordHash(hash))
      throw new Error("首次初始化须配置 ADMIN_PASSWORD_HASH 或 ADMIN_PASSWORD");
    await pool.execute(
      "INSERT INTO reconcile_users(id,username,password_hash) VALUES(1,?,?)",
      [config.ADMIN_USERNAME, hash],
    );
  }
  await pool.execute(
    "INSERT IGNORE INTO reconcile_workspace(id,state) VALUES(1,?)",
    [
      JSON.stringify({
        statementHashes: [],
        settings: {
          mappings: {},
          accountIds: [],
          start: "",
          end: "",
          tolerance: 0,
          dateBasis: "transactionDate",
          confirmedExternalIds: false,
        },
        manual: [],
        decisions: {},
        balanceInputs: {},
      }),
    ],
  );
}
export function json<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}
