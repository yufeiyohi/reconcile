export type TransactionSource = "suishouji" | "icbc" | "cmb" | (string & {});
export type Direction = "income" | "expense" | "transfer" | "unknown";
export interface Transaction {
  id: string;
  source: TransactionSource;
  accountId: string;
  accountName: string;
  transactionDate: string | null;
  postingDate: string | null;
  direction: Direction;
  amountMinor: string;
  currency: string;
  description: string;
  counterparty?: string;
  category?: string;
  note?: string;
  externalTransactionId?: string;
  sourceFileId: string;
  sheetName?: string;
  originalRowNumber: number;
  raw: Record<string, unknown>;
  originalPage?: number;
  isTransfer?: boolean;
  transferGroupId?: string;
}
export interface ParseIssue {
  sheetName?: string;
  row: number;
  message: string;
}
export interface ParseResult {
  transactions: Transaction[];
  errors: ParseIssue[];
  warnings: string[];
}
export const sourceNames: Record<string, string> = {
  suishouji: "随手记",
  icbc: "工商银行",
  cmb: "招商银行借记卡",
  "cmb-credit": "招行信用卡",
  wechat: "微信支付",
};
export function maskAccount(value: string): string {
  return value.replace(
    /\d{5,}/g,
    (n) =>
      `${n.slice(0, 2)}${"*".repeat(Math.max(2, Math.min(n.length - 6, 8)))}${n.slice(-Math.min(4, n.length - 4))}`,
  );
}
export function money(value: string | bigint): string {
  const n = BigInt(value),
    a = n < 0n ? -n : n;
  return `${n < 0n ? "-" : ""}${a / 100n}.${(a % 100n).toString().padStart(2, "0")}`;
}
