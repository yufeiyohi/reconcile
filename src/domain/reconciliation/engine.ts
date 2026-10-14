import { deduplicateBankTransactions } from "./deduplicate";
import type { Transaction } from "../transactions/types";
import {
  accountKey,
  type Settings,
  type ManualMatch,
  type Reconciliation,
  type ResultItem,
  type Status,
} from "./types";
export const dayNumber = (date: string) =>
  Date.parse(`${date}T00:00:00Z`) / 86400000;
const dateOf = (t: Transaction, s: Settings) => t[s.dateBasis];
const target = (t: Transaction, s: Settings) =>
  t.source === "suishouji" ? s.mappings[accountKey(t)] : accountKey(t);
const sum = (t: Transaction[]) =>
  t.reduce((n, x) => n + BigInt(x.amountMinor), 0n);
const norm = (s: string) => s.trim().replace(/\s+/g, "").toLowerCase();
const signature = (t: Transaction, s: Settings) =>
  JSON.stringify([
    target(t, s),
    t.currency,
    t.direction,
    t.amountMinor,
    dateOf(t, s),
  ]);
function range(t: Transaction[], s: Settings): [string, string] | null {
  const dates = t
    .map((x) => dateOf(x, s))
    .filter((x): x is string => !!x)
    .sort();
  return dates.length ? [dates[0], dates[dates.length - 1]] : null;
}
export function validateManual(
  m: ManualMatch,
  all: Transaction[],
  s: Settings,
): string | null {
  if (!m.bankIds.length || !m.ledgerIds.length)
    return "请同时选择银行与随手记记录";
  if (m.bankIds.length > 1 && m.ledgerIds.length > 1)
    return "第一版仅支持一对一、一对多或多对一";
  const ids = [...m.bankIds, ...m.ledgerIds];
  if (new Set(ids).size !== ids.length) return "同一记录不能重复使用";
  const byId = new Map(all.map((t) => [t.id, t]));
  const rows = ids.map((id) => byId.get(id));
  if (rows.some((t) => !t)) return "原记录已不存在，人工匹配失效";
  const ts = rows as Transaction[];
  if (ts.some((t) => t.duplicateOf))
    return "可靠编号重复副本已排除，不能参与人工匹配";
  const banks = ts.slice(0, m.bankIds.length),
    ledger = ts.slice(m.bankIds.length);
  if (
    banks.some((t) => t.source === "suishouji") ||
    ledger.some((t) => t.source !== "suishouji")
  )
    return "记录来源不正确";
  const a = target(ts[0], s);
  if (!a || !s.accountIds.includes(a) || ts.some((t) => target(t, s) !== a))
    return "账户不同或未映射";
  if (
    ts.some(
      (t) =>
        t.currency !== "CNY" ||
        t.direction !== ts[0].direction ||
        !["income", "expense"].includes(t.direction),
    )
  )
    return "币种或方向不一致，转账需核实后修订来源文件";
  if (
    ts.some(
      (t) => !dateOf(t, s) || dateOf(t, s)! < s.start || dateOf(t, s)! > s.end,
    )
  )
    return "日期口径缺失或超出所选期间";
  if (sum(banks) !== sum(ledger)) return "银行与随手记金额合计必须一致";
  return null;
}
export function reconcile(
  input: Transaction[],
  s: Settings,
  manual: ManualMatch[] = [],
): Reconciliation {
  if (
    !s.start ||
    !s.end ||
    s.start > s.end ||
    !Number.isInteger(s.tolerance) ||
    s.tolerance < 0 ||
    s.tolerance > 31
  )
    throw new Error("请选择有效日期范围，日期容差须为 0–31 天");
  const deduplicated = deduplicateBankTransactions(input);
  const transactions = deduplicated.transactions.sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  if (new Set(transactions.map((t) => t.id)).size !== transactions.length)
    throw new Error("检测到重复记录 ID，请移除重复文件");
  const items: ResultItem[] = [],
    warnings: string[] = [...deduplicated.warnings],
    invalidManualIds: string[] = [];
  const used = new Set<string>();
  const add = (
    status: Status,
    b: Transaction[],
    l: Transaction[],
    reason: string,
    dayDifference?: number,
  ) => {
    const ids = [...b, ...l].map((t) => t.id).sort();
    items.push({
      id: JSON.stringify([status, ids]),
      status,
      bankIds: b.map((t) => t.id).sort(),
      ledgerIds: l.map((t) => t.id).sort(),
      reason,
      dayDifference,
      accountId: target(b[0] || l[0], s) || accountKey(l[0]),
    });
    ids.forEach((id) => used.add(id));
  };
  const single = (status: Status, t: Transaction, reason: string) =>
    add(
      status,
      t.source === "suishouji" ? [] : [t],
      t.source === "suishouji" ? [t] : [],
      reason,
    );
  for (const t of transactions)
    if (t.duplicateOf)
      single(
        "excluded-duplicate",
        t,
        "已确认跨文件可靠编号重复，不重复计入金额；原始副本保留供追溯。",
      );
  const coverage = new Map<string, [string, string] | null>();
  for (const a of s.accountIds) {
    const rows = transactions.filter(
      (t) => target(t, s) === a && t.currency === "CNY" && !t.duplicateOf,
    );
    const b = range(
        rows.filter((t) => t.source !== "suishouji"),
        s,
      ),
      l = range(
        rows.filter((t) => t.source === "suishouji"),
        s,
      );
    const common =
      b && l
        ? ([b[0] > l[0] ? b[0] : l[0], b[1] < l[1] ? b[1] : l[1]] as [
            string,
            string,
          ])
        : null;
    coverage.set(a, common);
    if (
      !common ||
      common[0] > common[1] ||
      common[0] > s.start ||
      common[1] < s.end
    )
      warnings.push(
        `账户 ${a} 的观测日期未覆盖整个所选期间；范围外记录不判定漏记或多记。`,
      );
  }
  for (const t of transactions) {
    if (t.duplicateOf) continue;
    const a = target(t, s),
      d = dateOf(t, s),
      c = coverage.get(a);
    if (!a || !s.accountIds.includes(a))
      single("unmapped", t, "账户未映射或未选中，未纳入本次对账");
    else if (t.currency !== "CNY" || t.direction === "unknown")
      single("unsupported", t, "第一版仅自动对账 CNY 且收支方向明确的记录");
    else if (!d || d < s.start || d > s.end || !c || d < c[0] || d > c[1])
      single(
        "outside",
        t,
        !d
          ? "所选日期口径缺失，不回退到另一日期"
          : "超出共同观测范围或所选期间，不能据此判定漏记",
      );
    else if (t.direction === "transfer")
      single(
        "transfer",
        t,
        "转账单独保留，不计为消费；请核实各账户收支，第一版不推断还款性质",
      );
  }
  for (const m of [...manual].sort((a, b) => a.id.localeCompare(b.id))) {
    const error = validateManual(m, transactions, s);
    if (error || [...m.bankIds, ...m.ledgerIds].some((id) => used.has(id))) {
      invalidManualIds.push(m.id);
      warnings.push(`人工匹配失效：${error || "记录已占用或覆盖范围不足"}`);
      continue;
    }
    add(
      "manual",
      transactions.filter((t) => m.bankIds.includes(t.id)),
      transactions.filter((t) => m.ledgerIds.includes(t.id)),
      "人工确认；账户、币种、方向及两侧金额合计已重新验证",
    );
  }
  const available = () => transactions.filter((t) => !used.has(t.id));
  const group = (rows: Transaction[], key: (t: Transaction) => string) => {
    const groups = new Map<string, Transaction[]>();
    for (const t of rows) {
      const k = key(t);
      const v = groups.get(k) || [];
      v.push(t);
      groups.set(k, v);
    }
    return groups;
  };
  if (s.confirmedExternalIds) {
    const g = group(
      available().filter((t) => !!t.externalTransactionId),
      (t) => JSON.stringify([target(t, s), t.externalTransactionId]),
    );
    for (const ts of g.values()) {
      const b = ts.filter((t) => t.source !== "suishouji"),
        l = ts.filter((t) => t.source === "suishouji");
      if (b.length > 1 || l.length > 1)
        add(
          "ambiguous",
          b,
          l,
          "已确认同义交易编号存在重复或冲突，不能自动占用；请核实原始记录",
        );
      else if (b.length === 1 && l.length === 1) {
        if (signature(b[0], s) === signature(l[0], s))
          add(
            "matched",
            b,
            l,
            "已确认同义交易编号 + 账户、币种、方向、金额、日期一致",
          );
        else
          add(
            b[0].direction !== l[0].direction
              ? "direction"
              : b[0].amountMinor !== l[0].amountMinor
                ? "amount"
                : "date",
            b,
            l,
            "同义交易编号一致，但日期、方向或金额存在冲突；必须人工核实，不能自动标为成功",
          );
      }
    }
  }
  for (const ts of group(available(), (t) => signature(t, s)).values()) {
    const b = ts.filter((t) => t.source !== "suishouji"),
      l = ts.filter((t) => t.source === "suishouji");
    if (b.length === 1 && l.length === 1)
      add("matched", b, l, "唯一双向候选：账户、CNY、方向、金额及日期完全一致");
    else if (b.length > 1 || l.length > 1)
      add(
        "duplicate",
        b,
        l,
        "同账户同日同方向同金额多笔，保留所有原记录；不能自动合并或确认",
      );
  }
  const remaining = available();
  const banks = remaining.filter((t) => t.source !== "suishouji");
  const ledger = remaining.filter((t) => t.source === "suishouji");
  const byAmount = group(ledger, (t) =>
    JSON.stringify([target(t, s), t.amountMinor]),
  );
  const byText = group(ledger, (t) =>
    JSON.stringify([target(t, s), dateOf(t, s), norm(t.description)]),
  );
  const edges = new Map<string, Set<string>>(),
    kinds = new Map<string, Status>();
  let comparisons = 0;
  for (const b of banks) {
    const candidates = new Map<string, Transaction>();
    for (const l of byAmount.get(
      JSON.stringify([target(b, s), b.amountMinor]),
    ) || [])
      candidates.set(l.id, l);
    if (norm(b.description))
      for (const l of byText.get(
        JSON.stringify([target(b, s), dateOf(b, s), norm(b.description)]),
      ) || [])
        candidates.set(l.id, l);
    for (const l of candidates.values()) {
      if (++comparisons > 200000)
        throw new Error("候选组合过多，请缩短对账期间或按账户分别处理");
      const days = Math.abs(
        dayNumber(dateOf(b, s)!) - dayNumber(dateOf(l, s)!),
      );
      const text =
        !!norm(b.description) && norm(b.description) === norm(l.description);
      let kind: Status | undefined;
      if (
        b.amountMinor === l.amountMinor &&
        b.direction === l.direction &&
        (days <= s.tolerance || (text && days <= 31))
      )
        kind = "date";
      else if (
        b.amountMinor === l.amountMinor &&
        b.direction !== l.direction &&
        days === 0 &&
        text
      )
        kind = "direction";
      else if (
        b.amountMinor !== l.amountMinor &&
        b.direction === l.direction &&
        days === 0 &&
        text
      )
        kind = "amount";
      if (kind) {
        for (const [x, y] of [
          [b.id, l.id],
          [l.id, b.id],
        ]) {
          const v = edges.get(x) || new Set<string>();
          v.add(y);
          edges.set(x, v);
        }
        kinds.set(JSON.stringify([b.id, l.id]), kind);
      }
    }
  }
  const byId = new Map(remaining.map((t) => [t.id, t]));
  const visited = new Set<string>();
  for (const root of remaining) {
    if (visited.has(root.id) || !edges.has(root.id)) continue;
    const ids: string[] = [],
      stack = [root.id];
    while (stack.length) {
      const id = stack.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      ids.push(id);
      for (const n of edges.get(id) || []) stack.push(n);
    }
    const ts = ids.map((id) => byId.get(id)!);
    const b = ts.filter((t) => t.source !== "suishouji"),
      l = ts.filter((t) => t.source === "suishouji");
    const status =
      b.length === 1 && l.length === 1
        ? kinds.get(JSON.stringify([b[0].id, l[0].id]))!
        : "ambiguous";
    const days =
      b.length === 1 && l.length === 1
        ? Math.abs(dayNumber(dateOf(b[0], s)!) - dayNumber(dateOf(l[0], s)!))
        : undefined;
    add(
      status,
      b,
      l,
      status === "date"
        ? `金额与方向一致，日期相差 ${days} 天（设置容差 ${s.tolerance} 天），需人工确认`
        : status === "amount"
          ? "同日、同方向且摘要一致，金额不同；仅为疑似关系"
          : status === "direction"
            ? "同日同金额且摘要一致，但方向相反；不能确认为匹配"
            : "存在多种候选关系，请逐条核实；摘要仅作线索",
      days,
    );
  }
  for (const t of available())
    single(
      t.source === "suishouji" ? "extra" : "missing",
      t,
      t.source === "suishouji"
        ? "共同观测范围内，银行未找到对应记录；疑似多记，需核实"
        : "共同观测范围内，随手记未找到对应记录；疑似漏记，需核实",
    );
  items.sort(
    (a, b) =>
      a.accountId.localeCompare(b.accountId) || a.id.localeCompare(b.id),
  );
  return { items, warnings, invalidManualIds, transactions };
}
export interface Summary {
  accountId: string;
  date: string;
  bankCount: number;
  ledgerCount: number;
  bankIncome: string;
  ledgerIncome: string;
  bankExpense: string;
  ledgerExpense: string;
  incomeDifference: string;
  expenseDifference: string;
}
export function summarize(
  all: Transaction[],
  s: Settings,
  daily = false,
): Summary[] {
  const groups = new Map<string, { a: string; d: string; ts: Transaction[] }>();
  for (const t of all) {
    const a = target(t, s),
      d = dateOf(t, s);
    if (
      t.duplicateOf ||
      !a ||
      !s.accountIds.includes(a) ||
      t.currency !== "CNY" ||
      !d ||
      d < s.start ||
      d > s.end
    )
      continue;
    const key = JSON.stringify([a, daily ? d : "期间"]);
    const g = groups.get(key) || { a, d: daily ? d : "期间", ts: [] };
    g.ts.push(t);
    groups.set(key, g);
  }
  return [...groups.values()]
    .map(({ a, d, ts }) => {
      const b = ts.filter((t) => t.source !== "suishouji"),
        l = ts.filter((t) => t.source === "suishouji");
      const bi = sum(b.filter((t) => t.direction === "income")),
        be = sum(b.filter((t) => t.direction === "expense")),
        li = sum(l.filter((t) => t.direction === "income")),
        le = sum(l.filter((t) => t.direction === "expense"));
      return {
        accountId: a,
        date: d,
        bankCount: b.length,
        ledgerCount: l.length,
        bankIncome: bi.toString(),
        ledgerIncome: li.toString(),
        bankExpense: be.toString(),
        ledgerExpense: le.toString(),
        incomeDifference: (bi - li).toString(),
        expenseDifference: (be - le).toString(),
      };
    })
    .sort(
      (a, b) =>
        a.accountId.localeCompare(b.accountId) || a.date.localeCompare(b.date),
    );
}
