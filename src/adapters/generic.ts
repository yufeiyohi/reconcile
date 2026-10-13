import type {
  Field,
  FieldMapping,
  ImportOptions,
  ParsedFile,
  StatementAdapter,
} from "./types";
import type { ParseResult, Transaction } from "../domain/transactions/types";
import {
  parseAmount,
  parseDate,
  parseDirection,
  parseCurrency,
} from "../domain/transactions/normalize";
export function suggestMapping(headers: string[]): FieldMapping {
  const aliases: Record<Field, string[]> = {
    transactionDate: ["交易日期", "日期", "交易时间", "时间"],
    postingDate: ["入账日期", "记账日期"],
    direction: ["收支方向", "收支类型", "方向", "收/支", "类型", "交易类型"],
    amount: ["金额", "交易金额", "金额(元)"],
    income: ["收入", "收入金额", "贷方金额", "记账金额(收入)"],
    expense: ["支出", "支出金额", "借方金额", "记账金额(支出)"],
    account: ["账户", "账户名称", "账号", "银行卡号", "支出账户", "收入账户"],
    description: ["摘要", "交易摘要", "商品", "项目"],
    note: ["备注", "交易备注", "交易详情"],
    counterparty: ["交易对方", "对方户名", "商家"],
    externalTransactionId: ["银行交易编号", "交易编号", "流水号", "交易单号"],
    currency: ["币种", "货币", "记账币种"],
    category: ["分类", "一级分类"],
  };
  const result: FieldMapping = {};
  for (const [key, values] of Object.entries(aliases)) {
    const i =
      values
        .map((v) => headers.findIndex((h) => h.trim() === v))
        .find((i) => i >= 0) ?? -1;
    if (i >= 0) result[key as Field] = i;
  }
  return result;
}
export function createGenericAdapter(
  id: string,
  displayName: string,
): StatementAdapter {
  return {
    id,
    displayName,
    version: "manual-v1",
    supportedFileTypes: ["csv", "xlsx"],
    detect: () => ({
      confidence: 0,
      reasons: ["通用手动映射；官方导出模板尚未验证"],
    }),
    parse(input: ParsedFile, options: ImportOptions): ParseResult {
      const sheet = input.sheets.find((s) => s.name === options.sheet);
      if (!sheet) throw new Error("工作表不存在");
      const { mapping: m, headerRow } = options;
      if (
        !Number.isInteger(headerRow) ||
        headerRow < 1 ||
        headerRow > sheet.rows.length
      )
        throw new Error("表头行号无效");
      if (m.transactionDate === undefined && m.postingDate === undefined)
        throw new Error("至少映射交易日期或入账日期");
      if (
        m.amount === undefined &&
        m.income === undefined &&
        m.expense === undefined
      )
        throw new Error("请映射金额列，或独立收入 / 支出列");
      if (
        m.amount !== undefined &&
        (m.income !== undefined || m.expense !== undefined)
      )
        throw new Error("金额列与独立收入 / 支出列只能选择一种方式");
      if (m.account === undefined && !options.fixedAccount.trim())
        throw new Error("未识别账户，请映射账户列或给文件指定账户");
      const result: ParseResult = {
        transactions: [],
        errors: [],
        warnings: [...input.warnings, ...this.detect(input).reasons],
      };
      const headers = sheet.rows[headerRow - 1];
      for (let i = headerRow; i < sheet.rows.length; i++) {
        const row = sheet.rows[i];
        if (row.every((v) => !v.trim())) continue;
        const get = (f: Field) => (m[f] === undefined ? "" : row[m[f]!] || "");
        try {
          let direction = parseDirection(get("direction")),
            amountMinor = "";
          if (m.amount !== undefined) {
            const a = parseAmount(get("amount"));
            amountMinor = a.minor;
            if (
              (direction === "income" && a.negative) ||
              (direction === "expense" && a.explicitPositive)
            )
              throw new Error("金额正负号与收支方向冲突");
            if (options.signedAmount) {
              const inferred = a.negative ? "expense" : "income";
              if (
                direction !== "unknown" &&
                direction !== "transfer" &&
                direction !== inferred
              )
                throw new Error("有符号金额与方向冲突");
              if (direction === "unknown") direction = inferred;
            }
          } else {
            const income = get("income").trim()
                ? parseAmount(get("income"))
                : null,
              expense = get("expense").trim()
                ? parseAmount(get("expense"))
                : null;
            if (income?.negative || expense?.negative)
              throw new Error("独立收入 / 支出列不能为负数");
            const hasIncome = income && BigInt(income.minor) !== 0n,
              hasExpense = expense && BigInt(expense.minor) !== 0n;
            if (hasIncome && hasExpense)
              throw new Error("同一行收入、支出同时非零");
            if (!hasIncome && !hasExpense)
              throw new Error("收入与支出均为空或零，无法确认方向");
            const inferred = hasIncome ? "income" : "expense";
            if (
              direction !== "unknown" &&
              direction !== "transfer" &&
              direction !== inferred
            )
              throw new Error("独立金额列与方向冲突");
            direction = direction === "transfer" ? "transfer" : inferred;
            amountMinor = (hasIncome ? income! : expense!).minor;
          }
          if (direction === "unknown")
            throw new Error(
              "收支方向无法识别，请映射方向列或确认使用有符号金额",
            );
          const transactionDate = parseDate(get("transactionDate")),
            postingDate = parseDate(get("postingDate"));
          if (!transactionDate && !postingDate)
            throw new Error("交易日期和入账日期均为空");
          const account = get("account").trim() || options.fixedAccount.trim();
          if (!account) throw new Error("账户为空，请为文件指定账户");
          const currency = parseCurrency(
            get("currency") || options.defaultCurrency,
          );
          const fields = {
            source: id,
            accountId: account,
            accountName: account,
            transactionDate,
            postingDate,
            direction,
            amountMinor,
            currency,
            description: get("description"),
            note: get("note"),
            counterparty: get("counterparty"),
            category: get("category"),
            externalTransactionId: get("externalTransactionId"),
          };
          const t: Transaction = {
            ...fields,
            id: JSON.stringify([id, input.id, sheet.name, i + 1, fields]),
            sourceFileId: input.id,
            sheetName: sheet.name,
            originalRowNumber: i + 1,
            raw: Object.fromEntries(
              row.map((value, j) => [`${j + 1}:${headers[j] || ""}`, value]),
            ),
          };
          result.transactions.push(t);
        } catch (e) {
          result.errors.push({
            row: i + 1,
            sheetName: sheet.name,
            message: e instanceof Error ? e.message : "该行解析失败",
          });
        }
      }
      if (!result.transactions.length)
        result.warnings.push("没有有效记录，不能开始成功对账");
      if (result.transactions.some((t) => t.currency !== "CNY"))
        result.warnings.push(
          "检测到非 CNY 币种：保留追溯，但不自动对账或合并汇总",
        );
      if (options.defaultCurrency && !("currency" in m))
        result.warnings.push(
          `币种列未映射，使用用户确认的默认 ${options.defaultCurrency}`,
        );
      return result;
    },
  };
}
