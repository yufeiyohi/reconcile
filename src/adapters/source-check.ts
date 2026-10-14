import { adapterRegistry } from "./registry";
import type { ImportOptions, ParsedFile } from "./types";
export function inspectSource(source: string, file: ParsedFile) {
  const selected = adapterRegistry.get(source);
  if (!selected) throw new Error("来源不存在");
  const matches = [...adapterRegistry.values()].filter(
    (a) => a.detect(file).confidence >= 0.9,
  );
  if (matches.length > 1)
    return {
      kind: "mismatch" as const,
      message: `文件包含多个已识别来源（${matches.map((a) => a.displayName).join("、")}），请分开导出后上传到对应窗口。`,
    };
  if (matches[0] && matches[0].id !== source)
    return {
      kind: "mismatch" as const,
      message: `识别为“${matches[0].displayName}”账单，不能上传到“${selected.displayName}”窗口。请重新选择正确的流水导入窗口。`,
    };
  return matches.length
    ? {
        kind: "matched" as const,
        message: `已识别${selected.displayName}账单结构`,
      }
    : {
        kind: "unknown" as const,
        message: `无法识别这份文件的银行 / 来源。请核实它确实属于“${selected.displayName}”，不要只根据文件名判断。`,
      };
}
export function verifySource(
  source: string,
  file: ParsedFile,
  options: ImportOptions,
) {
  const check = inspectSource(source, file);
  if (check.kind === "mismatch") throw new Error(check.message);
  if (check.kind === "unknown" && !options.sourceConfirmed)
    throw new Error(check.message + "请勾选来源确认后重新解析。");
  return check;
}
