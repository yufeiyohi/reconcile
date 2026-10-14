import { describe, expect, it } from "vitest";
import {
  reconcile,
  summarize,
  validateManual,
} from "../../src/domain/reconciliation/engine";
import type { Transaction } from "../../src/domain/transactions/types";
import type { Settings } from "../../src/domain/reconciliation/types";
import { suggestAccountMappings } from "../../src/domain/reconciliation/suggest";
import { buildReport } from "../../src/export/report";
const tx = (
  id: string,
  source = "icbc",
  p: Partial<Transaction> = {},
): Transaction => ({
  id,
  source,
  accountId: source === "suishouji" ? "工资卡" : "A",
  accountName: "工资卡",
  transactionDate: "2026-01-10",
  postingDate: "2026-01-10",
  direction: "expense",
  amountMinor: "10000",
  currency: "CNY",
  description: "商店购物",
  sourceFileId: id,
  originalRowNumber: 2,
  raw: {},
  ...p,
});
const settings: Settings = {
  mappings: { "suishouji:工资卡": "icbc:A", "suishouji:储蓄卡": "cmb:B" },
  accountIds: ["icbc:A", "cmb:B"],
  start: "2026-01-01",
  end: "2026-01-31",
  tolerance: 0,
  dateBasis: "transactionDate",
  confirmedExternalIds: false,
};
// Artificial fixtures. Boundary anchors establish observed date coverage, not continuous coverage.
const anchors = [
  tx("b0", "icbc", { transactionDate: "2026-01-01", amountMinor: "1" }),
  tx("s0", "suishouji", { transactionDate: "2026-01-01", amountMinor: "1" }),
  tx("b9", "icbc", { transactionDate: "2026-01-31", amountMinor: "2" }),
  tx("s9", "suishouji", { transactionDate: "2026-01-31", amountMinor: "2" }),
];
const run = (
  t: Transaction[],
  s = settings,
  manual: Parameters<typeof reconcile>[2] = [],
) => reconcile([...anchors, ...t], s, manual);
const main = (r: ReturnType<typeof run>) =>
  r.items.filter(
    (i) =>
      ![...i.bankIds, ...i.ledgerIds].every((id) =>
        ["b0", "s0", "b9", "s9"].includes(id),
      ),
  );
