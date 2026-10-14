import { it, expect } from "vitest";
import { inspectSource, verifySource } from "../../src/adapters/source-check";
import { initialOptions } from "../../src/adapters/profiles";
import { deduplicateBankTransactions } from "../../src/domain/reconciliation/deduplicate";
import { reconcile, summarize } from "../../src/domain/reconciliation/engine";
import type { Transaction } from "../../src/domain/transactions/types";
const cmb = {
  id: "f",
  name: "名字故意写成工行.csv",
  warnings: [],
  sheets: [
    {
      name: "CSV",
      rows: [
        ["交易日期", "收入", "支出", "交易备注"],
        ["20260101", "", "10", "人工构造"],
      ],
    },
  ],
};
it("detects known source mismatch regardless of filename or confirmation", () => {
  expect(inspectSource("icbc", cmb).kind).toBe("mismatch");
  expect(() =>
    verifySource("icbc", cmb, {
      ...initialOptions("icbc", cmb),
      sourceConfirmed: true,
    }),
  ).toThrow("招商银行借记卡");
  expect(inspectSource("cmb", cmb).kind).toBe("matched");
});
it("requires explicit confirmation for unknown layouts and rejects mixed recognized sources", () => {
  const unknown = {
    ...cmb,
    sheets: [{ name: "CSV", rows: [["日期", "方向", "金额", "账户"]] }],
  };
  expect(() =>
    verifySource("icbc", unknown, initialOptions("icbc", unknown)),
  ).toThrow("确认");
  expect(() =>
    verifySource("icbc", unknown, {
      ...initialOptions("icbc", unknown),
      sourceConfirmed: true,
    }),
  ).not.toThrow();
  const mixed = {
    ...cmb,
    sheets: [
      ...cmb.sheets,
      {
        name: "工行",
        rows: [["交易日期", "记账金额(收入)", "记账金额(支出)", "记账币种"]],
      },
    ],
  };
  expect(inspectSource("cmb", mixed).kind).toBe("mismatch");
});
let n = 0;
function tx(file: string, changes: Partial<Transaction> = {}): Transaction {
  const id = String(++n);
  return {
    id,
    source: "icbc",
    sourceFileId: file,
    accountId: "A",
    accountName: "A",
    transactionDate: "2026-01-01",
    postingDate: null,
    direction: "expense",
    amountMinor: "1000",
    currency: "CNY",
    description: "人工构造",
    originalRowNumber: 2,
    raw: {},
    externalTransactionId: "BANK-TEST-001",
    externalIdTrusted: true,
    ...changes,
  };
}
it("excludes reliable cross-file copies once and unifies matching and totals", () => {
  const a = tx("a"),
    b = tx("b"),
    ledger = tx("ledger", {
      source: "suishouji",
      accountId: "L",
      accountName: "L",
    });
  const report = deduplicateBankTransactions([a, b, ledger]);
  expect(report.excludedCount).toBe(1);
  expect(report.transactions.find((t) => t.id === b.id)?.duplicateOf).toBe(
    a.id,
  );
  const settings = {
    mappings: { "suishouji:L": "icbc:A" },
    accountIds: ["icbc:A"],
    start: "2026-01-01",
    end: "2026-01-01",
    tolerance: 0,
    dateBasis: "transactionDate" as const,
    confirmedExternalIds: false,
  };
  const result = reconcile([a, b, ledger], settings);
  expect(result.items.map((i) => i.status)).toContain("excluded-duplicate");
  expect(result.items.map((i) => i.status)).toContain("matched");
  expect(summarize(result.transactions, settings)[0].bankExpense).toBe("1000");
});
it("preserves conflicting references, repeated IDs within one file and different accounts", () => {
  const a = tx("a"),
    b = tx("b", { amountMinor: "2000" });
  expect(deduplicateBankTransactions([a, b]).excludedCount).toBe(0);
  expect(deduplicateBankTransactions([a, b]).groups[0].kind).toBe("conflict");
  expect(
    deduplicateBankTransactions([tx("a"), tx("a"), tx("b")]).excludedCount,
  ).toBe(0);
  expect(
    deduplicateBankTransactions([tx("a"), tx("b", { accountId: "B" })])
      .excludedCount,
  ).toBe(0);
});
it("keeps same-day same-amount payments without reliable IDs and ignores placeholder IDs", () => {
  const report = deduplicateBankTransactions([
    tx("a", { externalIdTrusted: false }),
    tx("b", { externalIdTrusted: false }),
  ]);
  expect(report.excludedCount).toBe(0);
  expect(report.groups[0].kind).toBe("possible");
  const missing = deduplicateBankTransactions([
    tx("a", { externalTransactionId: "0" }),
    tx("b", { externalTransactionId: "0" }),
  ]);
  expect(missing.excludedCount).toBe(0);
  const different = deduplicateBankTransactions([
    tx("a"),
    tx("b", { externalTransactionId: "BANK-TEST-002" }),
  ]);
  expect(different.groups).toEqual([]);
});
it("does not collapse repeated same-file purchases or ledger records", () => {
  expect(deduplicateBankTransactions([tx("a"), tx("a")]).excludedCount).toBe(0);
  expect(
    deduplicateBankTransactions([
      tx("a", { source: "suishouji" }),
      tx("b", { source: "suishouji" }),
    ]).excludedCount,
  ).toBe(0);
});
