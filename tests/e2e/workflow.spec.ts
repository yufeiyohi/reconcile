import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
const synthetic = (rows: string[]) =>
  "日期,方向,金额,账户,摘要,币种\n" + rows.join("\n");
async function upload(
  page: Page,
  source: string,
  name: string,
  content: string,
) {
  await page.getByLabel(`上传${source}`, { exact: true }).setInputFiles({
    name,
    mimeType: "text/csv",
    buffer: Buffer.from(content),
  });
  // Fields are detected and parsed on import; no confirmation click needed.
  await expect(page.getByRole("status")).toContainText("解析完成");
}
test("complete import, account separation, trace, export, replace and clear flow on a subpath", async ({
  page,
}) => {
  const external: string[] = [],
    errors: string[] = [];
  page.on("request", (r) => {
    if (
      !r.url().startsWith("http://127.0.0.1:4173") &&
      !r.url().startsWith("blob:") &&
      !r.url().startsWith("data:")
    )
      external.push(r.url());
    expect(["POST", "PUT", "PATCH"]).not.toContain(r.method());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("./");
  await expect(page.getByRole("heading", { name: /把流水对清/ })).toBeVisible();
  await upload(
    page,
    "随手记",
    "人工构造-账本.csv",
    synthetic([
      "2026-01-01,收入,100,工行账本,工资,CNY",
      "2026-01-10,支出,50,工行账本,账本多记,CNY",
      "2026-01-31,收入,1,工行账本,利息,CNY",
      "2026-01-01,支出,10,现金,早餐,CNY",
      "2026-01-01,收入,20,招行账本,存入,CNY",
      "2026-01-31,收入,1,招行账本,利息,CNY",
    ]),
  );
  await upload(
    page,
    "工商银行",
    "人工构造-工行.csv",
    synthetic([
      "2026-01-01,收入,100,银行A,工资,CNY",
      "2026-01-20,支出,50,银行A,银行缺记,CNY",
      "2026-01-31,收入,1,银行A,利息,CNY",
    ]),
  );
  await upload(
    page,
    "招商银行借记卡",
    "人工构造-招行.csv",
    synthetic([
      "2026-01-01,收入,20,银行B,存入,CNY",
      "2026-01-31,收入,1,银行B,利息,CNY",
    ]),
  );
  await page.getByLabel("映射账户-工行账本").selectOption("icbc:银行A");
  await page.getByLabel("映射账户-招行账本").selectOption("cmb:银行B");
  await page.getByRole("button", { name: "开始对账" }).click();
  await expect(
    page.getByRole("heading", { name: "对账结果", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".result-table")).toContainText("疑似漏记");
  await expect(page.locator(".result-table")).toContainText("疑似多记");
  await expect(page.locator(".result-table")).toContainText("未纳入本次对账");
  await page.getByRole("button", { name: "查看详情" }).first().click();
  await expect(page.getByRole("dialog")).toContainText("第");
  await expect(page.getByRole("dialog")).toContainText("行");
  await page.getByLabel("本地备注").fill("合成测试核对备注");
  await page.getByLabel("人工处理状态").selectOption("revise");
  await page.getByRole("button", { name: "关闭详情" }).click();
  page.once("dialog", (d) => d.accept());
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "导出 CSV 报告" }).click();
  const download = await downloadPromise;
  const stream = await download.createReadStream();
  let csv = "";
  for await (const chunk of stream!) csv += chunk.toString();
  expect(csv).toContain("疑似漏记");
  expect(csv).toContain("合成测试核对备注");
  expect(csv).toContain("原文件 / 工作表 / 行号");
  await upload(
    page,
    "随手记",
    "人工构造-账本修订.csv",
    synthetic([
      "2026-01-01,收入,100,工行账本,工资,CNY",
      "2026-01-20,支出,50,工行账本,银行缺记,CNY",
      "2026-01-31,收入,1,工行账本,利息,CNY",
      "2026-01-01,收入,20,招行账本,存入,CNY",
      "2026-01-31,收入,1,招行账本,利息,CNY",
    ]),
  );
  await page.getByRole("button", { name: "开始对账" }).click();
  await expect(page.locator("#results")).toContainText("旧差异不再出现");
  await expect(page.locator(".result-table")).not.toContainText("疑似漏记");
  await expect(page.locator(".result-table")).not.toContainText("疑似多记");
  await page.reload();
  await expect(page.locator(".file-editor")).toHaveCount(0);
  expect(
    await page.evaluate(() => ({
      local: localStorage.length,
      session: sessionStorage.length,
    })),
  ).toEqual({ local: 0, session: 0 });
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});
test("duplicate files, malformed input, demo ambiguities, manual confirmation and mobile", async ({
  page,
}) => {
  await page.goto("./");
  const csv = synthetic(["2026-01-01,收入,1,A,合成,CNY"]);
  await upload(page, "工商银行", "人工构造.csv", csv);
  await page.getByLabel("上传工商银行", { exact: true }).setInputFiles({
    name: "另一个名字.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv),
  });
  await expect(page.getByRole("alert")).toContainText("相同文件内容已导入");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "清除本次数据" }).click();
  await page.getByLabel("上传工商银行", { exact: true }).setInputFiles({
    name: "fake.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake"),
  });
  await expect(page.getByRole("alert")).toContainText("不支持");
  await page.getByRole("button", { name: "试用合成示例" }).click();
  await expect(page.getByRole("status")).toContainText("已载入人工构造");
  await page.getByRole("button", { name: "开始对账" }).click();
  await expect(page.locator(".result-table")).toContainText("疑似重复");
  await expect(page.locator(".result-table")).toContainText("疑似日期偏差");
  await page.getByLabel("筛选差异类别").selectOption("date");
  await page.getByRole("button", { name: "查看详情" }).click();
  await page.getByRole("button", { name: "确认这组匹配" }).click();
  await expect(page.getByRole("status")).toContainText("本地对账完成");
  await page.getByRole("button", { name: "全部记录", exact: true }).click();
  await page.getByLabel("筛选差异类别").selectOption("manual");
  await expect(page.locator(".result-table")).toContainText("人工确认匹配");
  await page.getByRole("button", { name: "撤销匹配" }).click();
  await page.getByLabel("筛选差异类别").selectOption("date");
  await expect(page.locator(".result-table")).toContainText("疑似日期偏差");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "清除本次数据" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("manual split keeps exact totals and cancellation discards unfinished imports", async ({
  page,
}) => {
  await page.goto("./");
  const ledger = synthetic([
    "2026-01-01,收入,1,L,起点,CNY",
    "2026-01-15,支出,60,L,合成拆分,CNY",
    "2026-01-15,支出,40,L,合成拆分,CNY",
    "2026-01-31,收入,1,L,终点,CNY",
  ]);
  const bank = synthetic([
    "2026-01-01,收入,1,B,起点,CNY",
    "2026-01-15,支出,100,B,合成拆分,CNY",
    "2026-01-31,收入,1,B,终点,CNY",
  ]);
  await upload(page, "随手记", "人工构造-拆分账本.csv", ledger);
  await upload(page, "工商银行", "人工构造-拆分银行.csv", bank);
  await page.getByLabel("映射账户-L", { exact: true }).selectOption("icbc:B");
  await page.getByRole("button", { name: "开始对账" }).click();
  await page.getByRole("button", { name: "查看详情" }).click();
  await page.getByRole("button", { name: "确认这组匹配" }).click();
  await page.getByRole("button", { name: "全部记录", exact: true }).click();
  await page.getByLabel("筛选差异类别").selectOption("manual");
  await expect(page.locator(".result-table")).toContainText("人工确认匹配");
  await expect(page.locator(".result-table")).toContainText("100.00");
  await expect(page.locator(".result-table")).toContainText("60.00");
  await expect(page.locator(".result-table")).toContainText("40.00");
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "清除本次数据" }).click();
  let release: () => void = () => {};
  let observed: () => void = () => {};
  const requested = new Promise<void>((resolve) => {
    observed = resolve;
  });
  await page.route("**/assets/processor-*.js", async (route) => {
    observed();
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    await route.continue().catch(() => {});
  });
  await page.getByLabel("上传工商银行", { exact: true }).setInputFiles({
    name: "人工构造-取消.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(bank),
  });
  await requested;
  await page.getByRole("button", { name: "取消处理" }).click();
  release();
  await expect(page.getByRole("status")).toContainText("处理已取消");
  await expect(page.locator(".file-editor")).toHaveCount(0);
});

