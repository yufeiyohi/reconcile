import suishouji from "../../src/adapters/suishouji";
import { describe, expect, it } from "vitest";
import {
  balanceDays,
  statementClosings,
  expenseClues,
  signedMoney,
  type BalanceInput,
} from "../../src/domain/reconciliation/balances";
import type { Transaction } from "../../src/domain/transactions/types";
import { createGenericAdapter } from "../../src/adapters/generic";
import { initialOptions } from "../../src/adapters/profiles";
let seq = 0;
function tx(
  date: string,
  amount: string,
  balance?: string,
  extra: Partial<Transaction> = {},
): Transaction {
  const n = ++seq;
  return {
    id: String(n),
    source: "icbc",
    accountId: "A",
    accountName: "A",
    transactionDate: date,
    postingDate: null,
    direction: "expense",
    amountMinor: amount,
    balanceMinor: balance,
    currency: "CNY",
    description: "合成",
    sourceFileId: "bank",
    originalRowNumber: n,
    raw: {},
    ...extra,
  };
}
const input: BalanceInput = {
  start: "2026-01-01",
  opening: "1000",
  complete: true,
  bankClosing: {},
};
describe("daily account balance review", () => {
  it("parses signed balance separately and retains transactions with unreadable balance", () => {
    const file = {
      id: "f",
      name: "synthetic.csv",
      warnings: [],
      sheets: [
        {
          name: "CSV",
          rows: [
            ["日期", "方向", "金额", "账户", "余额"],
            ["2026-01-01", "支出", "10", "A", "-5.50"],
            ["2026-01-02", "收入", "5", "A", "未知"],
          ],
        },
      ],
    };
    const result = createGenericAdapter("icbc", "测试").parse(
      file,
      initialOptions("icbc", file),
    );
    expect(result.errors).toEqual([]);
    expect(result.transactions[0].balanceMinor).toBe("-550");
    expect(result.transactions[0].amountMinor).toBe("1000");
    expect(result.transactions[1].balanceIssue).toContain("无法识别");
    expect(signedMoney("-0.00")).toBe("0");
    expect(signedMoney("90071992547409.93")).toBe("9007199254740993");
  });
  it("uses the last balance, not the daily sum or maximum; handles reversed rows", () => {
    const bank = [
      tx("2026-01-01", "10000", "90000"),
      tx("2026-01-02", "2000", "88000"),
      tx("2026-01-02", "5000", "93000", { direction: "income" }),
      tx("2026-01-02", "1000", "92000"),
    ];
    expect(statementClosings(bank).get("2026-01-02")?.value).toBe("92000");
    const reversed = [...bank]
      .reverse()
      .map((t, i) => ({ ...t, originalRowNumber: i + 1 }));
    expect(statementClosings(reversed).get("2026-01-02")?.value).toBe("92000");
  });
  it("counts income and transfers, carries differences, and suppresses offsetting detail errors on equal days", () => {
    const bank = [
      tx("2026-01-01", "10000", "90000"),
      tx("2026-01-02", "2000", "88000"),
      tx("2026-01-02", "5000", "93000", { direction: "income" }),
      tx("2026-01-03", "1000", "92000"),
    ];
    const ledger = [
      tx("2026-01-01", "15000", undefined, { source: "suishouji" }),
      tx("2026-01-01", "5000", undefined, {
        source: "suishouji",
        direction: "income",
        isTransfer: true,
      }),
      tx("2026-01-02", "5000", undefined, {
        source: "suishouji",
        direction: "income",
      }),
      tx("2026-01-03", "1000", undefined, { source: "suishouji" }),
    ];
    const days = balanceDays(bank, ledger, input, "2026-01-03");
    expect(days.map((d) => d.state)).toEqual([
      "equal",
      "different",
      "different",
    ]);
    expect(days.map((d) => d.ledgerClosing)).toEqual([
      "90000",
      "95000",
      "94000",
    ]);
    expect(days[1].difference).toBe("-2000");
    expect(days[2].change).toBe("0");
  });
  it("never assumes equal opening balances, nor calls equal net movement equal balances", () => {
    const bank = [tx("2026-01-01", "1000", "99000")],
      ledger = [tx("2026-01-01", "1000", undefined, { source: "suishouji" })];
    expect(
      balanceDays(bank, ledger, { ...input, opening: "" }, "2026-01-01")[0]
        .state,
    ).toBe("unknown");
    expect(
      balanceDays(bank, ledger, { ...input, opening: "900" }, "2026-01-01")[0]
        .difference,
    ).toBe("10000");
    expect(
      balanceDays(bank, ledger, { ...input, complete: false }, "2026-01-01")[0]
        .state,
    ).toBe("unknown");
  });
  it("does not guess absent, conflicting, ambiguous or out-of-range bank balances", () => {
    const day = "2026-01-01";
    expect(
      statementClosings([tx(day, "100", "900"), tx(day, "200", "600")]).get(day)
        ?.value,
    ).toBeUndefined();
    expect(
      statementClosings([
        tx(day, "100", "900"),
        tx(day, "100", "1000", { direction: "income" }),
      ]).get(day)?.value,
    ).toBeUndefined();
    expect(
      statementClosings([
        tx(day, "100", "900"),
        tx(day, "100", "900", { sourceFileId: "overlap" }),
      ]).get(day)?.value,
    ).toBeUndefined();
    const missing = [tx(day, "100")];
    expect(balanceDays(missing, [], input, day)[0].state).toBe("unknown");
    expect(
      balanceDays(
        missing,
        [],
        { ...input, bankClosing: { [day]: "1000" } },
        day,
      )[0].state,
    ).toBe("equal");
    expect(
      balanceDays([tx(day, "100", "100000")], [], input, "2026-01-02")[1].state,
    ).toBe("unknown");
  });
  it("carries a known balance across no-transaction days inside the confirmed period", () => {
    const days = balanceDays(
      [tx("2026-01-01", "1000", "99000"), tx("2026-01-03", "1000", "98000")],
      [tx("2026-01-01", "1000"), tx("2026-01-03", "1000")],
      input,
      "2026-01-03",
    );
    expect(days[1].bankClosing).toBe("99000");
    expect(days[1].state).toBe("equal");
    expect(balanceDays([], [], input, "2026-01-01")[0].state).toBe("unknown");
  });
  it("starts ledger calculation at the chosen date and respects errors and missing dates", () => {
    const bank = [
      tx("2026-01-01", "1000", "99000"),
      tx("2026-01-02", "1000", "98000"),
    ];
    const days = balanceDays(
      bank,
      [tx("2026-01-01", "1000"), tx("2026-01-02", "1000")],
      { ...input, start: "2026-01-02", opening: "990" },
      "2026-01-02",
    );
    expect(days[0].state).toBe("equal");
    expect(
      balanceDays(bank, [], input, "2026-01-01", ["文件有错误"])[0].state,
    ).toBe("unknown");
    expect(
      balanceDays(
        bank,
        [tx("", "1000", undefined, { transactionDate: null })],
        input,
        "2026-01-01",
      )[0].state,
    ).toBe("unknown");
  });
  it("uses precise monetary clues and preserves ambiguous/missing/extra expenses", () => {
    const bank = [
      tx("2026-01-01", "2000", undefined, {
        counterparty: "人工商家A",
        description: "银行摘要",
      }),
      tx("2026-01-01", "3000", undefined, { description: "独有" }),
    ];
    const ledger = [
      tx("2026-01-01", "2500", undefined, {
        counterparty: "人工商家A",
        description: "账本摘要",
      }),
      tx("2026-01-01", "4000", undefined, { description: "账本独有" }),
    ];
    expect(expenseClues(bank, ledger).map((c) => c.kind)).toEqual([
      "amount",
      "missing",
      "extra",
    ]);
    expect(
      expenseClues(
        [tx("2026-01-01", "100"), tx("2026-01-01", "100")],
        [tx("2026-01-01", "100")],
      )[0].kind,
    ).toBe("ambiguous");
  });
});

