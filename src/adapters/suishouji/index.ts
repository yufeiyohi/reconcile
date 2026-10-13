import { createGenericAdapter, suggestMapping } from "../generic";
import { detectHeader } from "../profiles";
import type { StatementAdapter } from "../types";
import type { ParseResult } from "../../domain/transactions/types";
const base = createGenericAdapter("suishouji", "随手记");
const adapter: StatementAdapter = {
  ...base,
  version: "multi-sheet-v1",
  supportedFileTypes: ["csv", "xlsx", "xls"],
  detect(file) {
    const known = file.sheets.some(
      (s) =>
        s.rows[0]?.includes("支出账户") ||
        s.rows[0]?.includes("收入账户") ||
        s.rows[0]?.includes("转出账户"),
    );
    return {
      confidence: known ? 0.95 : 0,
      reasons: [
        known
          ? "已验证随手记多工作表样本结构（支出 / 收入 / 转账）"
          : "通用手动映射；此结构尚未按官方模板验证",
      ],
    };
  },
  parse(file, options) {
    const known = this.detect(file).confidence > 0;
    const sheets = options.allSheets
      ? file.sheets
      : file.sheets.filter((s) => s.name === options.sheet);
    const result: ParseResult = { transactions: [], errors: [], warnings: [] };
    for (const sheet of sheets) {
      const headerRow =
        options.allSheets && sheet.name !== options.sheet
          ? detectHeader(sheet)
          : options.headerRow;
      const header = sheet.rows[headerRow - 1];
      const mapping =
        options.allSheets && sheet.name !== options.sheet
          ? suggestMapping(header)
          : options.mapping;
      if (known && header.includes("转出账户") && header.includes("转入账户")) {
        const out = header.indexOf("转出账户"),
          into = header.indexOf("转入账户");
        for (const [column, direction] of [
          [out, "支出"],
          [into, "收入"],
        ] as const) {
          const rows = sheet.rows.map((r, i) =>
            i < headerRow || r.every((v) => !v.trim())
              ? r
              : [direction, ...r.slice(1)],
          );
          const part = base.parse(
            { ...file, sheets: [{ ...sheet, rows }] },
            {
              ...options,
              sheet: sheet.name,
              headerRow,
              mapping: { ...mapping, direction: 0, account: column },
            },
          );
          for (const t of part.transactions) {
            t.isTransfer = true;
            t.transferGroupId = JSON.stringify([
              file.id,
              sheet.name,
              t.originalRowNumber,
            ]);
            t.description = t.description || "自有账户转账";
            t.raw["原交易类型"] = "转账";
          }
          result.transactions.push(...part.transactions);
          result.errors.push(
            ...part.errors.map((e) => ({
              ...e,
              message: `${sheet.name}（${direction}侧）：${e.message}`,
            })),
          );
          result.warnings.push(...part.warnings);
        }
        result.warnings.push(
          "转账工作表每行拆为转出 / 转入两条账户收支，关联同一转账组；不把双边流水重复计作消费。",
        );
      } else {
        const part = base.parse(file, {
          ...options,
          sheet: sheet.name,
          headerRow,
          mapping,
        });
        result.transactions.push(...part.transactions);
        result.errors.push(
          ...part.errors.map((e) => ({
            ...e,
            message: `${sheet.name}：${e.message}`,
          })),
        );
        result.warnings.push(...part.warnings);
      }
    }
    result.warnings = [
      ...new Set([
        ...result.warnings.filter((w) => !w.includes("官方导出模板尚未验证")),
        ...this.detect(file).reasons,
      ]),
    ];
    return result;
  },
};
export default adapter;