test("drag-and-drop and overlapping files preserve every legitimate row", async ({
  page,
}) => {
  await page.goto("./");
  const content = synthetic(["2026-01-01,支出,10,A,合成购物,CNY"]);
  const transfer = await page.evaluateHandle((text) => {
    const d = new DataTransfer();
    d.items.add(new File([text], "人工构造-拖拽.csv", { type: "text/csv" }));
    return d;
  }, content);
  await page
    .locator(".source-icbc")
    .dispatchEvent("drop", { dataTransfer: transfer });
  await expect(page.getByRole("status")).toContainText("1 条有效");
  await upload(page, "工商银行", "人工构造-重叠.csv", content + "\n");
  await expect(page.locator(".file-editor")).toHaveCount(2);
  await expect(page.locator("#settings")).toContainText("2 条有效记录");
  await transfer.dispose();
});

test("missing statement account is explained beside the fields and parse button", async ({
  page,
}) => {
  await page.goto("./");
  for (const [source, account] of [
    ["工商银行", "工商银行"],
    ["招商银行借记卡", "招商活期"],
    ["微信支付", "微支付"],
  ]) {
    await page.getByLabel(`上传${source}`, { exact: true }).setInputFiles({
      name: `人工构造-${source}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(
        `日期,方向,金额,摘要,币种\n2026-01-01,支出,10,人工构造${source},CNY`,
      ),
    });
    const entry = page
      .locator(".source-file")
      .filter({ hasText: `人工构造-${source}.csv` });
    await expect(entry).toContainText("还需指定本文件的账户");
    const input = entry.getByLabel("这个文件属于哪个账户", { exact: true });
    await expect(input).toHaveAttribute("aria-invalid", "true");
    // Auto-parsing already explains what is missing, without a click.
    await expect(entry.getByRole("alert")).toContainText("未识别账户");
    await entry.getByRole("button", { name: `使用“${account}”` }).click();
    await expect(input).toHaveValue(account);
    await entry.getByRole("button", { name: "确认映射并解析" }).click();
    await expect(entry.locator("summary")).toContainText("1 条有效 · 0 条错误");
    await expect(entry.getByRole("alert")).toHaveCount(0);
  }
});

test("beginner path: files parse themselves, accounts link themselves, blockers are named", async ({
  page,
}) => {
  await page.goto("./");
  await expect(page.locator(".next-step")).toContainText("导入随手记账本文件");
  await expect(page.locator(".blockers")).toContainText("还差 1 步");
  await page.getByLabel("上传随手记", { exact: true }).setInputFiles({
    name: "人工构造-随手记.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(
      synthetic([
        "2026-01-01,支出,10,工商银行,人工构造超市,CNY",
        "2026-01-02,支出,25,招商活期,人工构造咖啡,CNY",
      ]),
    ),
  });
  // No field confirmation click: the file is parsed on import.
  await expect(page.getByRole("status")).toContainText("解析完成：2 条有效");
  // The run button explains what is still missing instead of just being dead.
  await expect(page.locator(".blockers")).toContainText(
    "导入至少一个银行或微信账单文件",
  );
  await expect(page.getByRole("button", { name: "开始对账" })).toBeDisabled();
  await upload(
    page,
    "工商银行",
    "人工构造-工行.csv",
    synthetic(["2026-01-01,支出,10,工行尾号1234,人工构造超市,CNY"]),
  );
  // 工商银行 is the only ICBC statement, so the ledger account links itself.
  await expect(
    page.getByLabel("映射账户-工商银行", { exact: true }),
  ).toHaveValue("icbc:工行尾号1234");
  await expect(page.locator(".auto-hint").first()).toContainText("请核对");
  // 招商活期 has no statement yet, so nothing is guessed for it.
  await expect(
    page.getByLabel("映射账户-招商活期", { exact: true }),
  ).toHaveValue("");
  await expect(page.locator(".blockers")).toHaveCount(0);
  await expect(page.locator(".next-step")).toContainText("开始对账");
  await page.getByRole("button", { name: "开始对账" }).click();
  await expect(page.locator("#results")).toContainText("严格匹配");
  await expect(page.locator(".next-step")).toContainText("逐笔核实差异");
});

test("a GB18030 CSV imports without touching the encoding picker", async ({
  page,
}) => {
  await page.goto("./");
  const bytes = await page.evaluate(() => {
    // GB18030 bytes for 日期,方向,金额,账户,摘要,币种 and one synthetic row.
    const map: Record<string, number[]> = {
      日: [0xc8, 0xd5],
      期: [0xc6, 0xda],
      方: [0xb7, 0xbd],
      向: [0xcf, 0xf2],
      金: [0xbd, 0xf0],
      额: [0xb6, 0xee],
      账: [0xd5, 0xcb],
      户: [0xbb, 0xa7],
      摘: [0xd5, 0xaa],
      要: [0xd2, 0xaa],
      币: [0xb1, 0xd2],
      种: [0xd6, 0xd6],
      支: [0xd6, 0xa7],
      出: [0xb3, 0xf6],
      工: [0xb9, 0xa4],
      行: [0xd0, 0xd0],
      人: [0xc8, 0xcb],
      构: [0xb9, 0xb9],
      造: [0xd4, 0xec],
      超: [0xb3, 0xac],
      市: [0xca, 0xd0],
    };
    const text =
      "日期,方向,金额,账户,摘要,币种\n2026-01-01,支出,10,工行,人工构造超市,CNY";
    const out: number[] = [];
    for (const c of text)
      c.charCodeAt(0) < 128 ? out.push(c.charCodeAt(0)) : out.push(...map[c]);
    return out;
  });
  await page.getByLabel("上传工商银行", { exact: true }).setInputFiles({
    name: "人工构造-GB18030.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(bytes),
  });
  await expect(page.getByRole("status")).toContainText("解析完成：1 条有效");
  await page.locator(".file-editor summary").click();
  await expect(page.locator(".import-details")).toContainText("GB18030");
});
