import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
async function upload(page: Page, source: string, text: string) {
  await page.getByLabel(`上传${source}`, { exact: true }).setInputFiles({
    name: `人工构造-${source}.csv`,
    mimeType: "text/csv",
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole("status")).toContainText("解析完成");
}
test("reviews one account by closing balance, hides equal days, and shows expense corrections", async ({
  page,
}) => {
  await page.goto("./");
  await upload(
    page,
    "随手记",
    "日期,方向,金额,账户,摘要,商家,币种\n2026-01-01,支出,150,工商银行,账本支出,人工商家,CNY\n2026-01-01,收入,50,工商银行,合成收入,,CNY\n2026-01-02,支出,25,工商银行,超市,人工超市,CNY\n2026-01-03,支出,10,工商银行,咖啡,人工咖啡店,CNY\n2026-01-01,支出,5,招商活期,招行测试,,CNY",
  );
  await upload(
    page,
    "工商银行",
    "日期,方向,金额,账户,摘要,对方户名,余额,币种\n2026-01-01,支出,100,工商银行,银行支出,人工商家,900,CNY\n2026-01-02,支出,20,工商银行,超市,人工超市,880,CNY\n2026-01-03,支出,10,工商银行,咖啡,人工咖啡店,870,CNY",
  );
  await upload(
    page,
    "招商银行借记卡",
    "日期,方向,金额,账户,摘要,余额,币种\n2026-01-01,支出,5,招商活期,招行测试,95,CNY",
  );
  await page.getByRole("button", { name: "开始对账" }).click();
  const panel = page.locator("#balance-results");
  await expect(panel).toBeVisible();
  await page.getByLabel("余额核对账户").selectOption("icbc:工商银行");
  await page.getByLabel("随手记期初余额", { exact: true }).fill("1000");
  await page
    .getByRole("checkbox", {
      name: "我已确认本账户在核对期间的账单完整，随手记包含收入、支出和转账",
    })
    .check();
  await expect(panel.locator(".balance-day")).toHaveCount(2);
  await expect(panel.locator(".balance-day > summary").first()).toContainText(
    "2026-01-02",
  );
  await panel.locator(".balance-day > summary").first().click();
  await expect(
    panel.locator(".balance-day[open] .balance-expenses"),
  ).toContainText("可能金额填错");
  await expect(
    panel.locator(".balance-day[open] .balance-expenses"),
  ).toContainText("人工超市");
  await expect(
    panel.locator(".balance-day[open] .balance-expenses"),
  ).toContainText("银行 20.00 元；随手记 25.00 元");
  await page.getByLabel("显示余额相等的日期").check();
  await expect(panel.locator(".balance-day")).toHaveCount(3);
  await panel.locator(".balance-day > summary").first().click();
  await expect(panel.locator(".balance-equal")).toContainText("无需逐笔提示");
  await expect(panel.locator(".balance-equal .balance-expenses")).toHaveCount(
    0,
  );
  await page.getByLabel("余额核对账户").selectOption("cmb:招商活期");
  await expect(page.getByLabel("随手记期初余额", { exact: true })).toHaveValue(
    "",
  );
  await page.getByLabel("随手记期初余额", { exact: true }).fill("100");
  await page
    .getByRole("checkbox", {
      name: "我已确认本账户在核对期间的账单完整，随手记包含收入、支出和转账",
    })
    .check();
  await expect(panel.locator(".balance-equal > summary")).toContainText(
    "95.00",
  );
  await page.getByLabel("余额核对账户").selectOption("icbc:工商银行");
  await expect(page.getByLabel("随手记期初余额", { exact: true })).toHaveValue(
    "1000",
  );
  await upload(
    page,
    "随手记",
    "日期,方向,金额,账户,摘要,商家,币种\n2026-01-01,支出,150,工商银行,账本支出,人工商家,CNY\n2026-01-01,收入,50,工商银行,合成收入,,CNY\n2026-01-02,支出,20,工商银行,超市,人工超市,CNY\n2026-01-03,支出,10,工商银行,咖啡,人工咖啡店,CNY\n2026-01-01,支出,5,招商活期,招行测试,,CNY",
  );
  await page.getByRole("button", { name: "开始对账" }).click();
  await page.getByLabel("余额核对账户").selectOption("icbc:工商银行");
  await expect(page.getByLabel("随手记期初余额", { exact: true })).toHaveValue(
    "1000",
  );
  await expect(panel.locator(".balance-day")).toHaveCount(0);
  await expect(panel).toContainText("日终余额全部相等");
  await page.setViewportSize({ width: 375, height: 812 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("missing payment balance stays unknown until a verified daily balance is supplied", async ({
  page,
}) => {
  await page.goto("./");
  await upload(
    page,
    "随手记",
    "日期,方向,金额,账户,摘要,币种\n2026-01-01,支出,10,微支付,人工构造,CNY",
  );
  await upload(
    page,
    "微信支付",
    "日期,方向,金额,账户,摘要,币种,支付方式\n2026-01-01,支出,10,微支付,人工构造微信,CNY,零钱",
  );
  await page.getByRole("button", { name: "开始对账" }).click();
  await page.getByLabel("随手记期初余额", { exact: true }).fill("100");
  await page
    .getByRole("checkbox", {
      name: "我已确认本账户在核对期间的账单完整，随手记包含收入、支出和转账",
    })
    .check();
  await expect(page.locator(".balance-day")).toHaveClass(/balance-unknown/);
  await page.locator(".balance-day > summary").click();
  await page.getByLabel("2026-01-01银行日终余额").fill("90");
  await page.getByRole("button", { name: "确认此日余额" }).click();
  await expect(page.locator(".balance-day")).toHaveCount(0);
  await expect(page.locator("#balance-results")).toContainText(
    "日终余额全部相等",
  );
});
