import type { ImportOptions, ParsedFile } from "../adapters/types";
import type { ParseResult } from "../domain/transactions/types";
export interface ImportedFile {
  key: string;
  source: string;
  file: ParsedFile;
  options: ImportOptions;
  result?: ParseResult;
  importedAt: string;
}
export interface Decision {
  status: "open" | "verified" | "revise";
  note: string;
}
export const decisionLabels = {
  open: "待处理",
  verified: "已核实，无需修改",
  revise: "准备修订随手记",
};
