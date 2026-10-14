import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { json } from "./database";
import { deduplicateBankTransactions } from "../src/domain/reconciliation/deduplicate";
import type { Transaction } from "../src/domain/transactions/types";
export async function refreshDuplicates(c: PoolConnection, source: string) {
  if (source === "suishouji") return { excluded: 0, conflicts: 0, possible: 0 };
  const [rows] = await c.execute<RowDataPacket[]>(
    "SELECT t.id,t.record,t.excluded_duplicate,t.duplicate_of,t.duplicate_issue FROM reconcile_transactions t JOIN reconcile_statements s ON s.id=t.statement_id WHERE s.source=?",
    [source],
  );
  const report = deduplicateBankTransactions(
    rows.map((r) => json<Transaction>(r.record)),
  );
  const ids = new Map(rows.map((r) => [json<Transaction>(r.record).id, r.id]));
  const byId = new Map(report.transactions.map((t) => [t.id, t]));
  const issueKind = new Map(
    report.groups.flatMap((g) =>
      g.kind === "excluded"
        ? []
        : g.records.map((t) => [t.id, g.kind] as const),
    ),
  );
  const changes: {
    id: number;
    excluded: number;
    duplicate: number | null;
    issue: string | null;
  }[] = [];
  for (const row of rows) {
    const t = byId.get(json<Transaction>(row.record).id)!;
    const duplicate = t.duplicateOf ? ids.get(t.duplicateOf) : null,
      excluded = t.duplicateOf ? 1 : 0,
      issue = issueKind.get(t.id) || null;
    if (
      Number(row.excluded_duplicate) !== excluded ||
      String(row.duplicate_of ?? "") !== String(duplicate ?? "") ||
      row.duplicate_issue !== issue
    )
      changes.push({
        id: row.id,
        excluded,
        duplicate: duplicate ?? null,
        issue,
      });
  }
  for (let offset = 0; offset < changes.length; offset += 200) {
    const batch = changes.slice(offset, offset + 200),
      clauses = batch.map(() => "WHEN ? THEN ?").join(" ");
    const values: unknown[] = [];
    for (const column of ["excluded", "duplicate", "issue"] as const)
      for (const row of batch) values.push(row.id, row[column]);
    values.push(batch.map((row) => row.id));
    await c.query(
      `UPDATE reconcile_transactions SET excluded_duplicate=CASE id ${clauses} ELSE excluded_duplicate END,duplicate_of=CASE id ${clauses} ELSE duplicate_of END,duplicate_issue=CASE id ${clauses} ELSE duplicate_issue END WHERE id IN (?)`,
      values,
    );
  }
  return {
    excluded: report.excludedCount,
    conflicts: report.groups.filter((g) => g.kind === "conflict").length,
    possible: report.groups.filter((g) => g.kind === "possible").length,
  };
}
