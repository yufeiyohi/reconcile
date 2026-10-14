import type { Transaction } from "../transactions/types";
export type Status =
  | "excluded-duplicate"
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
  "excluded-duplicate": "可靠编号重复副本已排除",
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
/** Plain-language explanation of each status, and what to do about it. */
export const statusHelp: Record<Status, string> = {
  "excluded-duplicate":
    "与另一文件为相同银行账户、可靠编号和关键内容相同的重复副本，未计入金额，原始位置保留。",
  matched: "两边金额、方向、日期都对得上，不用处理。",
  date: "金额和方向都一样，只是日期差了几天，常见于银行延迟入账。核对后可在详情里确认这组匹配。",
  missing: "银行有这笔，随手记里没找到。多半是漏记了，核实后到随手记补记。",
  extra:
    "随手记有这笔，银行账单里没找到。可能记重了、记错账户，或这笔是现金／其他渠道支付。",
  amount: "两边都有这笔，但金额对不上。请以银行账单为准，核实后修改随手记。",
  direction: "两边都有这笔，但一边记成收入、一边记成支出。核实后修改随手记。",
  ambiguous:
    "同一天有多笔金额相同的记录，网站不敢替你决定配对。请在详情里看原始行，自己选对应的一组。",
  duplicate:
    "同一边出现多笔完全一样的记录，可能是重复记账或重复导入。请核对原始行。",
  manual: "这组是你自己确认的匹配，可以随时撤销。",
  unmapped:
    "这个账户没有在第 2 步关联，所以没有参与对账。需要的话回第 2 步关联账户。",
  outside: "记录落在所选期间之外，或这段时间只有一边有数据，不能据此判断漏记。",
  unsupported:
    "币种不是人民币，或方向无法判断（例如微信“不计收支”），不自动对账，请人工看。",
  transfer: "账户之间的转账，不算消费，需要你人工核实两侧是否都记对了。",
};
export interface Settings {
  mappings: Record<string, string>;
  confirmedMappings?: Record<string, string>;
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