describe("deterministic conservative matching", () => {
  it("matches unique exact records and traces original rows", () => {
    const r = main(run([tx("b"), tx("s", "suishouji")]));
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("matched");
    expect(r[0].bankIds).toEqual(["b"]);
  });
  it("finds missing and extra even when totals cancel", () => {
    const t = [
      tx("b"),
      tx("s", "suishouji", {
        transactionDate: "2026-01-20",
        description: "另一次购物",
      }),
    ];
    const r = main(run(t));
    expect(r.map((i) => i.status).sort()).toEqual(["extra", "missing"]);
    expect(summarize(t, settings)[0].expenseDifference).toBe("0");
  });
  it("never merges duplicate same-day amounts", () => {
    const r = main(
      run([tx("b1"), tx("b2"), tx("s1", "suishouji"), tx("s2", "suishouji")]),
    );
    expect(r.every((i) => i.status !== "matched")).toBe(true);
    expect(r.some((i) => i.status === "duplicate")).toBe(true);
    expect(new Set(r.flatMap((i) => i.bankIds))).toEqual(new Set(["b1", "b2"]));
  });
  it("date tolerance is explicit and does not silently auto-confirm", () => {
    const r = main(
      run([tx("b"), tx("s", "suishouji", { transactionDate: "2026-01-11" })], {
        ...settings,
        tolerance: 1,
      }),
    );
    expect(r[0].status).toBe("date");
    expect(r[0].dayDifference).toBe(1);
  });
  it("does not cross account, currency, or direction", () => {
    for (const patch of [
      { accountId: "其他" },
      { currency: "USD" },
      { direction: "income" as const },
    ]) {
      const r = main(run([tx("b"), tx("s", "suishouji", patch)]));
      expect(r.every((i) => i.status !== "matched")).toBe(true);
    }
  });
  it("requires description evidence for amount candidates", () => {
    expect(
      main(run([tx("b"), tx("s", "suishouji", { amountMinor: "9999" })]))[0]
        .status,
    ).toBe("amount");
    expect(
      main(
        run([
          tx("b"),
          tx("s", "suishouji", { amountMinor: "9999", description: "不相关" }),
        ]),
      )
        .map((i) => i.status)
        .sort(),
    ).toEqual(["extra", "missing"]);
  });
  it("only uses external IDs after semantic confirmation, with strict safeguards", () => {
    const a = [
      tx("b1", "icbc", { externalTransactionId: "x" }),
      tx("b2", "icbc", { externalTransactionId: "y" }),
      tx("s1", "suishouji", { externalTransactionId: "x" }),
      tx("s2", "suishouji", { externalTransactionId: "y" }),
    ];
    expect(main(run(a)).some((i) => i.status === "matched")).toBe(false);
    expect(
      main(run(a, { ...settings, confirmedExternalIds: true })).every(
        (i) => i.status === "matched",
      ),
    ).toBe(true);
  });
  it("marks missing date coverage, not missing entries", () => {
    const r = reconcile(
      [
        tx("b", "icbc", { transactionDate: "2026-01-09" }),
        tx("s", "suishouji"),
      ],
      settings,
    );
    expect(r.items.every((i) => i.status === "outside")).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
  it("supports one-to-many exact manual totals, rejects bad sums and reuse", () => {
    const t = [
      tx("b"),
      tx("s1", "suishouji", { amountMinor: "6000" }),
      tx("s2", "suishouji", { amountMinor: "4000" }),
    ];
    const m = { id: "m", bankIds: ["b"], ledgerIds: ["s1", "s2"] };
    expect(validateManual(m, t, settings)).toBeNull();
    expect(main(run(t, settings, [m]))[0].status).toBe("manual");
    expect(validateManual({ ...m, ledgerIds: ["s1"] }, t, settings)).toMatch(
      /金额/,
    );
    expect(run(t, settings, [m, { ...m, id: "m2" }]).invalidManualIds).toEqual([
      "m2",
    ]);
  });
  it("invalidates stale decisions after replacement", () => {
    const r = run([tx("b"), tx("new", "suishouji")], settings, [
      { id: "old", bankIds: ["b"], ledgerIds: ["gone"] },
    ]);
    expect(r.invalidManualIds).toEqual(["old"]);
  });
  it("refunds remain income and transfers never become consumption matches", () => {
    expect(
      main(
        run([
          tx("b", "icbc", { direction: "income" }),
          tx("s", "suishouji", { direction: "income" }),
        ]),
      )[0].status,
    ).toBe("matched");
    expect(
      main(
        run([tx("b"), tx("s", "suishouji", { direction: "transfer" })]),
      ).some((i) => i.status === "transfer"),
    ).toBe(true);
  });
  it("is deterministic independent of input order", () => {
    const t = [
      tx("b2"),
      tx("s2", "suishouji"),
      tx("b1"),
      tx("s1", "suishouji"),
    ];
    expect(run(t)).toEqual(run([...t].reverse()));
  });
  it("summarizes exact integers beyond safe floating point range by account/day", () => {
    const r = summarize(
      [
        tx("b", "icbc", { amountMinor: "9007199254740993" }),
        tx("s", "suishouji", { amountMinor: "9007199254740992" }),
      ],
      settings,
    );
    expect(r[0].expenseDifference).toBe("1");
  });
});

describe("confirmed identifier conflicts", () => {
  it("does not ignore duplicated IDs just because amounts distinguish entries", () => {
    const a = [
      tx("b1", "icbc", { externalTransactionId: "conflict" }),
      tx("b2", "icbc", {
        externalTransactionId: "conflict",
        amountMinor: "20000",
      }),
      tx("s1", "suishouji", { externalTransactionId: "conflict" }),
      tx("s2", "suishouji", {
        externalTransactionId: "conflict",
        amountMinor: "20000",
      }),
    ];
    const r = main(run(a, { ...settings, confirmedExternalIds: true }));
    expect(r).toHaveLength(1);
    expect(r[0].status).toBe("ambiguous");
  });
  it("flags direction conflicts even for confirmed matching IDs", () => {
    const r = main(
      run(
        [
          tx("b", "icbc", { externalTransactionId: "x" }),
          tx("s", "suishouji", {
            externalTransactionId: "x",
            direction: "income",
          }),
        ],
        { ...settings, confirmedExternalIds: true },
      ),
    );
    expect(r[0].status).toBe("direction");
  });
});

import { compareDifferences } from "../../src/domain/reconciliation/comparison";
it("compares reimported content without claiming stable file IDs", () => {
  const before = run([
    tx("bank-old"),
    tx("ledger-old", "suishouji", {
      transactionDate: "2026-01-20",
      description: "原多记",
    }),
  ]);
  const unchanged = run([
    tx("bank-new"),
    tx("ledger-new", "suishouji", {
      transactionDate: "2026-01-20",
      description: "原多记",
    }),
  ]);
  expect(
    compareDifferences(before, unchanged).filter((c) => c.kind === "remaining"),
  ).toHaveLength(2);
  const corrected = run([tx("bank-new"), tx("ledger-new", "suishouji")]);
  expect(
    compareDifferences(before, corrected).filter((c) => c.kind === "resolved"),
  ).toHaveLength(2);
});
describe("账户自动关联建议", () => {
  const ledger = (name: string) =>
    tx(name, "suishouji", { accountName: name, accountId: name });
  const bank = (source: string, name: string) =>
    tx(name, source, { accountName: name, accountId: name });
  it("按名称关键词匹配唯一的来源账户", () => {
    const result = suggestAccountMappings([
      ledger("工商银行"),
      ledger("招商活期"),
      ledger("招行信用卡(RMB)"),
      ledger("微支付"),
      ledger("现金"),
      bank("icbc", "工行尾号1234"),
      bank("cmb", "招行尾号5678"),
      bank("cmb-credit", "招行信用卡尾号9012"),
      bank("wechat", "微信支付"),
    ]);
    expect(result).toEqual({
      "suishouji:工商银行": "icbc:工行尾号1234",
      "suishouji:招商活期": "cmb:招行尾号5678",
      "suishouji:招行信用卡(RMB)": "cmb-credit:招行信用卡尾号9012",
      "suishouji:微支付": "wechat:微信支付",
    });
  });
  it("同一来源有多个账户时不猜测，已有选择不被覆盖", () => {
    const result = suggestAccountMappings(
      [
        ledger("工商银行"),
        ledger("招商活期"),
        bank("icbc", "工行A"),
        bank("icbc", "工行B"),
        bank("cmb", "招行尾号5678"),
      ],
      { "suishouji:招商活期": "" },
    );
    expect(result).toEqual({ "suishouji:招商活期": "" });
  });
});
describe("导出报告", () => {
  const files = [
    {
      key: "icbc:f1",
      source: "icbc",
      file: { id: "f1", name: "人工构造-工行.csv", sheets: [], warnings: [] },
      options: {
        sheet: "CSV",
        headerRow: 1,
        mapping: {},
        fixedAccount: "",
        defaultCurrency: "CNY",
        signedAmount: false,
      },
      result: {
        transactions: [],
        errors: [{ row: 3, message: "金额不是数字" }],
        warnings: [],
      },
      importedAt: "00:00:00",
    },
  ];
  const report = () =>
    buildReport(
      run([tx("b"), tx("s2", "suishouji", { amountMinor: "999" })]),
      settings,
      files,
      {},
    );
  it("每一行的列数与表头一致，解析错误和提醒也不例外", () => {
    const rows = report().replace(/^﻿/, "").trim().split("\r\n");
    const columns = rows.map((r) => r.split('","').length);
    expect(rows.length).toBeGreaterThan(3);
    expect(new Set(columns).size).toBe(1);
  });
  it("表头用白话，并带上处理建议列", () => {
    const header = report().split("\r\n")[0];
    expect(header).toContain("这是什么情况");
    expect(header).toContain("该怎么办");
    expect(header).toContain("金额差（银行 − 随手记）");
    expect(header).toContain("在哪个文件的第几行");
    expect(report()).toContain("请以银行账单为准");
  });
});

it("does not auto-link company cards and clears unconfirmed historical company mapping", () => {
  const ledger = (name: string) =>
    tx(name, "suishouji", { accountName: name, accountId: name });
  const bank = tx("cmb", "cmb", {
    accountName: "招商活期",
    accountId: "招商活期",
  });
  const records = [ledger("招商活期"), ledger("招商银行公司卡"), bank];
  expect(suggestAccountMappings(records)).toEqual({
    "suishouji:招商活期": "cmb:招商活期",
  });
  const old = {
    "suishouji:招商活期": "cmb:招商活期",
    "suishouji:招商银行公司卡": "cmb:招商活期",
  };
  expect(suggestAccountMappings(records, old)["suishouji:招商银行公司卡"]).toBe(
    "",
  );
  expect(
    suggestAccountMappings(records, old, {
      "suishouji:招商银行公司卡": "cmb:招商活期",
    })["suishouji:招商银行公司卡"],
  ).toBe("cmb:招商活期");
});
