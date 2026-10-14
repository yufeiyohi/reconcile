import type { ImportedFile, Decision } from "../src/components/types";
import type { Settings, ManualMatch } from "../src/domain/reconciliation/types";
import type { BalanceInput } from "../src/domain/reconciliation/balances";
export interface WorkspaceState {
  files: ImportedFile[];
  settings: Settings;
  manual: ManualMatch[];
  decisions: Record<string, Decision>;
  balanceInputs: Record<string, BalanceInput>;
}
export interface StoredFile extends ImportedFile {
  version: number;
  savedAt: string;
}
export interface StatementSummary {
  hash: string;
  source: string;
  name: string;
  version: number;
  rows: number;
  savedAt: string;
}
export interface AuditEvent {
  id: number;
  createdAt: string;
  actor: string;
  action: string;
  outcome: string;
  target: string;
  ip: string;
  details: Record<string, unknown>;
}
export interface WorkspaceResponse {
  revision: number;
  state: WorkspaceState;
}
