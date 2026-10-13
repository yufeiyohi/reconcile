import { test, expect } from "@playwright/test";
import * as XLS from "@e965/xlsx";
const headers = [
  "交易类型",
  "日期",
  "一级分类",
  "二级分类",
  "支出账户",
  "金额",
  "成员",
  "商家",
  "项目",
  "备注",
];
test("XLS multi-sheet ledger and XLSX custom header row work in real workers", async ({
  page,
}) => {
  const book = XLS.utils.book_new();
  XLS.utils.book_append_sheet(
    book,
    XLS.utils.aoa_to_sheet([
      headers,
      [
        "支出",
        "2026-01-01",
        "合成",
        "",
        "工商银行",
        100,
        "",
        "合成商户",
        "人工构造",
        "测试",
      ],
    ]),
    "支出",
  );
  XLS.utils.book_append_sheet(
    book,
    XLS.utils.aoa_to_sheet([
      [
        "交易类型",
        "日期",
        "转出账户",
        "转入账户",
        "金额",
        "成员",
        "商家",
        "项目",
        "备注",
      ],
      [
        "转账",
        "2026-01-02",
        "工商银行",
        "微支付",
        25,
        "",
        "",
        "合成转账",
        "测试",
      ],
    ]),
    "转账",
  );
  XLS.utils.book_append_sheet(
    book,
    XLS.utils.aoa_to_sheet([
      headers.map((h) => (h === "支出账户" ? "收入账户" : h)),
      [
        "收入",
        "2026-01-01",
        "合成",
        "",
        "工商银行",
        40,
        "",
        "合成付款方",
        "人工构造收入",
        "测试",
      ],
    ]),
    "收入",
  );
  await page.goto("./");
  await page.getByLabel("上传随手记", { exact: true }).setInputFiles({
    name: "人工构造-多工作表.xls",
    mimeType: "application/vnd.ms-excel",
    buffer: XLS.write(book, { type: "buffer", bookType: "biff8" }),
  });
  await expect(page.getByRole("status")).toContainText("4 条有效，0 条错误");
  const wx = XLS.utils.book_new();
  XLS.utils.book_append_sheet(
    wx,
    XLS.utils.aoa_to_sheet([
      ["人工构造微信支付样本"],
      [],
      [
        "交易时间",
        "交易类型",
        "交易对方",
        "商品",
        "收/支",
        "金额(元)",
        "支付方式",
        "当前状态",
        "交易单号",
        "商户单号",
        "备注",
      ],
      [
        "2026-01-01 10:00:00",
        "商户消费",
        "合成商户",
        "合成商品",
        "支出",
        100,
        "零钱",
        "支付成功",
        "SYN-001",
        "SYN-M001",
        "不是真实账单",
      ],
    ]),
    "合成",
  );
  await page.getByLabel("上传微信支付", { exact: true }).setInputFiles({
    name: "人工构造-微信.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: XLS.write(wx, { type: "buffer", bookType: "xlsx" }),
  });
  await expect(page.locator(".file-editor")).toHaveCount(2);
  const editor = page.locator(".source-file").last();
  await editor.getByLabel("这个文件属于哪个账户").fill("微支付");
  await editor.getByRole("button", { name: "确认映射并解析" }).click();
  await expect(page.getByRole("status")).toContainText("1 条有效，0 条错误");
  await page
    .getByLabel("映射账户-微支付", { exact: true })
    .selectOption("wechat:微支付");
});
test("supported text PDF is extracted locally; scan-only PDF is rejected", async ({
  page,
  browser,
}) => {
  const pdfPage = await browser.newPage();
  await pdfPage.setContent(
    '<html><body style="font-size:14px"><p>招商银行</p><p>账单日</p><p>2026年01月10日</p><p>交易日 记账日 交易摘要 人民币金额 卡号末四位 交易地金额</p><p>01/01 01/02 人工构造消费 100.00 1234 100.00</p><p>01/03 人工构造还款 -100.00 1234 -100.00</p></body></html>',
  );
  const pdf = await pdfPage.pdf();
  await pdfPage.close();
  await page.goto("./");
  await page.getByLabel("上传招行信用卡", { exact: true }).setInputFiles({
    name: "人工构造-信用卡.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  await expect(page.locator(".file-editor")).toHaveCount(1, { timeout: 35000 });
  await expect(page.getByRole("status")).toContainText("2 条有效，0 条错误");
  await expect(page.locator(".import-details")).toContainText(
    "交易日期保持为空",
  );
  const scanPage = await browser.newPage();
  await scanPage.setContent(
    '<html><body><canvas width="600" height="600"></canvas><script>const c=document.querySelector("canvas").getContext("2d");c.fillStyle="#777";c.fillRect(0,0,600,600);</script></body></html>',
  );
  const scan = await scanPage.pdf();
  await scanPage.close();
  await page.getByLabel("上传招行信用卡", { exact: true }).setInputFiles({
    name: "人工构造-扫描件.pdf",
    mimeType: "application/pdf",
    buffer: scan,
  });
  await expect(page.getByRole("alert")).toContainText("扫描件");
  await expect(page.locator(".file-editor")).toHaveCount(1);
});
