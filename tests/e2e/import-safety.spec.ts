import { test, expect } from "@playwright/test";
test("rejects a CMB statement in ICBC, confirms unknown layouts, and avoids company-card suggestions", async ({
  page,
}) => {
  let approve = true;
  page.on("dialog", (d) => (approve ? void d.accept() : void d.dismiss()));
  await page.goto("./");
  await page
    .getByLabel("上传工商银行", { exact: true })
    .setInputFiles({
      name: "名称伪装为工行.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("交易日期,收入,支出,交易备注\n20260101,,10,人工构造"),
    });
  await expect(page.getByRole("alert")).toContainText("招商银行借记卡");
  await expect(page.locator(".file-editor")).toHaveCount(0);
  approve = false;
  await page
    .getByLabel("上传工商银行", { exact: true })
    .setInputFiles({
      name: "人工构造未知.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("日期,方向,金额,账户\n2026-01-01,支出,10,工商银行"),
    });
  await expect(page.locator(".notification")).toContainText("已取消导入");
  await expect(page.locator(".file-editor")).toHaveCount(0);
  approve = true;
  for (const [source, csv] of [
    [
      "随手记",
      "日期,方向,金额,账户\n2026-01-01,支出,10,招商活期\n2026-01-01,支出,5,招商银行公司卡",
    ],
    ["招商银行借记卡", "日期,方向,金额,账户\n2026-01-01,支出,10,招商活期"],
  ]) {
    await page
      .getByLabel("上传" + source, { exact: true })
      .setInputFiles({
        name: "人工构造-" + source + ".csv",
        mimeType: "text/csv",
        buffer: Buffer.from(csv),
      });
    await expect(page.locator(".notification")).toContainText("解析完成");
  }
  await expect(
    page.getByLabel("映射账户-招商活期", { exact: true }),
  ).toHaveValue("cmb:招商活期");
  await expect(
    page.getByLabel("映射账户-招商银行公司卡", { exact: true }),
  ).toHaveValue("");
  await page
    .getByLabel("映射账户-招商银行公司卡", { exact: true })
    .selectOption("cmb:招商活期");
  await expect(
    page.getByLabel("映射账户-招商银行公司卡", { exact: true }),
  ).toHaveValue("cmb:招商活期");
});
test("excludes trusted overlap from account totals and daily balances while preserving source trace", async ({
  page,
}) => {
  page.on("dialog", (d) => void d.accept());
  await page.goto("./");
  const ledger =
    "日期,方向,金额,账户,摘要\n2026-01-01,支出,10,工商银行,人工早餐\n2026-01-02,支出,20,工商银行,人工采购";
  const bank =
    "日期,方向,金额,账户,摘要,余额,银行交易编号\n2026-01-01,支出,10,工商银行,人工早餐,990,BANK-SYN-001\n2026-01-02,支出,20,工商银行,人工采购,970,BANK-SYN-002";
  for (const [source, name, csv] of [
    ["随手记", "人工构造账本.csv", ledger],
    ["工商银行", "人工构造月账单.csv", bank],
    ["工商银行", "人工构造年度账单.csv", "人工构造年度表\n" + bank],
  ]) {
    await page
      .getByLabel("上传" + source, { exact: true })
      .setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(csv) });
    await expect(page.locator(".notification")).toContainText("解析完成");
  }
  await expect(page.locator(".duplicate-notice")).toContainText("已排除 2 条");
  await page.getByRole("button", { name: "开始对账" }).click();
  await page.getByLabel("随手记期初余额", { exact: true }).fill("1000");
  await page
    .getByRole("checkbox", {
      name: "我已确认本账户在核对期间的账单完整，随手记包含收入、支出和转账",
    })
    .check();
  await expect(page.locator("#balance-results")).toContainText(
    "日终余额全部相等",
  );
  await page
    .getByRole("button", { name: "信用卡与逐笔核对", exact: true })
    .click();
  await expect(page.locator(".result-table")).toContainText(
    "可靠编号重复副本已排除",
  );
});
