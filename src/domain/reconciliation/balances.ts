import type { Transaction } from "../transactions/types";
import { parseAmount, parseDate } from "../transactions/normalize";

export interface BalanceInput {
  start: string;
  opening: string;
  complete: boolean;
  bankClosing: Record<string, string>;
}
export interface BalanceDay {
  date: string;
  bank: Transaction[];
  ledger: Transaction[];
  bankClosing?: string;
  ledgerClosing?: string;
  difference?: string;
  change?: string;
  state: "equal" | "different" | "unknown";
  reason: string;
  bankBasis: string;
}
export function signedMoney(value: string): string | undefined {
  if (!value.trim()) return undefined;
  const n = parseAmount(value);
  return ((n.negative ? -1n : 1n) * BigInt(n.minor)).toString();
}
export const movement = (t: Transaction) =>
  BigInt(t.amountMinor) *
  (t.direction === "income" ? 1n : t.direction === "expense" ? -1n : 0n);
export const total = (ts: Transaction[], direction: "income" | "expense") =>
  ts
    .filter((t) => t.direction === direction)
    .reduce((n, t) => n + BigInt(t.amountMinor), 0n);

// File order is accepted only when dates and the running balance chain agree.
// Same-day rows without a unique order never silently choose the largest balance.
export function statementClosings(
  bank: Transaction[],
): Map<string, { value?: string; reason: string }> {
  const byFile = new Map<string, Transaction[]>();
  for (const t of bank) {
    const key = JSON.stringify([t.sourceFileId, t.sheetName]);
    const rows = byFile.get(key) || [];
    rows.push(t);
    byFile.set(key, rows);
  }
  const candidates = new Map<string, { value?: string; reason: string }[]>();
  for (const rows of byFile.values()) {
    rows.sort((a, b) => a.originalRowNumber - b.originalRowNumber);
    const dated = rows.filter((t) => t.transactionDate);
    let ascending = true,
      descending = true;
    for (let i = 1; i < dated.length; i++) {
      if (dated[i].transactionDate! < dated[i - 1].transactionDate!)
        ascending = false;
      if (dated[i].transactionDate! > dated[i - 1].transactionDate!)
        descending = false;
    }
    const days = new Map<string, Transaction[]>();
    for (const t of dated) {
      const group = days.get(t.transactionDate!) || [];
      group.push(t);
      days.set(t.transactionDate!, group);
    }
    for (const [day, group] of days) {
      const valid = (ordered: Transaction[]) =>
        ordered.every(
          (t, i) =>
            t.balanceMinor !== undefined &&
            !t.balanceIssue &&
            ["income", "expense"].includes(t.direction) &&
            (!i ||
              BigInt(t.balanceMinor) ===
                BigInt(ordered[i - 1].balanceMinor!) + movement(t)),
        );
      const orders: Transaction[][] = [];
      if (ascending) orders.push(group);
      if (descending) orders.push([...group].reverse());
      const values = new Set(
        orders.filter(valid).map((g) => g.at(-1)!.balanceMinor!),
      );
      const entry =
        values.size === 1
          ? { value: [...values][0], reason: "账单当日最后一笔的交易后余额" }
          : {
              reason: group.some(
                (t) => t.balanceMinor === undefined || t.balanceIssue,
              )
                ? "账单未提供可用的逐笔余额"
                : "当日流水顺序或余额衔接无法确定，请核对日终余额",
            };
      const entries = candidates.get(day) || [];
      entries.push(entry);
      candidates.set(day, entries);
    }
  }
  return new Map(
    [...candidates].map(([day, entries]) => [
      day,
      entries.length === 1
        ? entries[0]
        : {
            reason:
              "同一天分布在多个文件，请核对是否重叠并填写已核实的日终余额",
          },
    ]),
  );
}

