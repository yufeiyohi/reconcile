import type { Transaction } from "../transactions/types";
export type Status =
  | "matched"
  | "date"
  | "missing"
  | "extra"
  | "amount"
  | "direction"
  | "ambiguous"
  | "duplicate"
  | "manual"
  | "unmapped"
  | "outside"
  | "unsupported"
  | "transfer";
export const statusLabels: Record<Status, string> = {
  matched: "严格匹配成功",
  date: "疑似日期偏差",
  missing: "疑似漏记",
  extra: "疑似多记",
  amount: "疑似金额不一致",
  direction: "疑似方向不一致",
  ambiguous: "多候选，待确认",
  duplicate: "疑似重复 / 多候选",
  manual: "人工确认匹配",
  unmapped: "未纳入本次对账",
  outside: "期间外 / 覆盖不足",
  unsupported: "币种或方向未支持",
  transfer: "转账待人工核实",
};
export interface Settings {
  mappings: Record<string, string>;
  accountIds: string[];
  start: string;
  end: string;
  tolerance: number;
  dateBasis: "transactionDate" | "postingDate";
  confirmedExternalIds: boolean;
}
export interface ManualMatch {
  id: string;
  bankIds: string[];
  ledgerIds: string[];
}
export interface ResultItem {
  id: string;
  status: Status;
  bankIds: string[];
  ledgerIds: string[];
  reason: string;
  dayDifference?: number;
  accountId: string;
}
export interface Reconciliation {
  items: ResultItem[];
  warnings: string[];
  invalidManualIds: string[];
  transactions: Transaction[];
}
export const accountKey = (t: Transaction) => `${t.source}:${t.accountId}`;
export const ledgerAccountKey = accountKey;
