import { profiledAdapter } from "../profiles";
import { parseDirection } from "../../domain/transactions/normalize";
import type { StatementAdapter } from "../types";

const base = profiledAdapter("wechat", "微信支付", [
  "交易时间",
  "收/支",
  "金额(元)",
  "交易单号",
]);
const adapter: StatementAdapter = {
  ...base,
  version: "change-expenses-v1",
  parse(file, options) {
    const sheet = file.sheets.find((s) => s.name === options.sheet);
    if (!sheet) throw new Error("工作表不存在");
    const method = options.mapping.paymentMethod;
    const direction = options.mapping.direction;
    if (method === undefined)
      throw new Error(
        "微信只核对零钱支出，请在字段设置中映射“支付方式”列；缺少该列时请重新导出微信账单",
      );
    if (direction === undefined)
      throw new Error(
        "微信只核对零钱支出，请在字段设置中将“收支方向”映射到“收/支”列",
      );
    let kept = 0,
      ignored = 0;
    const rows = sheet.rows.map((row, i) => {
      if (i < options.headerRow || row.every((v) => !v.trim())) return row;
      if (
        row[method]?.trim() === "零钱" &&
        parseDirection(row[direction] || "") === "expense"
      ) {
        kept++;
        return row;
      }
      ignored++;
      return row.map(() => "");
    });
    const result = base.parse(
      {
        ...file,
        sheets: file.sheets.map((s) => (s === sheet ? { ...s, rows } : s)),
      },
      options,
    );
    result.warnings.unshift(
      `微信筛选：保留 ${kept} 行零钱支出，忽略 ${ignored} 行其他记录（含零钱通、银行卡支付、收入和不计收支）。`,
    );
    if (!kept)
      result.warnings.unshift("本文件没有符合条件的零钱支出，不参与对账。");
    result.warnings.push(
      "仅按支付方式为“零钱”且收支为“支出”筛选；交易状态不会删除原支出。筛选后的流水不完整，不能用它推算零钱日终余额。",
    );
    return result;
  },
};
export default adapter;
