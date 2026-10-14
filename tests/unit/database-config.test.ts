import { expect, it } from "vitest";
import { database } from "../../server/database";
import { loadConfig } from "../../server/config";

it("does not negotiate query attributes that stall prepared SELECTs on MySQL 8.0.24", async () => {
  // Pools are lazy: this verifies the real driver's negotiated flags without
  // connecting to either a test database or the production database.
  const pool = database(loadConfig({
    DB_HOST: "127.0.0.1",
    DB_DATABASE: "reconcile_test",
    DB_USER: "synthetic-test-user",
    DB_PASSWORD: "synthetic-test-password",
  }));
  try {
    const driver = pool as unknown as {
      pool: { config: { connectionConfig: { clientFlags: number } } };
    };
    const queryAttributesFlag = 0x08000000;
    expect(driver.pool.config.connectionConfig.clientFlags & queryAttributesFlag).toBe(0);
  } finally {
    await pool.end();
  }
});
