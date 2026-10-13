import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import {
  parseAmount,
  parseDate,
} from "../../src/domain/transactions/normalize";
import { readFileData, inspectXlsx, decodeCsv } from "../../src/workers/files";
import {
  createGenericAdapter,
  suggestMapping,
} from "../../src/adapters/generic";
import { adapterRegistry, createRegistry } from "../../src/adapters/registry";
import { initialOptions } from "../../src/adapters/profiles";
import { parseCreditLines } from "../../src/workers/pdf";
import { safeCell } from "../../src/export/report";
import { reconcile } from "../../src/domain/reconciliation/engine";
const encode = (s: string) => new TextEncoder().encode(s).buffer;
describe("exact normalization and safe import", () => {
  it("parses decimal money with no floating point arithmetic", () => {
    expect(parseAmount("￥1,234.56").minor).toBe("123456");
    expect(parseAmount("90071992547409.93").minor).toBe("9007199254740993");
    expect(parseAmount("(12.00)").negative).toBe(true);
    for (const bad of ["1.001", "1e6", "abc", "1,00.00", ""])
      expect(() => parseAmount(bad)).toThrow();
  });
  it("uses business dates, validates leap days and compact bank dates", () => {
    expect(parseDate("2024/02/29 23:50")).toBe("2024-02-29");
    expect(parseDate("20260601")).toBe("2026-06-01");
    expect(() => parseDate("2026-02-29")).toThrow();
    expect(() => parseDate("06/01/2026")).toThrow();
  });
  it("detects repeated bytes regardless of filename", async () => {
    const a = await readFileData("a.csv", encode("日期,金额\n2026-01-01,1"));
    const b = await readFileData(
      "renamed.csv",
      encode("日期,金额\n2026-01-01,1"),
    );
    expect(a.id).toBe(b.id);
  });
  it("preserves CSV logical rows, multiline cells, accounts and errors", async () => {
    const f = await readFileData(
      "synthetic.csv",
      encode(
        '日期,方向,金额,账户,摘要,币种\n2026-01-01,支出,12.50,卡A,"line1\nline2",CNY\n2026-01-02,收入,-2,卡B,冲突,CNY\nwrong,支出,1,卡C,日期错误,CNY',
      ),
    );
    const p = adapterRegistry.get("icbc")!.parse(f, initialOptions("icbc", f));
    expect(p.transactions).toHaveLength(1);
    expect(p.transactions[0].originalRowNumber).toBe(2);
    expect(p.transactions[0].accountId).toBe("卡A");
    expect(p.errors.map((e) => e.row)).toEqual([3, 4]);
  });
  it("requires an explicit account and direction instead of guessing", async () => {
    const f = await readFileData("x.csv", encode("日期,金额\n2026-01-01,1"));
    expect(() =>
      createGenericAdapter("x", "X").parse(f, initialOptions("x", f)),
    ).toThrow(/账户/);
    const options = { ...initialOptions("x", f), fixedAccount: "A" };
    expect(
      createGenericAdapter("x", "X").parse(f, options).errors[0].message,
    ).toMatch(/方向/);
  });
  it("handles actual sample header shapes using exclusively synthetic values", async () => {
    const f = await readFileData(
      "synthetic-cmb.csv",
      encode(
        "# 人工构造\n说明\n交易日期,交易时间,收入,支出,余额,交易类型,交易备注\n20260101,10:00:00,,10,100,消费,合成购物\n# 支出合计: 1 笔",
      ),
    );
    const options = { ...initialOptions("cmb", f), fixedAccount: "测试账户" };
    expect(options.headerRow).toBe(3);
    const p = adapterRegistry.get("cmb")!.parse(f, options);
    expect(p.transactions).toHaveLength(1);
    expect(p.transactions[0].originalRowNumber).toBe(4);
    expect(p.errors).toHaveLength(0);
  });
  it("prioritizes WeChat direction rather than transaction type", () => {
    const mapping = suggestMapping([
      "交易时间",
      "交易类型",
      "交易对方",
      "商品",
      "收/支",
      "金额(元)",
      "支付方式",
    ]);
    expect(mapping.direction).toBe(4);
    expect(mapping.amount).toBe(5);
  });
  it("refuses unsupported, empty and oversized input", async () => {
    await expect(readFileData("x.png", encode("fake"))).rejects.toThrow(
      /不支持/,
    );
    await expect(readFileData("x.csv", new ArrayBuffer(0))).rejects.toThrow(
      /为空/,
    );
    await expect(
      readFileData("x.csv", new ArrayBuffer(10 * 1024 * 1024 + 1)),
    ).rejects.toThrow(/10 MB/);
    await expect(readFileData("x.xlsx", encode("fake"))).rejects.toThrow();
  });
  it("rejects XLSX formula, XML entities, external links, huge expansion and sparse rows", () => {
    const pack = (xml: string) =>
      zipSync({
        "[Content_Types].xml": strToU8("<Types/>"),
        "xl/workbook.xml": strToU8("<workbook/>"),
        "xl/worksheets/sheet1.xml": strToU8(xml),
      });
    for (const xml of [
      '<f>WEBSERVICE("x")</f>',
      "<!DOCTYPE x>",
      '<Relationship TargetMode="External"/>',
      '<row r="999999"/>',
    ])
      expect(() => inspectXlsx(pack(xml))).toThrow();
    expect(() => inspectXlsx(pack("x".repeat(31 * 1024 * 1024)))).toThrow(
      /30 MB/,
    );
  });
  it("neutralizes CSV formula triggers including whitespace and fullwidth", () => {
    for (const s of [
      "=1+1",
      "+cmd",
      "-cmd",
      "@SUM(A1)",
      "\t=1",
      "  =1",
      "\r+1",
      "＝1",
    ])
      expect(safeCell(s).startsWith("'")).toBe(true);
    expect(safeCell("正常摘要")).toBe("正常摘要");
  });
  it("adds a bank through the registry without touching the engine", async () => {
    const bank = createGenericAdapter("testbank", "合成测试银行");
    const registry = createRegistry([bank]);
    const f = await readFileData(
      "synthetic.csv",
      encode("日期,方向,金额,账户\n2026-01-01,支出,1,A"),
    );
    const b = registry.get("testbank")!.parse(f, initialOptions("testbank", f))
      .transactions[0];
    const l = { ...b, id: "ledger", source: "suishouji", accountId: "L" };
    const r = reconcile([b, l], {
      mappings: { "suishouji:L": "testbank:A" },
      accountIds: ["testbank:A"],
      start: "2026-01-01",
      end: "2026-01-01",
      tolerance: 0,
      dateBasis: "transactionDate",
      confirmedExternalIds: false,
    });
    expect(r.items[0].status).toBe("matched");
  });
  it("parses supported credit PDF lines, cross-year dates and one-date repayments", () => {
    const lines = [
      "招商银行",
      "账单日",
      "2026年01月10日",
      "交易日 记账日 交易摘要 人民币金额 卡号末四位 交易地金额",
      "12/31 01/01 人工构造消费 100.00 1234 100.00",
      "01/02 人工构造还款 -100.00 1234 -100.00",
    ].map((text, i) => ({ text, page: 1, line: i + 1 }));
    const r = parseCreditLines(lines);
    expect(r.sheets[0].rows[1][0]).toBe("2025-12-31");
    expect(r.sheets[0].rows[2][0]).toBe("");
    expect(r.sheets[0].rows[2][2]).toBe("收入");
    expect(() =>
      parseCreditLines([
        ...lines,
        { text: "01/03 damaged row", page: 1, line: 7 },
      ]),
    ).toThrow(/无法识别/);
  });
});
describe("CSV 编码自动识别", () => {
  const gb = (text: string) => {
    // Minimal GB18030 encoder for the few characters this test needs.
    const table: Record<string, number[]> = {
      日: [0xc8, 0xd5],
      期: [0xc6, 0xda],
      金: [0xbd, 0xf0],
      额: [0xb6, 0xee],
    };
    const bytes: number[] = [];
    for (const c of text)
      c.charCodeAt(0) < 128
        ? bytes.push(c.charCodeAt(0))
        : bytes.push(...table[c]);
    return new Uint8Array(bytes).buffer;
  };
  it("UTF-8 文件无需用户选择编码", () => {
    const { decoded, warning } = decodeCsv(
      new TextEncoder().encode("日期,金额").buffer as ArrayBuffer,
    );
    expect(decoded).toBe("日期,金额");
    expect(warning).toBeUndefined();
  });
  it("GB18030 文件自动识别并提示", () => {
    const { decoded, warning } = decodeCsv(gb("日期,金额"));
    expect(decoded).toBe("日期,金额");
    expect(warning).toContain("GB18030");
  });
  it("带 BOM 的 UTF-16 LE 文件不会被当成 UTF-8", () => {
    const text = "日期,金额";
    const bytes = new Uint8Array(2 + text.length * 2);
    bytes[0] = 0xff;
    bytes[1] = 0xfe;
    for (let i = 0; i < text.length; i++) {
      bytes[2 + i * 2] = text.charCodeAt(i) & 0xff;
      bytes[3 + i * 2] = text.charCodeAt(i) >> 8;
    }
    const { decoded, warning } = decodeCsv(bytes.buffer);
    expect(decoded).toBe(text);
    expect(warning).toContain("UTF-16");
  });
  it("手动选错编码时给出可操作的提示", () => {
    expect(() => decodeCsv(gb("日期,金额"), "utf-8")).toThrow("自动识别");
  });
  it("自动识别的 GB18030 CSV 可以直接导入", async () => {
    const file = await readFileData("人工构造.csv", gb("日期,金额"));
    expect(file.sheets[0].rows[0]).toEqual(["日期", "金额"]);
    expect(file.warnings.some((w) => w.includes("GB18030"))).toBe(true);
  });
});
