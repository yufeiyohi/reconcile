import type { Transaction } from "../domain/transactions/types";
import { maskAccount, sourceNames } from "../domain/transactions/types";
import { accountKey, type Settings } from "../domain/reconciliation/types";
import { suggestAccountMappings } from "../domain/reconciliation/suggest";
export function SettingsPanel({
  transactions,
  settings,
  onChange,
  onRun,
  busy,
  blockers,
}: {
  transactions: Transaction[];
  settings: Settings;
  onChange: (s: Settings) => void;
  onRun: () => void;
  busy: boolean;
  blockers: string[];
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
  const suggested = suggestAccountMappings(transactions);
  const linked = ledgerAccounts.filter(
    ([key]) => settings.mappings[key],
  ).length;
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
          <p className="muted">
            告诉网站：随手记里的某个账户，对应哪一份银行账单。名称能对上的已自动选好，请核对；用不到的账户保持“未纳入本次对账”即可。
          </p>
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
                {settings.mappings[key] &&
                  settings.mappings[key] === suggested[key] && (
                    <small className="auto-hint">已自动关联 · 请核对</small>
                  )}
              </label>
            ))
          )}
          {ledgerAccounts.length > 0 && linked === 0 && (
            <p className="warning-box">
              还没有关联任何账户，这样对账结果会全部显示“未纳入本次对账”。请至少关联一个。
            </p>
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
          <p className="muted">
            默认取已导入文件的首尾日期。两边都有记录的时间段，结果才可信。
          </p>
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
              按哪个日期比对
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
              允许日期相差几天
              <input
                type="number"
                min="0"
                max="31"
                value={settings.tolerance}
                onChange={(e) => change({ tolerance: Number(e.target.value) })}
              />
              <small className="field-hint">
                银行入账常比实际消费晚一两天，填 1～2 天较常见；填 0
                表示必须同一天。
              </small>
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
            我已核实两边的交易编号是同一套编号，优先按编号匹配（不确定就不要勾）
          </label>
          <p className="muted">
            默认同日匹配；日期不同仅生成待确认关系。首末交易日不代表完整账期，请核实导出范围与中间缺页。
          </p>
        </div>
      </div>
      <div className="run-footer">
        <span>
          {transactions.length} 条有效记录 · 不以总额相等代替逐笔核对
          {blockers.length > 0 && (
            <small className="blockers">
              还差 {blockers.length} 步才能开始：{blockers.join("；")}
            </small>
          )}
        </span>
        <button
          className="primary"
          disabled={busy || blockers.length > 0}
          onClick={onRun}
        >
          {busy ? "正在本地处理…" : "开始对账"} <span>→</span>
        </button>
      </div>
    </section>
  );
}
