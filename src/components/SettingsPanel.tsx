import type { Transaction } from "../domain/transactions/types";
import { maskAccount, sourceNames } from "../domain/transactions/types";
import { accountKey, type Settings } from "../domain/reconciliation/types";
export function SettingsPanel({
  transactions,
  settings,
  onChange,
  onRun,
  busy,
  canRun,
}: {
  transactions: Transaction[];
  settings: Settings;
  onChange: (s: Settings) => void;
  onRun: () => void;
  busy: boolean;
  canRun: boolean;
}) {
  const bankAccounts = [
    ...new Map(
      transactions
        .filter((t) => t.source !== "suishouji")
        .map((t) => [accountKey(t), t]),
    ).entries(),
  ];
  const ledgerAccounts = [
    ...new Map(
      transactions
        .filter((t) => t.source === "suishouji")
        .map((t) => [accountKey(t), t]),
    ).entries(),
  ];
  const change = (p: Partial<Settings>) => onChange({ ...settings, ...p });
  return (
    <section className="panel" id="settings">
      <div className="section-heading">
        <div>
          <span className="step-number">02</span>
          <h2>设置对账规则</h2>
        </div>
        <span className="muted">金额、方向、币种、账户严格隔离</span>
      </div>
      <div className="settings-layout">
        <div className="account-mapping">
          <h3>关联账户</h3>
          <p className="muted">将随手记账户对应到实际银行账户。</p>
          {ledgerAccounts.length === 0 ? (
            <div className="empty-small">确认文件字段后，账户会显示在这里</div>
          ) : (
            ledgerAccounts.map(([key, t]) => (
              <label className="account-row" key={key}>
                <span title="账户已脱敏">
                  {maskAccount(t.accountName)}
                  <small>随手记</small>
                </span>
                <span className="arrow">→</span>
                <select
                  aria-label={`映射账户-${maskAccount(t.accountName)}`}
                  value={settings.mappings[key] || ""}
                  onChange={(e) =>
                    change({
                      mappings: { ...settings.mappings, [key]: e.target.value },
                    })
                  }
                >
                  <option value="">未纳入本次对账</option>
                  {bankAccounts.map(([k, b]) => (
                    <option key={k} value={k}>
                      {sourceNames[b.source] || b.source} ·{" "}
                      {maskAccount(b.accountName)}
                    </option>
                  ))}
                </select>
              </label>
            ))
          )}
          {bankAccounts.length > 0 && (
            <div className="selected-accounts">
              <p className="eyebrow">参与对账的银行账户</p>
              {bankAccounts.map(([key, t]) => (
                <label className="check" key={key}>
                  <input
                    type="checkbox"
                    checked={settings.accountIds.includes(key)}
                    onChange={(e) =>
                      change({
                        accountIds: e.target.checked
                          ? [...settings.accountIds, key]
                          : settings.accountIds.filter((k) => k !== key),
                      })
                    }
                  />
                  {sourceNames[t.source] || t.source} ·{" "}
                  {maskAccount(t.accountName)}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="rule-settings">
          <h3>共同对账期间</h3>
          <div className="date-range">
            <label>
              开始日期
              <input
                aria-label="开始日期"
                type="date"
                value={settings.start}
                onChange={(e) => change({ start: e.target.value })}
              />
            </label>
            <span>—</span>
            <label>
              结束日期
              <input
                aria-label="结束日期"
                type="date"
                value={settings.end}
                onChange={(e) => change({ end: e.target.value })}
              />
            </label>
          </div>
          <div className="form-grid">
            <label>
              日期口径
              <select
                value={settings.dateBasis}
                onChange={(e) =>
                  change({ dateBasis: e.target.value as Settings["dateBasis"] })
                }
              >
                <option value="transactionDate">交易日期</option>
                <option value="postingDate">入账日期</option>
              </select>
            </label>
            <label>
              日期容差（天）
              <input
                type="number"
                min="0"
                max="31"
                value={settings.tolerance}
                onChange={(e) => change({ tolerance: Number(e.target.value) })}
              />
            </label>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.confirmedExternalIds}
              onChange={(e) =>
                change({ confirmedExternalIds: e.target.checked })
              }
            />
            已核实两侧交易编号含义一致，优先按编号匹配
          </label>
          <p className="muted">
            默认同日匹配；日期不同仅生成待确认关系。首末交易日不代表完整账期，请核实导出范围与中间缺页。
          </p>
        </div>
      </div>
      <div className="run-footer">
        <span>{transactions.length} 条有效记录 · 不以总额相等代替逐笔核对</span>
        <button
          className="primary"
          disabled={
            busy ||
            !canRun ||
            !settings.accountIds.length ||
            !settings.start ||
            !settings.end
          }
          onClick={onRun}
        >
          {busy ? "正在本地处理…" : "开始对账"} <span>→</span>
        </button>
      </div>
    </section>
  );
}
