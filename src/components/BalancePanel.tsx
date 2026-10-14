import { useMemo, useState } from "react";
import {
  accountKey,
  type Reconciliation,
  type Settings,
} from "../domain/reconciliation/types";
import {
  balanceDays,
  expenseClues,
  signedMoney,
  total,
  type BalanceInput,
  type BalanceDay,
} from "../domain/reconciliation/balances";
import {
  maskAccount,
  money,
  sourceNames,
  type Transaction,
} from "../domain/transactions/types";
import type { ImportedFile } from "./types";

const clueText = {
  transfer: "可能对应随手记转账，已单独列出供核实",
  same: "同日同额，可对照交易对象核实",
  amount: "可能金额填错：核实后将随手记改为银行金额",
  missing: "随手记未找到同日同额支出：核实日期和对象后补记",
  extra: "银行未找到同日同额支出：检查随手记是否多记、日期或账户填错",
  ambiguous: "同额记录有多笔，请逐条核实，暂不指定对应关系",
};
function DayDetails({
  day,
  files,
}: {
  day: BalanceDay;
  files: ImportedFile[];
}) {
  const [page, setPage] = useState(0);
  const allClues = useMemo(() => expenseClues(day.bank, day.ledger), [day]);
  const clues = allClues.filter((c) => c.kind !== "transfer");
  const transferBankIds = new Set(
    allClues
      .filter((c) => c.kind === "transfer")
      .flatMap((c) => c.bank.map((t) => t.id)),
  );
  const fileNames = new Map(files.map((f) => [f.file.id, f.file.name]));
  const line = (t: Transaction) => (
    <div className="balance-transaction" key={t.id}>
      <strong>
        {money(t.amountMinor)} 元{t.isTransfer ? " · 账户转账" : ""}
      </strong>
      <span>交易对象：{maskAccount(t.counterparty || "未提供")}</span>
      <span>{maskAccount(t.description || t.note || "无摘要")}</span>
      {t.note && t.note !== t.description && (
        <small>备注：{maskAccount(t.note)}</small>
      )}
      <small>
        {maskAccount(fileNames.get(t.sourceFileId) || "")} ·{" "}
        {maskAccount(t.sheetName || "")} · 第 {t.originalRowNumber} 行
      </small>
    </div>
  );
  const other = (ts: Transaction[]) =>
    ts.filter(
      (t) =>
        t.direction !== "expense" ||
        t.isTransfer ||
        transferBankIds.has(t.id) ||
        t.currency !== "CNY",
    );
  return (
    <div className="balance-day-details">
      {day.state === "equal" ? (
        <p>当天本账户余额一致，按你的规则无需逐笔提示。</p>
      ) : (
        <>
          <p>
            以银行为准修改随手记。下列是当天的核对线索，补记前请核对日期、账户和交易对象。
          </p>
          {day.change === "0" && day.state === "different" && (
            <p className="notice">
              余额差额与前一天相同，可能是前面日期的差异延续，请先检查更早的异常日。
            </p>
          )}
          <div className="table-scroll">
            <table className="balance-expenses">
              <thead>
                <tr>
                  <th>银行支出（基准）</th>
                  <th>随手记支出</th>
                  <th>需要核实什么</th>
                </tr>
              </thead>
              <tbody>
                {clues.slice(page * 30, page * 30 + 30).map((c, i) => (
                  <tr
                    key={i}
                    className={c.kind === "same" ? "" : "expense-problem"}
                  >
                    <td>
                      {c.bank.map(line)}
                      {!c.bank.length && "未找到同日对应记录"}
                    </td>
                    <td>
                      {c.ledger.map(line)}
                      {!c.ledger.length && "未找到同日对应记录"}
                    </td>
                    <td>
                      <strong>{clueText[c.kind]}</strong>
                      {c.kind === "amount" && (
                        <p>
                          银行 {money(c.bank[0].amountMinor)} 元；随手记{" "}
                          {money(c.ledger[0].amountMinor)} 元；金额差{" "}
                          {money(
                            BigInt(c.bank[0].amountMinor) -
                              BigInt(c.ledger[0].amountMinor),
                          )}{" "}
                          元。
                        </p>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!clues.length && (
            <p className="muted">
              当天没有人民币消费支出。请检查期初余额，以及下方收入和转账。
            </p>
          )}
          {clues.length > 30 && (
            <div className="pagination">
              <button disabled={!page} onClick={() => setPage(page - 1)}>
                前一页支出
              </button>
              <span>
                {page + 1} / {Math.ceil(clues.length / 30)}
              </span>
              <button
                disabled={(page + 1) * 30 >= clues.length}
                onClick={() => setPage(page + 1)}
              >
                后一页支出
              </button>
            </div>
          )}
          <details className="balance-other">
            <summary>
              收入、转账及其他记录（单独查看，共{" "}
              {other(day.bank).length + other(day.ledger).length} 条）
            </summary>
            {transferBankIds.size > 0 && (
              <p className="muted">
                银行有同日同额记录可能对应随手记转账，暂列于此供核实，不作为漏记消费提示。
              </p>
            )}
            <div className="balance-other-columns">
              {[
                [day.bank, "银行"],
                [day.ledger, "随手记"],
              ].map(([ts, label]) => (
                <div key={label as string}>
                  <h4>{label as string}</h4>
                  {other(ts as Transaction[]).map((t) => (
                    <div key={t.id}>
                      <small>
                        {t.isTransfer
                          ? "账户转账"
                          : t.direction === "income"
                            ? "收入"
                            : t.direction === "expense"
                              ? "支出"
                              : "方向待核实"}{" "}
                        · {t.currency}
                      </small>
                      {line(t)}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </>
      )}
    </div>
  );
}
function BankClosingInput({
  date,
  value,
  onSave,
}: {
  date: string;
  value: string;
  onSave: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  return (
    <div className="bank-balance-input">
      <label>
        {date} 银行已核实日终余额
        <input
          aria-label={`${date}银行日终余额`}
          inputMode="decimal"
          value={draft}
          placeholder="从本账户账单核实后填写"
          onChange={(e) => setDraft(e.target.value)}
        />
      </label>
      <button onClick={() => onSave(draft)}>确认此日余额</button>
    </div>
  );
}
export function BalancePanel({
  result,
  settings,
  files,
  inputs,
  onInput,
}: {
  result: Reconciliation;
  settings: Settings;
  files: ImportedFile[];
  inputs: Record<string, BalanceInput>;
  onInput: (key: string, value: BalanceInput) => void;
}) {
  const accounts = [
    ...new Map(
      result.transactions
        .filter(
          (t) =>
            t.source !== "suishouji" &&
            t.source !== "cmb-credit" &&
            settings.accountIds.includes(accountKey(t)),
        )
        .map((t) => [accountKey(t), t]),
    ).entries(),
  ];
  const [selected, setSelected] = useState(""),
    [showEqual, setShowEqual] = useState(false),
    [page, setPage] = useState(0);
  const key = accounts.some(([k]) => k === selected)
    ? selected
    : accounts[0]?.[0] || "";
  const bank = useMemo(
    () =>
      result.transactions.filter(
        (t) => accountKey(t) === key && !t.duplicateOf,
      ),
    [result, key],
  );
  const ledger = useMemo(
    () =>
      result.transactions.filter(
        (t) =>
          t.source === "suishouji" && settings.mappings[accountKey(t)] === key,
      ),
    [result, settings, key],
  );
  const dates = ledger
    .flatMap((t) =>
      t.transactionDate &&
      t.transactionDate >= settings.start &&
      t.transactionDate <= settings.end
        ? [t.transactionDate]
        : [],
    )
    .sort();
  const defaultStart = dates[0] || settings.start;
  const accountDates = [...bank, ...ledger]
    .flatMap((t) =>
      t.transactionDate && t.transactionDate <= settings.end
        ? [t.transactionDate]
        : [],
    )
    .sort();
  const reviewEnd = accountDates.at(-1) || settings.end;
  const input = inputs[key] || {
    start: defaultStart,
    opening: "",
    complete: false,
    bankClosing: {},
  };
  const change = (p: Partial<BalanceInput>) => {
    onInput(key, { ...input, ...p });
    setPage(0);
  };
  const relevantFileIds = new Set(
    [...bank, ...ledger].map((t) => t.sourceFileId),
  );
  const issues: string[] = [];
  if (bank.some((t) => t.duplicateIssue))
    issues.push(
      "本账户存在跨文件疑似重叠或编号冲突，请先核实，余额暂不判为正常",
    );
  if (!ledger.length) issues.push("尚未关联随手记账户，请先在第 2 步关联");
  if (
    files.some(
      (f) =>
        (relevantFileIds.has(f.file.id) || f.source === "suishouji") &&
        (f.parseError || (f.result?.errors.length || 0) > 0),
    )
  )
    issues.push("相关文件存在解析错误，请先修复，避免漏算余额");
  if (
    files.some(
      (f) =>
        f.source === "suishouji" &&
        f.file.sheets.length > 1 &&
        f.file.sheets.every((s) => ["支出", "收入", "转账"].includes(s.name)) &&
        !f.options.allSheets,
    )
  )
    issues.push(
      "随手记未启用全部工作表，请在文件字段设置中同时解析支出、收入和转账",
    );
  if (input.start < settings.start || input.start > settings.end)
    issues.push("开始核对日期不在第 2 步选择的期间内");
  const days = useMemo(
    () => balanceDays(bank, ledger, input, reviewEnd, issues),
    [bank, ledger, input, reviewEnd, issues.join("|")],
  );
  const visible = days.filter((d) => showEqual || d.state !== "equal");
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(visible.length / 31) - 1),
  );
  let openingError = "";
  try {
    signedMoney(input.opening);
  } catch {
    openingError = "请输入有效金额，最多两位小数，可为负数。";
  }
  return (
    <section className="panel balance-panel" id="balance-results">
      <div className="section-heading">
        <div>
          <span className="step-number">03</span>
          <h2>按账户逐日核对余额</h2>
        </div>
        <span className="muted">银行为准 · 日期从旧到新 · 人民币</span>
      </div>
      {!accounts.length ? (
        <p>
          尚无借记卡或微信账户可核对。请导入并关联账户；信用卡请切换到“信用卡与逐笔核对”。
        </p>
      ) : (
        <>
          <div className="balance-controls">
            <label>
              选择银行 / 支付账户
              <select
                aria-label="余额核对账户"
                value={key}
                onChange={(e) => {
                  setSelected(e.target.value);
                  setPage(0);
                }}
              >
                {accounts.map(([k, t]) => (
                  <option key={k} value={k}>
                    {sourceNames[t.source] || t.source} ·{" "}
                    {maskAccount(t.accountName)}
                  </option>
                ))}
              </select>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={showEqual}
                onChange={(e) => {
                  setShowEqual(e.target.checked);
                  setPage(0);
                }}
              />
              显示余额相等的日期
            </label>
          </div>
          {bank[0]?.source === "wechat" && (
            <p className="notice">
              微信账单只核对零钱支出；零钱通、银行卡支付、收入及其他记录已忽略。筛选后的流水不能推算零钱余额，日终余额需自行核实填写。
            </p>
          )}
          <div className="balance-setup">
            <p>
              先输入随手记的起始余额。网站会计入这个账户每天的收入、支出和转账，计算日终余额；重点展开支出供你核对。
            </p>
            <div className="form-grid">
              <label>
                从哪天开始核对
                <input
                  aria-label="余额开始日期"
                  type="date"
                  min={settings.start}
                  max={settings.end}
                  value={input.start}
                  onChange={(e) =>
                    change({
                      start: e.target.value,
                      opening: "",
                      complete: false,
                    })
                  }
                />
              </label>
              <label>
                开始核对日前一天的随手记日终余额
                <input
                  aria-label="随手记期初余额"
                  inputMode="decimal"
                  placeholder="请从随手记查看后填写，例如 1000.00"
                  value={input.opening}
                  onChange={(e) => change({ opening: e.target.value })}
                />
                <small>
                  {input.start
                    ? `${input.start} 当天收支发生之前的余额`
                    : "请先选择开始日期"}
                </small>
              </label>
            </div>
            {openingError && <p className="error-box">{openingError}</p>}
            <label className="check">
              <input
                type="checkbox"
                checked={input.complete}
                onChange={(e) => change({ complete: e.target.checked })}
              />
              我已确认本账户在核对期间的账单完整，随手记包含收入、支出和转账
            </label>
            <p className="muted">
              已关联随手记：
              {[...new Set(ledger.map((t) => maskAccount(t.accountName)))].join(
                "、",
              ) || "尚未关联"}
              。收入和转账单独收起展示，但会影响余额。未提供银行余额时，需填写已核实的当日日终余额。
            </p>
          </div>
          <p className="balance-counts">
            本账户 {input.start} 至 {reviewEnd}，共 {days.length} 天 · 余额相等{" "}
            {days.filter((d) => d.state === "equal").length} 天 · 余额不等{" "}
            {days.filter((d) => d.state === "different").length} 天 · 待补充 /
            核实 {days.filter((d) => d.state === "unknown").length} 天
          </p>
          {visible.slice(currentPage * 31, currentPage * 31 + 31).map((day) => (
            <details
              className={`balance-day balance-${day.state}`}
              key={`${key}:${day.date}`}
            >
              <summary>
                <strong>{day.date}</strong>
                <span
                  className={`pill ${day.state === "equal" ? "green" : "amber"}`}
                >
                  {day.state === "equal"
                    ? "余额相等"
                    : day.state === "different"
                      ? "余额不等"
                      : "余额待核实"}
                </span>
                <span>
                  银行{" "}
                  <b>
                    {day.bankClosing === undefined
                      ? "待补充"
                      : money(day.bankClosing)}
                  </b>
                </span>
                <span>
                  随手记{" "}
                  <b>
                    {day.ledgerClosing === undefined
                      ? "待补充"
                      : money(day.ledgerClosing)}
                  </b>
                </span>
                <span>
                  差额（银行 − 随手记）
                  <b>
                    {day.difference === undefined ? "—" : money(day.difference)}
                  </b>
                </span>
              </summary>
              <div className="balance-day-body">
                {day.reason && <p className="warning-box">{day.reason}</p>}
                <p className="muted">
                  银行余额依据：{day.bankBasis}。当日支出及转出：银行{" "}
                  {money(
                    total(
                      day.bank.filter((t) => t.currency === "CNY"),
                      "expense",
                    ),
                  )}{" "}
                  / 随手记{" "}
                  {money(
                    total(
                      day.ledger.filter((t) => t.currency === "CNY"),
                      "expense",
                    ),
                  )}{" "}
                  元。收入及转入：银行{" "}
                  {money(
                    total(
                      day.bank.filter((t) => t.currency === "CNY"),
                      "income",
                    ),
                  )}{" "}
                  / 随手记{" "}
                  {money(
                    total(
                      day.ledger.filter((t) => t.currency === "CNY"),
                      "income",
                    ),
                  )}{" "}
                  元。
                </p>
                {(day.bankClosing === undefined ||
                  input.bankClosing[day.date] !== undefined) && (
                  <BankClosingInput
                    key={`${key}:${day.date}`}
                    date={day.date}
                    value={input.bankClosing[day.date] || ""}
                    onSave={(value) =>
                      change({
                        bankClosing: {
                          ...input.bankClosing,
                          [day.date]: value,
                        },
                      })
                    }
                  />
                )}
                <DayDetails day={day} files={files} />
              </div>
            </details>
          ))}
          {!visible.length && (
            <p className="empty-small">
              {days.length
                ? "本账户所选期间的日终余额全部相等，已隐藏。打开上方开关可查看。"
                : "请选择有效的核对日期范围。"}
            </p>
          )}
          {visible.length > 31 && (
            <div className="pagination">
              <button
                disabled={!currentPage}
                onClick={() => setPage(currentPage - 1)}
              >
                前一页日期
              </button>
              <span>
                {currentPage + 1} / {Math.ceil(visible.length / 31)}
              </span>
              <button
                disabled={(currentPage + 1) * 31 >= visible.length}
                onClick={() => setPage(currentPage + 1)}
              >
                后一页日期
              </button>
            </div>
          )}
          <p className="subtle-note">
            改完随手记后重新导入、点击“开始对账”，余额会重新计算。只有同一账户的两个日终余额数字相等才按正常日隐藏。
          </p>
        </>
      )}
    </section>
  );
}
