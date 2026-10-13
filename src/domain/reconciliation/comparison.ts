import type { Transaction } from "../transactions/types";
import type { Reconciliation, ResultItem } from "./types";
export interface DifferenceChange {
  kind: "resolved" | "remaining" | "added";
  item: ResultItem;
  records: Transaction[];
}
function differences(result: Reconciliation) {
  const lookup = new Map(result.transactions.map((t) => [t.id, t]));
  return result.items
    .filter((i) => !["matched", "manual"].includes(i.status))
    .map((item) => {
      const records = [...item.bankIds, ...item.ledgerIds].map((id) =>
        lookup.get(id)!,
      );
      const key = JSON.stringify([
        item.status,
        item.accountId,
        records
          .map((t) => [
            t.source,
            t.accountId,
            t.transactionDate,
            t.postingDate,
            t.amountMinor,
            t.direction,
            t.currency,
            t.description,
          ])
          .sort(),
      ]);
      return { key, item, records };
    });
}
/** Content comparison only: a missing old difference is not proof of correction. */
export function compareDifferences(
  previous: Reconciliation,
  current: Reconciliation,
): DifferenceChange[] {
  const old = differences(previous),
    next = differences(current);
  const remaining = new Map<string, typeof next>();
  for (const row of next) {
    const group = remaining.get(row.key) || [];
    group.push(row);
    remaining.set(row.key, group);
  }
  const changes: DifferenceChange[] = [];
  for (const row of old) {
    const match = remaining.get(row.key)?.shift();
    changes.push({
      kind: match ? "remaining" : "resolved",
      item: (match || row).item,
      records: (match || row).records,
    });
  }
  for (const rows of remaining.values())
    for (const row of rows)
      changes.push({ kind: "added", item: row.item, records: row.records });
  return changes;
}
