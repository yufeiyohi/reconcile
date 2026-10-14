import type { Transaction } from "../transactions/types";
export interface DuplicateGroup {
  kind: "excluded" | "conflict" | "possible";
  records: Transaction[];
  reason: string;
}
export interface Deduplication {
  transactions: Transaction[];
  groups: DuplicateGroup[];
  excludedCount: number;
  warnings: string[];
}
const normalized = (s: string | undefined) =>
  (s || "").trim().replace(/\s+/g, " ");
function trustedId(t: Transaction) {
  const id = t.externalTransactionId?.trim();
  if (
    t.source === "suishouji" ||
    !id ||
    /^(0+|-+|无|未知|N\/?A|null)$/i.test(id)
  )
    return false;
  const providerHeader = Object.entries(t.raw).some(
    ([key, value]) =>
      ((t.source === "wechat" && /:交易单号$/.test(key)) ||
        /:银行交易编号$/.test(key)) &&
      String(value).trim() === id,
  );
  return t.externalIdTrusted === true || providerHeader;
}
export function deduplicateBankTransactions(
  input: Transaction[],
): Deduplication {
  const transactions = input.map((t) => ({
    ...t,
    duplicateOf: undefined,
    duplicateIssue: undefined,
  }));
  const groups: DuplicateGroup[] = [],
    byReference = new Map<string, Transaction[]>();
  for (const t of transactions)
    if (trustedId(t)) {
      const key = JSON.stringify([
        t.source,
        t.accountId,
        t.externalTransactionId!.trim(),
      ]);
      const rows = byReference.get(key) || [];
      rows.push(t);
      byReference.set(key, rows);
    }
  for (const rows of byReference.values()) {
    if (new Set(rows.map((t) => t.sourceFileId)).size < 2) continue;
    rows.sort(
      (a, b) =>
        a.sourceFileId.localeCompare(b.sourceFileId) ||
        a.originalRowNumber - b.originalRowNumber ||
        a.id.localeCompare(b.id),
    );
    const signature = (t: Transaction) =>
      JSON.stringify([
        t.transactionDate,
        t.postingDate,
        t.direction,
        t.amountMinor,
        t.currency,
        t.isTransfer || false,
      ]);
    const same = new Set(rows.map(signature)).size === 1;
    const uniqueFile =
      new Set(rows.map((t) => t.sourceFileId)).size === rows.length;
    const optionalCompatible = (get: (t: Transaction) => string | undefined) =>
      new Set(
        rows
          .map(get)
          .filter((v) => !!v)
          .map((v) => normalized(v)),
      ).size <= 1;
    if (
      !same ||
      !uniqueFile ||
      !optionalCompatible((t) => t.balanceMinor) ||
      !optionalCompatible((t) => t.counterparty) ||
      !optionalCompatible((t) => t.description)
    ) {
      const reason =
        "同一银行账户的相同交易编号存在内容冲突或同文件重复，全部保留，请核实原始记录。";
      rows.forEach((t) => (t.duplicateIssue = reason));
      groups.push({ kind: "conflict", records: rows, reason });
      continue;
    }
    for (const duplicate of rows.slice(1)) duplicate.duplicateOf = rows[0].id;
    groups.push({
      kind: "excluded",
      records: rows,
      reason:
        "可靠交易编号及关键内容相同，保留一份计入对账；其余副本已排除，原始行仍可追溯。",
    });
  }
  const sameDay = new Map<string, Transaction[]>();
  for (const t of transactions)
    if (
      t.source !== "suishouji" &&
      !t.duplicateOf &&
      !t.duplicateIssue &&
      (t.transactionDate || t.postingDate)
    ) {
      const key = JSON.stringify([
        t.source,
        t.accountId,
        t.transactionDate || t.postingDate,
        t.direction,
        t.amountMinor,
        t.currency,
      ]);
      const rows = sameDay.get(key) || [];
      rows.push(t);
      sameDay.set(key, rows);
    }
  for (const rows of sameDay.values())
    if (new Set(rows.map((t) => t.sourceFileId)).size > 1) {
      if (
        rows.every(trustedId) &&
        new Set(rows.map((t) => t.externalTransactionId)).size === rows.length
      )
        continue;
      const reason =
        "不同文件存在同一账户、同日同额记录，缺少可靠唯一编号，不能自动删除，可能是账期重叠，也可能是多笔真实交易。";
      rows.forEach((t) => (t.duplicateIssue = reason));
      groups.push({ kind: "possible", records: rows, reason });
    }
  const excludedCount = transactions.filter((t) => t.duplicateOf).length;
  const warnings = groups.length
    ? [
        `跨文件检查：已排除 ${excludedCount} 条可靠编号重复副本；${groups.filter((g) => g.kind === "conflict").length} 组编号冲突、${groups.filter((g) => g.kind === "possible").length} 组疑似重叠仍保留。`,
      ]
    : [];
  return { transactions, groups, excludedCount, warnings };
}
