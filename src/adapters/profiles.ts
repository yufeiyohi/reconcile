import type {
  ImportOptions,
  ParsedFile,
  StatementAdapter,
  ParsedSheet,
} from "./types";
import { createGenericAdapter, suggestMapping } from "./generic";
import type { ParseResult } from "../domain/transactions/types";
export function detectHeader(sheet: ParsedSheet): number {
  let best = 0,
    score = 0;
  for (let i = 0; i < Math.min(50, sheet.rows.length); i++) {
    const m = suggestMapping(sheet.rows[i]);
    const n = Object.keys(m).length;
    if (n > score) {
      score = n;
      best = i;
    }
  }
  return best + 1;
}
export function initialOptions(
  source: string,
  file: ParsedFile,
): ImportOptions {
  const sheet = file.sheets[0],
    headerRow = detectHeader(sheet);
  const mapping = suggestMapping(sheet.rows[headerRow - 1] || []);
  if (
    source !== "suishouji" &&
    (mapping.income !== undefined || mapping.expense !== undefined) &&
    sheet.rows[headerRow - 1][mapping.direction ?? -1] === "交易类型"
  )
    delete mapping.direction;
  return {
    sheet: sheet.name,
    headerRow,
    mapping,
    fixedAccount: "",
    defaultCurrency: "CNY",
    signedAmount: false,
    allSheets:
      source === "suishouji" &&
      file.sheets.every((s) => ["支出", "收入", "转账"].includes(s.name)),
  };
}
export function profiledAdapter(
  id: string,
  name: string,
  required: string[],
  defaultDescription?: string,
): StatementAdapter {
  const base = createGenericAdapter(id, name);
  return {
    ...base,
    version: "sample-v1",
    supportedFileTypes:
      id === "cmb-credit"
        ? ["csv", "xlsx", "xls", "pdf"]
        : ["csv", "xlsx", "xls"],
    detect(file) {
      const matched = file.sheets.some((s) =>
        s.rows
          .slice(0, 50)
          .some((row) => required.every((h) => row.includes(h))),
      );
      return {
        confidence: matched ? 0.95 : 0,
        reasons: [
          matched
            ? "此表头结构已依据用户提供样本验证；仍须确认账户、字段及范围"
            : "未识别模板，使用通用手动映射",
        ],
      };
    },
    parse(file, options) {
      const sheet = file.sheets.find((s) => s.name === options.sheet)!;
      const recognized = this.detect(file).confidence > 0;
      // Preserve row slots for exact traceability; only known footer records are excluded.
      const removed: number[] = [];
      const rows = sheet.rows.map((row, i) => {
        if (
          i >= options.headerRow &&
          recognized &&
          /^(人民币合计|# (收入|支出)合计)/.test(row[0]?.trim() || "")
        ) {
          removed.push(i + 1);
          return row.map(() => "");
        }
        return row;
      });
      const prepared = {
        ...file,
        sheets: file.sheets.map((s) =>
          s.name === sheet.name ? { ...s, rows } : s,
        ),
      };
      const result = base.parse(prepared, options);
      result.warnings = result.warnings.filter(
        (w) => !w.includes("官方导出模板尚未验证"),
      );
      result.warnings.push(...this.detect(file).reasons);
      if (removed.length)
        result.warnings.push(
          `已排除识别出的汇总尾行：${removed.join("、")}，未作为流水计入`,
        );
      if (defaultDescription) result.warnings.push(defaultDescription);
      if (id === "cmb-credit")
        for (const t of result.transactions) {
          const header = rows[options.headerRow - 1];
          const page = header.indexOf("原PDF页"),
            line = header.indexOf("原PDF行");
          if (page >= 0 && line >= 0) {
            const raw = rows[t.originalRowNumber - 1];
            t.originalPage = Number(raw[page]);
            t.originalRowNumber = Number(raw[line]);
          }
        }
      return result;
    },
  };
}
