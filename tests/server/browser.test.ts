import { beforeAll, afterAll, it, expect } from "vitest";
import { chromium, expect as ui } from "@playwright/test";
import { existsSync } from "node:fs";
import { createApp } from "../../server/app";
import { loadConfig } from "../../server/config";
import { database, migrate } from "../../server/database";
import type { Server } from "node:http";
const config = loadConfig({
  NODE_ENV: "test",
  DB_HOST: process.env.TEST_DB_HOST || "127.0.0.1",
  DB_PORT: process.env.TEST_DB_PORT || "33306",
  DB_DATABASE: process.env.TEST_DB_DATABASE || "reconcile_test",
  DB_USER: process.env.TEST_DB_USER || "reconcile_test",
  DB_PASSWORD: process.env.TEST_DB_PASSWORD || "synthetic-db-test-password",
  ADMIN_USERNAME: "owner",
  ADMIN_PASSWORD: "synthetic-admin-test-password",
  APP_ORIGIN: "http://127.0.0.1:5311",
});
if (!config.DB_DATABASE.startsWith("reconcile_test"))
  throw Error("Browser tests require isolated test database");
const pool = database(config);
let server: Server;
beforeAll(async () => {
  await migrate(pool, config);
  await pool.query("DELETE FROM reconcile_transactions");
  await pool.query("DELETE FROM reconcile_statements");
  await pool.query(
    "UPDATE reconcile_workspace SET revision=0,state=JSON_SET(state,'$.statementHashes',JSON_ARRAY()) WHERE id=1",
  );
  await new Promise<void>((resolve) => {
    server = createApp(pool, config).listen(5311, "127.0.0.1", () => resolve());
  });
});
afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((e) => (e ? reject(e) : resolve())),
  );
  await pool.end();
});
it("logs in, saves imported statements and balances, reloads, reviews audit, logs out and restores", async () => {
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined),
    args: ["--no-sandbox"],
  });
  try {
    const page = await browser.newPage();
    page.on("dialog", (d) => {
      if (d.message().includes("无法识别这份文件")) void d.accept();
    });
    const failures: string[] = [];
    page.on("pageerror", (e) => failures.push(e.message));
    await page.goto(config.APP_ORIGIN);
    await ui(page.getByRole("heading", { name: "登录你的账户" })).toBeVisible();
    await page.getByLabel("登录名", { exact: true }).fill("owner");
    await page
      .getByLabel("密码", { exact: true })
      .fill("synthetic-admin-test-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await ui(page.getByRole("heading", { name: /把流水对清/ })).toBeVisible();
    for (const [source, csv] of [
      [
        "随手记",
        "日期,方向,金额,账户,摘要,币种\n2026-01-01,支出,10,工商银行,人工构造,CNY",
      ],
      [
        "工商银行",
        "日期,方向,金额,账户,摘要,余额,币种\n2026-01-01,支出,10,工商银行,人工构造银行,990,CNY",
      ],
    ]) {
      await page.getByLabel("上传" + source, { exact: true }).setInputFiles({
        name: "人工构造-" + source + ".csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
      await ui(page.locator(".notification")).toContainText("解析完成");
    }
    await page.getByRole("button", { name: "开始对账" }).click();
    await page.getByLabel("随手记期初余额", { exact: true }).fill("1000");
    await page
      .getByRole("checkbox", {
        name: "我已确认本账户在核对期间的账单完整，随手记包含收入、支出和转账",
      })
      .check();
    await ui(
      page.getByRole("status", { name: "数据库保存状态" }),
    ).toContainText("已保存到数据库", { timeout: 15000 });
    await page.reload();
    await ui(page.locator(".file-editor")).toHaveCount(2);
    await page.getByRole("button", { name: "开始对账" }).click();
    await ui(page.getByLabel("随手记期初余额", { exact: true })).toHaveValue(
      "1000",
    );
    await ui(page.locator("#balance-results")).toContainText(
      "日终余额全部相等",
    );
    await page.getByRole("button", { name: "审计日志", exact: true }).click();
    await ui(page.getByRole("dialog")).toContainText("导入账单");
    await page.getByRole("button", { name: "关闭数据库窗口" }).click();
    await page.getByRole("button", { name: "已保存账单", exact: true }).click();
    await ui(page.getByRole("dialog")).toContainText("人工构造-工商银行.csv");
    await page.getByRole("button", { name: "关闭数据库窗口" }).click();
    await page.getByRole("button", { name: "退出登录", exact: true }).click();
    await ui(page.getByRole("heading", { name: "登录你的账户" })).toBeVisible();
    await ui(page.locator(".file-editor")).toHaveCount(0);
    await page
      .getByLabel("密码", { exact: true })
      .fill("synthetic-admin-test-password");
    await page.getByRole("button", { name: "登录", exact: true }).click();
    await ui(page.locator(".file-editor")).toHaveCount(2);
    expect(
      await page.evaluate(() => localStorage.length + sessionStorage.length),
    ).toBe(0);
    expect(failures).toEqual([]);
  } finally {
    await browser.close();
  }
});
