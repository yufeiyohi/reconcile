import Papa from "papaparse";
import type { Reconciliation, Settings } from "../domain/reconciliation/types";
import { statusLabels, statusHelp } from "../domain/reconciliation/types";
import { maskAccount, money, sourceNames } from "../domain/transactions/types";
import type { Decision, ImportedFile } from "../components/types";
import { decisionLabels } from "../components/types";
export function safeCell(value: unknown): string {
  const s = String(value ?? "");
  return /^[\s\u0000-\u001f\u007f]*[=+\-@＝＋－＠]/u.test(s) ||
    /^[\t\r\n]/.test(s)
    ? `'${s}`
    : s;
}
export function buildReport(
  result: Reconciliation,
  settings: Settings,
  files: ImportedFile[],
  decisions: Record<string, Decision>,
): string {
  const tx = new Map(result.transactions.map((t) => [t.id, t]));
  const names = new Map(files.map((f) => [f.file.id, f.file.name]));
  const headers = [
    "来源（银行 / 渠道）",
    "账户（已脱敏）",
    "这是什么情况",
    "该怎么办",
    "银行账单 · 日期",
    "银行账单 · 金额",
    "银行账单 · 收支",
    "银行账单 · 摘要",
    "随手记 · 日期",
    "随手记 · 金额",
    "随手记 · 收支",
    "随手记 · 备注",
    "金额差（银行 − 随手记）",
    "在哪个文件的第几行",
    "判断依据",
    "你的处理",
    "你的备注",
    "对账期间",
    "按哪个日期比对",
    "允许日期相差（天）",
    "币种",
    "是否账户间转账",
  ];
  // Short rows would make a ragged CSV; pad every row to the header width.
  const pad = (cells: (string | number)[]) => [
    ...cells,
    ...Array(Math.max(0, headers.length - cells.length)).fill(""),
  ];
  const rows = result.items.map((item) => {
    const b = item.bankIds.map((id) => tx.get(id)!),
      l = item.ledgerIds.map((id) => tx.get(id)!);
    const net = (ts: typeof b) =>
      ts.reduce(
        (n, t) =>
          n +
          (t.direction === "income"
            ? 1n
            : t.direction === "expense"
              ? -1n
              : 0n) *
            BigInt(t.amountMinor),
        0n,
      );
    const decision = decisions[item.id];
    return pad([
      sourceNames[b[0]?.source] || b[0]?.source || "",
      maskAccount(item.accountId),
      statusLabels[item.status],
      statusHelp[item.status],
      b.map((t) => t[settings.dateBasis] || "缺失").join(" / "),
      b.map((t) => money(t.amountMinor)).join(" / "),
      b
        .map((t) =>
          t.direction === "income"
            ? "收入"
            : t.direction === "expense"
              ? "支出"
              : t.direction,
        )
        .join(" / "),
      b.map((t) => t.description).join(" / "),
      l.map((t) => t[settings.dateBasis] || "缺失").join(" / "),
      l.map((t) => money(t.amountMinor)).join(" / "),
      l
        .map((t) =>
          t.direction === "income"
            ? "收入"
            : t.direction === "expense"
              ? "支出"
              : t.direction,
        )
        .join(" / "),
      l
        .map((t) => [t.description, t.note].filter(Boolean).join("；"))
        .join(" / "),
      item.status === "excluded-duplicate" ? "不计入" : money(net(b) - net(l)),
      [...b, ...l]
        .map(
          (t) =>
            `${names.get(t.sourceFileId) || t.sourceFileId} / ${t.sheetName} / ${t.originalPage ? `第 ${t.originalPage} 页 / ` : ""}第 ${t.originalRowNumber} 行`,
        )
        .join("\n"),
      item.reason,
      decisionLabels[decision?.status || "open"],
      decision?.note || "",
      `${settings.start} 至 ${settings.end}`,
      settings.dateBasis === "transactionDate" ? "交易日期" : "入账日期",
      settings.tolerance,
      [...new Set([...b, ...l].map((t) => t.currency))].join(" / "),
      [...b, ...l].some((t) => t.isTransfer) ? "账户转账（非消费）" : "",
    ]);
  });
  for (const file of files)
    for (const error of file.result?.errors || [])
      rows.push(
        pad([
          sourceNames[file.source],
          "",
          "解析错误",
          "这一行没能读成一条流水，没有计入对账。按提示修正原文件后重新导入。",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          `${file.file.name} / ${error.sheetName || file.options.sheet} / 第 ${error.row} 行`,
          error.message,
        ]),
      );
  for (const warning of result.warnings)
    rows.push(
      pad([
        "",
        "",
        "提醒",
        "关于账单覆盖范围或人工匹配的提醒，请结合原始账单判断。",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        warning,
      ]),
    );
  return (
    "\uFEFF" +
    Papa.unparse(
      [headers, ...rows].map((row) => row.map(safeCell)),
      { quotes: true, newline: "\r\n" },
    )
  );
}
export function downloadReport(csv: string) {
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "清账-对账报告.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