export function balanceDays(
  bank: Transaction[],
  ledger: Transaction[],
  input: BalanceInput,
  end: string,
  issues: string[] = [],
): BalanceDay[] {
  if (!input.start || !end || input.start > end) return [];
  try {
    parseDate(input.start);
    parseDate(end);
  } catch {
    return [];
  }
  let ledgerBalance: bigint | undefined;
  try {
    const n = signedMoney(input.opening);
    if (n !== undefined) ledgerBalance = BigInt(n);
  } catch {
    /* visible input error */
  }
  const cny = bank.filter((t) => t.currency === "CNY");
  const closings = statementClosings(cny);
  const bankDates = cny
    .flatMap((t) => (t.transactionDate ? [t.transactionDate] : []))
    .sort();
  const ledgerByDay = new Map<string, Transaction[]>(),
    bankByDay = new Map<string, Transaction[]>();
  for (const [ts, map] of [
    [bank, bankByDay],
    [ledger, ledgerByDay],
  ] as const)
    for (const t of ts)
      if (t.transactionDate) {
        const rows = map.get(t.transactionDate) || [];
        rows.push(t);
        map.set(t.transactionDate, rows);
      }
  let previousBank: string | undefined;
  for (const day of [...closings.keys()].sort())
    if (day < input.start) previousBank = closings.get(day)!.value;
  let previousDifference: bigint | undefined;
  const missingDates = [...bank, ...ledger].some(
    (t) => t.currency === "CNY" && !t.transactionDate,
  );
  const days: BalanceDay[] = [];
  for (
    let stamp = Date.parse(input.start + "T00:00:00Z");
    stamp <= Date.parse(end + "T00:00:00Z");
    stamp += 86400000
  ) {
    const date = new Date(stamp).toISOString().slice(0, 10);
    const b = bankByDay.get(date) || [],
      l = ledgerByDay.get(date) || [];
    if (
      l.some(
        (t) =>
          t.currency === "CNY" && !["income", "expense"].includes(t.direction),
      )
    )
      ledgerBalance = undefined;
    if (ledgerBalance !== undefined)
      for (const t of l) if (t.currency === "CNY") ledgerBalance += movement(t);
    let bankClosing = closings.get(date)?.value;
    let bankBasis =
      closings.get(date)?.reason || "当天无银行流水，沿用前一日余额";
    const inBankRange =
      !!bankDates.length && date >= bankDates[0] && date <= bankDates.at(-1)!;
    if (!bankByDay.has(date))
      bankClosing = inBankRange && input.complete ? previousBank : undefined;
    if (input.bankClosing[date]?.trim()) {
      try {
        bankClosing = signedMoney(input.bankClosing[date]);
        bankBasis = "手动填写的已核实日终余额";
      } catch {
        bankClosing = undefined;
        bankBasis = "填写的银行日终余额格式不正确";
      }
    }
    previousBank = bankClosing;
    const difference =
      bankClosing !== undefined && ledgerBalance !== undefined
        ? BigInt(bankClosing) - ledgerBalance
        : undefined;
    const reason = issues.length
      ? issues.join("；")
      : missingDates
        ? "存在缺少交易日期的记录，请补全后核对余额"
        : !input.complete
          ? "请确认已完整导出本账户的收支和转账"
          : ledgerBalance === undefined
            ? "请填写有效的随手记期初余额，并检查转账方向"
            : bankClosing === undefined
              ? inBankRange
                ? bankBasis
                : "未取得该日银行余额，请补充账单或填写已核实余额"
              : "";
    days.push({
      date,
      bank: b,
      ledger: l,
      bankClosing,
      ledgerClosing: ledgerBalance?.toString(),
      difference: difference?.toString(),
      change:
        difference !== undefined && previousDifference !== undefined
          ? (difference - previousDifference).toString()
          : undefined,
      state: reason ? "unknown" : difference === 0n ? "equal" : "different",
      reason,
      bankBasis,
    });
    previousDifference = difference;
  }
  return days;
}

export interface ExpenseClue {
  bank: Transaction[];
  ledger: Transaction[];
  kind: "same" | "amount" | "missing" | "extra" | "ambiguous" | "transfer";
}
export function expenseClues(
  bank: Transaction[],
  ledger: Transaction[],
): ExpenseClue[] {
  const b = bank.filter(
    (t) => t.currency === "CNY" && t.direction === "expense" && !t.isTransfer,
  );
  const l = ledger.filter(
    (t) => t.currency === "CNY" && t.direction === "expense",
  );
  const used = new Set<string>(),
    clues: ExpenseClue[] = [];
  const groups = new Map<
    string,
    { bank: Transaction[]; ledger: Transaction[] }
  >();
  for (const [rows, side] of [
    [b, "bank"],
    [l, "ledger"],
  ] as const)
    for (const t of rows) {
      const group = groups.get(t.amountMinor) || { bank: [], ledger: [] };
      group[side].push(t);
      groups.set(t.amountMinor, group);
    }
  for (const group of groups.values())
    if (group.bank.length && group.ledger.length) {
      clues.push({
        ...group,
        kind:
          group.bank.length === 1 && group.ledger.length === 1
            ? group.ledger[0].isTransfer
              ? "transfer"
              : "same"
            : "ambiguous",
      });
      [...group.bank, ...group.ledger].forEach((t) => used.add(t.id));
    }
  const keys = (t: Transaction) =>
    [
      t.counterparty?.trim() ? `party:${t.counterparty.trim()}` : "",
      t.description.trim() ? `description:${t.description.trim()}` : "",
    ].filter(Boolean);
  const index = (ts: Transaction[]) => {
    const map = new Map<string, Transaction[]>();
    for (const t of ts)
      if (!used.has(t.id))
        for (const key of keys(t)) {
          const group = map.get(key) || [];
          group.push(t);
          map.set(key, group);
        }
    return map;
  };
  const bankIndex = index(b),
    ledgerIndex = index(l.filter((t) => !t.isTransfer));
  const unique = (t: Transaction, map: Map<string, Transaction[]>) => {
    const candidates = new Map<string, Transaction>();
    for (const key of keys(t)) {
      const group = map.get(key) || [];
      if (group.length > 1) return undefined;
      if (group[0]) candidates.set(group[0].id, group[0]);
    }
    return candidates.size === 1 ? [...candidates.values()][0] : undefined;
  };
  for (const t of b.filter((t) => !used.has(t.id))) {
    const candidate = unique(t, ledgerIndex);
    if (candidate && unique(candidate, bankIndex)?.id === t.id) {
      clues.push({ bank: [t], ledger: [candidate], kind: "amount" });
      used.add(t.id);
      used.add(candidate.id);
    }
  }
  for (const t of b)
    if (!used.has(t.id)) clues.push({ bank: [t], ledger: [], kind: "missing" });
  for (const t of l)
    if (!used.has(t.id) && !t.isTransfer)
      clues.push({ bank: [], ledger: [t], kind: "extra" });
  return clues.sort(
    (a, c) => Number(a.kind === "same") - Number(c.kind === "same"),
  );
}
