import type {
  ParseResult,
  TransactionSource,
} from "../domain/transactions/types";
export interface ParsedSheet {
  name: string;
  rows: string[][];
}
export interface ParsedFile {
  id: string;
  name: string;
  sheets: ParsedSheet[];
  warnings: string[];
}
export type Field =
  | "transactionDate"
  | "postingDate"
  | "direction"
  | "amount"
  | "balance"
  | "paymentMethod"
  | "income"
  | "expense"
  | "account"
  | "description"
  | "note"
  | "counterparty"
  | "externalTransactionId"
  | "currency"
  | "category";
export type FieldMapping = Partial<Record<Field, number>>;
export interface ImportOptions {
  sheet: string;
  headerRow: number;
  mapping: FieldMapping;
  fixedAccount: string;
  defaultCurrency: string;
  signedAmount: boolean;
  allSheets?: boolean;
  sourceConfirmed?: boolean;
  trustTransactionIds?: boolean;
}
export interface DetectionResult {
  confidence: number;
  reasons: string[];
}
export interface StatementAdapter {
  id: TransactionSource;
  displayName: string;
  version: string;
  supportedFileTypes: string[];
  detect(input: ParsedFile): DetectionResult;
  parse(input: ParsedFile, options: ImportOptions): ParseResult;
}
export const fieldLabels: Record<Field, string> = {
  transactionDate: "交易日期",
  postingDate: "入账日期",
  direction: "收支方向",
  amount: "金额",
  balance: "交易后余额（非交易金额）",
  paymentMethod: "支付方式（微信零钱筛选）",
  income: "独立收入金额",
  expense: "独立支出金额",
  account: "账户名称 / 账号",
  description: "摘要",
  note: "备注",
  counterparty: "交易对方",
  externalTransactionId: "交易编号",
  currency: "币种",
  category: "分类",
};