it("combines all three Suishouji sheets and posts each transfer to the correct account", () => {
  const file = {
    id: "three-sheets",
    name: "synthetic.xls",
    warnings: [],
    sheets: [
      {
        name: "支出",
        rows: [
          ["交易类型", "日期", "支出账户", "金额"],
          ["支出", "2026-01-01", "A", "100"],
        ],
      },
      {
        name: "收入",
        rows: [
          ["交易类型", "日期", "收入账户", "金额"],
          ["收入", "2026-01-01", "A", "50"],
        ],
      },
      {
        name: "转账",
        rows: [
          ["交易类型", "日期", "转出账户", "转入账户", "金额"],
          ["转账", "2026-01-01", "A", "B", "200"],
          ["转账", "2026-01-01", "B", "A", "30"],
        ],
      },
    ],
  };
  const options = initialOptions("suishouji", file);
  expect(options.allSheets).toBe(true);
  const parsed = suishouji.parse(file, options);
  expect(parsed.errors).toEqual([]);
  expect(parsed.transactions).toHaveLength(6);
  const accountA = parsed.transactions.filter((t) => t.accountId === "A");
  const bank = [
    tx("2026-01-01", "10000", "90000"),
    tx("2026-01-01", "5000", "95000", { direction: "income" }),
    tx("2026-01-01", "20000", "75000"),
    tx("2026-01-01", "3000", "78000", { direction: "income" }),
  ];
  const day = balanceDays(bank, accountA, input, "2026-01-01")[0];
  expect(day.ledgerClosing).toBe("78000");
  expect(day.state).toBe("equal");
  expect(expenseClues([], accountA).flatMap((c) => c.ledger)).toHaveLength(1);
  const accountB = parsed.transactions.filter((t) => t.accountId === "B");
  const other = balanceDays(
    [],
    accountB,
    { ...input, opening: "0" },
    "2026-01-01",
  )[0];
  expect(other.ledgerClosing).toBe("17000");
});

it("keeps a possible bank transfer out of missing-expense suggestions", () => {
  const bank = [tx("2026-01-01", "20000")],
    ledger = [tx("2026-01-01", "20000", undefined, { isTransfer: true })];
  expect(expenseClues(bank, ledger)[0].kind).toBe("transfer");
});

it("does not derive wallet balances from expense-only WeChat rows or carry them across omitted flows", () => {
  const bank = [
    tx("2026-01-01", "100", "10000", { source: "wechat" }),
    tx("2026-01-03", "100", "9900", { source: "wechat" }),
  ];
  const days = balanceDays(
    bank,
    [],
    { ...input, bankClosing: { "2026-01-01": "1000" } },
    "2026-01-03",
  );
  expect(days[0].state).toBe("equal");
  expect(days[1].bankClosing).toBeUndefined();
  expect(days[2].bankClosing).toBeUndefined();
});
