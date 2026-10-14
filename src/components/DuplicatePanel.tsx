import type { Deduplication } from "../domain/reconciliation/deduplicate";
import type { ImportedFile } from "./types";
import { maskAccount, money, sourceNames } from "../domain/transactions/types";
export function DuplicatePanel({
  report,
  files,
}: {
  report: Deduplication;
  files: ImportedFile[];
}) {
  if (!report.groups.length) return null;
  const names = new Map(files.map((f) => [f.file.id, f.file.name]));
  return (
    <details className="panel duplicate-notice" open>
      <summary>{report.warnings[0]}</summary>
      <p>
        可靠重复副本不会重复计入支出或余额。疑似重叠和编号冲突保留，请核实文件的账期；不要仅凭日期与金额相同就删除流水。
      </p>
      {report.groups.slice(0, 30).map((group, i) => (
        <details key={i}>
          <summary>
            {group.kind === "excluded"
              ? "已排除重复副本"
              : group.kind === "conflict"
                ? "交易编号冲突，待核实"
                : "疑似账期重叠，待核实"}{" "}
            · {group.records.length} 条原始记录
          </summary>
          <p>{group.reason}</p>
          {group.records.slice(0, 100).map((t) => (
            <p key={t.id}>
              {sourceNames[t.source]} · {maskAccount(t.accountName)} ·{" "}
              {t.transactionDate || t.postingDate} · {money(t.amountMinor)} 元 ·{" "}
              {maskAccount(names.get(t.sourceFileId) || "")} / {t.sheetName} /
              第 {t.originalRowNumber} 行
              {t.duplicateOf ? "（重复副本，未计入）" : ""}
            </p>
          ))}
          {group.records.length > 100 && (
            <p>
              另有 {group.records.length - 100}{" "}
              条，完整位置保留在原文件和报告中。
            </p>
          )}
        </details>
      ))}
      {report.groups.length > 30 && (
        <p>
          另有 {report.groups.length - 30} 组，请在原始文件和逐笔结果中核实。
        </p>
      )}
    </details>
  );
}
