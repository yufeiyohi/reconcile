import { compareDifferences } from "../domain/reconciliation/comparison";
import { useMemo, useState } from "react";
import type {
  Reconciliation,
  Settings,
  ManualMatch,
  ResultItem,
  Status,
} from "../domain/reconciliation/types";
import { statusLabels, statusHelp } from "../domain/reconciliation/types";
import { summarize } from "../domain/reconciliation/engine";
import {
  maskAccount,
  money,
  sourceNames,
  type Transaction,
} from "../domain/transactions/types";
import { type Decision, type ImportedFile, decisionLabels } from "./types";
const success = (i: ResultItem) => ["matched", "manual"].includes(i.status);
export function ResultsPanel({
  result,
  settings,
  files,
  decisions,
  onDecision,
  onManual,
  onUndo,
  onReset,
  onExport,
  comparison,
  comparisonPrevious,
}: {
  result: Reconciliation | null;
  settings: Settings;
  files: ImportedFile[];
  decisions: Record<string, Decision>;
  onDecision: (id: string, d: Decision) => void;
  onManual: (b: string[], l: string[]) => void;
  onUndo: (item: ResultItem) => void;
  onReset: () => void;
  onExport: () => void;
  comparison: string;
  comparisonPrevious: Reconciliation | null;
}) {
  const [changePage, setChangePage] = useState(0);
  const [tab, setTab] = useState("differences"),
    [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [account, setAccount] = useState("all"),
    [page, setPage] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [detail, setDetail] = useState<string | null>(null);
  const lookup = useMemo(
    () => new Map(result?.transactions.map((t) => [t.id, t]) || []),
    [result],
  );
  const summaries = useMemo(
    () => (result ? summarize(result.transactions, settings) : []),
    [result, settings],
  );
  const daily = useMemo(
    () => (result ? summarize(result.transactions, settings, true) : []),
    [result, settings],
  );
  const changes = useMemo(
    () =>
      result && comparisonPrevious
        ? compareDifferences(comparisonPrevious, result)
        : [],
    [result, comparisonPrevious],
  );
  if (!result)
    return (
      <section className="panel result-empty" id="results">
        <div className="section-heading">
          <div>
            <span className="step-number">03</span>
            <h2>查看对账结果</h2>
          </div>
        </div>
        <div className="empty-illustration">
          <span>≋</span>
        </div>
        <h3>让每一笔收支，都有据可查</h3>
        <p>导入账单、关联账户后，差异与匹配结果将在这里展示。</p>
        <div className="empty-legend">
          <span>
            <i className="dot green-dot" />
            严格匹配
          </span>
          <span>
            <i className="dot amber-dot" />
            疑似差异
          </span>
          <span>
            <i className="dot blue-dot" />
            人工确认
          </span>
        </div>
      </section>
    );
  const filesById = new Map(files.map((f) => [f.file.id, f.file.name]));
  const rows = result.items.filter((i) => {
    const text = [
      i.reason,
      i.accountId,
      ...[...i.bankIds, ...i.ledgerIds].map((id) => {
        const t = lookup.get(id)!;
        return `${t.description} ${t.note} ${t.counterparty} ${t[settings.dateBasis]} ${money(t.amountMinor)}`;
      }),
    ]
      .join(" ")
      .toLowerCase();
    return (
      (tab === "all" || tab === "daily" || !success(i)) &&
      (filter === "all" || i.status === filter) &&
      (account === "all" || i.accountId === account) &&
      text.includes(search.toLowerCase())
    );
  });
  const visible = rows.slice(page * 30, page * 30 + 30);
  const filteredIds = new Set(
    rows.flatMap((i) => [...i.bankIds, ...i.ledgerIds]),
  );
  const filteredSummary = summarize(
    result.transactions.filter((t) => filteredIds.has(t.id)),
    settings,
  );
  const detailItem = result.items.find((i) => i.id === detail);
  const parseErrors = files.reduce(
    (n, f) => n + (f.result?.errors.length || 0),
    0,
  );
  const selection = selected.filter((id) => lookup.has(id));
  const banks = selection.filter(
      (id) => lookup.get(id)!.source !== "suishouji",
    ),
    ledger = selection.filter((id) => lookup.get(id)!.source === "suishouji");
  const transactionLine = (t: Transaction) => (
    <div className="tx-line" key={t.id}>
      <span className="tx-date">{t[settings.dateBasis] || "缺少日期"}</span>
      <strong className={t.direction === "income" ? "income" : "expense"}>
        {t.direction === "income" ? "+" : t.direction === "expense" ? "-" : ""}
        {money(t.amountMinor)} <small>{t.currency}</small>
      </strong>
      <span>
        {t.isTransfer ? "[账户转账 · 非消费] " : ""}
        {maskAccount(t.description) || "无摘要"}
      </span>
    </div>
  );
  const selectTx = (t: Transaction) => {
    const taken = result.items.some(
      (i) => success(i) && [...i.bankIds, ...i.ledgerIds].includes(t.id),
    );
    return (
      <label className="select-transaction" key={t.id}>
        <input
          type="checkbox"
          disabled={taken}
          checked={selection.includes(t.id)}
          onChange={(e) =>
            setSelected(
              e.target.checked
                ? [...selection, t.id]
                : selection.filter((id) => id !== t.id),
            )
          }
        />
        <span>
          {transactionLine(t)}
          <small>
            {sourceNames[t.source] || t.source} · {maskAccount(t.accountName)} ·{" "}
            {maskAccount(filesById.get(t.sourceFileId) || "")} /{" "}
            {maskAccount(t.sheetName || "")} /{" "}
            {t.originalPage ? `第 ${t.originalPage} 页 / ` : ""}第{" "}
            {t.originalRowNumber} 行
          </small>
          {t.counterparty && (
            <small>交易对方：{maskAccount(t.counterparty)}</small>
          )}
          {t.note && <small>备注：{maskAccount(t.note)}</small>}
          {t.transferGroupId &&
            result.transactions
              .filter(
                (peer) =>
                  peer.transferGroupId === t.transferGroupId &&
                  peer.id !== t.id,
              )
              .map((peer) => (
                <small key={peer.id}>
                  关联转账另一侧（仅追溯）：{maskAccount(peer.accountName)} ·{" "}
                  {peer.direction === "income" ? "转入" : "转出"}{" "}
                  {money(peer.amountMinor)} {peer.currency}；不跨账户自动配对
                </small>
              ))}
        </span>
      </label>
    );
  };
  return (
    <section className="panel" id="results">
      <div className="section-heading">
        <div>
          <span className="step-number">03</span>
          <h2>对账结果</h2>
        </div>
        <div className="actions">
          <button onClick={onReset}>清除人工决策</button>
          <button onClick={onExport}>↓ 导出 CSV 报告</button>
        </div>
      </div>
      <div className="metrics">
        <div>
          <small>纳入期间的原始记录</small>
          <strong>
            {summaries.reduce((n, s) => n + s.bankCount + s.ledgerCount, 0)}
          </strong>
          <span>银行 + 随手记 · CNY</span>
        </div>
        <div>
          <small>已匹配记录组</small>
          <strong className="income">
            {result.items.filter(success).length}
          </strong>
          <span>严格匹配 + 人工确认</span>
        </div>
        <div>
          <small>待核实记录组</small>
          <strong className="amber-text">
            {result.items.filter((i) => !success(i)).length}
          </strong>
          <span>含未映射、覆盖不足</span>
        </div>
        <div>
          <small>解析错误</small>
          <strong className={parseErrors ? "red-text" : ""}>
            {parseErrors}
          </strong>
          <span>
            {parseErrors
              ? "存在错误，不能判为全部成功"
              : "各文件错误行独立检查"}
          </span>
        </div>
      </div>
      <details className="reading-guide" open>
        <summary>第一次看结果？三步就够</summary>
        <ol>
          <li>
            看下面的「差异清单」：每一行是一组对不上的记录，左边是银行的、右边是随手记的。
          </li>
          <li>
            点「查看详情」：会说明这是什么情况、该怎么办，并给出记录在第几个文件、第几行。
          </li>
          <li>
            核实完在详情里标「已核实，无需修改」或「准备修订随手记」。这些标记只是你的备忘，不会改动金额和差额。
          </li>
        </ol>
        <p className="muted">
          所有结论都只是线索，需要你对照原始账单确认；网站不会自动修改随手记。
        </p>
      </details>
      {comparison && <div className="notice">{comparison}</div>}
      {changes.length > 0 && (
        <details className="notice">
          <summary>查看上次差异变化明细（{changes.length} 组）</summary>
          <p>“旧差异不再出现”不是确定已修正；以下按原始业务字段比较。</p>
          {changes
            .slice(changePage * 20, changePage * 20 + 20)
            .map((change, i) => (
              <div className="change-row" key={i}>
                <strong>
                  {
                    {
                      resolved: "旧差异不再出现",
                      remaining: "仍存在",
                      added: "新增或变化",
                    }[change.kind]
                  }{" "}
                  · {statusLabels[change.item.status]}
                </strong>
                <p>{maskAccount(change.item.accountId)}</p>
                {change.records.map((t) => (
                  <p key={t.id}>
                    {sourceNames[t.source] || t.source} ·{" "}
                    {t.transactionDate || t.postingDate || "日期缺失"} ·{" "}
                    {t.direction === "income"
                      ? "收入"
                      : t.direction === "expense"
                        ? "支出"
                        : "转账"}{" "}
                    {money(t.amountMinor)} {t.currency} ·{" "}
                    {maskAccount(t.description)} ·{" "}
                    {maskAccount(t.sheetName || "")} 第 {t.originalRowNumber} 行
                  </p>
                ))}
              </div>
            ))}
          <div className="pagination">
            <button
              disabled={!changePage}
              onClick={() => setChangePage(changePage - 1)}
            >
              前一页变化
            </button>
            <span>
              {changePage + 1} / {Math.ceil(changes.length / 20)}
            </span>
            <button
              disabled={(changePage + 1) * 20 >= changes.length}
              onClick={() => setChangePage(changePage + 1)}
            >
              后一页变化
            </button>
          </div>
        </details>
      )}
      {result.warnings.length > 0 && (
        <details className="warning-box" open>
          <summary>覆盖范围与人工决策警告（{result.warnings.length}）</summary>
          {result.warnings.map((w, i) => (
            <p key={i}>{maskAccount(w)}</p>
          ))}
        </details>
      )}
      <h3 className="summary-title">
        账户期间汇总{" "}
        <small>全部数据，不随筛选或人工标记改变；转账 / 未知方向单独展示</small>
      </h3>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>银行账户</th>
              <th>银行 / 账本笔数</th>
              <th>银行 / 账本收入</th>
              <th>收入差额</th>
              <th>银行 / 账本支出</th>
              <th>支出差额</th>
              <th>匹配 / 未匹配 / 待确认记录数</th>
            </tr>
          </thead>
          <tbody>
            {summaries.map((s) => {
              const items = result.items.filter(
                (i) => i.accountId === s.accountId,
              );
              const count = (items: ResultItem[]) =>
                items.reduce(
                  (n, i) => n + i.bankIds.length + i.ledgerIds.length,
                  0,
                );
              return (
                <tr key={s.accountId}>
                  <td>{maskAccount(s.accountId)}</td>
                  <td>
                    {s.bankCount} / {s.ledgerCount}
                  </td>
                  <td>
                    {money(s.bankIncome)} / {money(s.ledgerIncome)}
                  </td>
                  <td className={s.incomeDifference !== "0" ? "red-text" : ""}>
                    {money(s.incomeDifference)}
                  </td>
                  <td>
                    {money(s.bankExpense)} / {money(s.ledgerExpense)}
                  </td>
                  <td className={s.expenseDifference !== "0" ? "red-text" : ""}>
                    {money(s.expenseDifference)}
                  </td>
                  <td>
                    {count(items.filter(success))} /{" "}
                    {count(
                      items.filter((i) =>
                        ["missing", "extra"].includes(i.status),
                      ),
                    )}{" "}
                    /{" "}
                    {count(
                      items.filter(
                        (i) =>
                          !success(i) &&
                          !["missing", "extra"].includes(i.status),
                      ),
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="tabs">
        {[
          ["differences", "差异清单"],
          ["daily", "逐日汇总"],
          ["all", "全部记录"],
        ].map(([id, label]) => (
          <button
            className={tab === id ? "active" : ""}
            key={id}
            onClick={() => {
              setTab(id);
              setPage(0);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "daily" ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>账户</th>
                <th>日期</th>
                <th>银行 / 账本笔数</th>
                <th>银行 / 账本收入</th>
                <th>收入差额</th>
                <th>银行 / 账本支出</th>
                <th>支出差额</th>
              </tr>
            </thead>
            <tbody>
              {daily.map((s) => (
                <tr key={s.accountId + s.date}>
                  <td>{maskAccount(s.accountId)}</td>
                  <td>{s.date}</td>
                  <td>
                    {s.bankCount} / {s.ledgerCount}
                  </td>
                  <td>
                    {money(s.bankIncome)} / {money(s.ledgerIncome)}
                  </td>
                  <td>{money(s.incomeDifference)}</td>
                  <td>
                    {money(s.bankExpense)} / {money(s.ledgerExpense)}
                  </td>
                  <td>{money(s.expenseDifference)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <div className="filters">
            <input
              aria-label="搜索差异"
              placeholder="搜索摘要、备注、日期或金额…"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(0);
              }}
            />
            <select
              aria-label="筛选账户"
              value={account}
              onChange={(e) => {
                setAccount(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">全部账户</option>
              {[...new Set(result.items.map((i) => i.accountId))].map((a) => (
                <option key={a} value={a}>
                  {maskAccount(a)}
                </option>
              ))}
            </select>
            <select
              aria-label="筛选差异类别"
              value={filter}
              onChange={(e) => {
                setFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">全部类别</option>
              {Object.entries(statusLabels).map(([s, l]) => (
                <option key={s} value={s}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          {filter !== "all" && (
            <p className="status-help">
              <b>{statusLabels[filter as Status]}</b>
              {statusHelp[filter as Status]}
            </p>
          )}
          <p className="muted">
            当前筛选：{rows.length} 组，{filteredIds.size} 条记录 · 银行支出{" "}
            {money(
              filteredSummary.reduce((n, s) => n + BigInt(s.bankExpense), 0n),
            )}{" "}
            / 账本支出{" "}
            {money(
              filteredSummary.reduce((n, s) => n + BigInt(s.ledgerExpense), 0n),
            )}{" "}
            CNY。顶部汇总保持全部数据。
          </p>
          <div className="table-scroll result-table">
            <table>
              <thead>
                <tr>
                  <th>这是什么情况 / 账户</th>
                  <th>银行记录</th>
                  <th>随手记记录（或可能对应的记录）</th>
                  <th>金额差（银行 − 账本）</th>
                  <th>你的处理</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => {
                  const b = item.bankIds.map((id) => lookup.get(id)!),
                    l = item.ledgerIds.map((id) => lookup.get(id)!);
                  const net = (ts: Transaction[]) =>
                    ts.reduce(
                      (n, t) =>
                        n +
                        (t.direction === "income"
                          ? 1n
                          : t.direction === "expense"
                            ? -1n
                            : 0n) *
                          BigInt(t.amountMinor),
                      0n,
                    );
                  return (
                    <tr key={item.id}>
                      <td>
                        <span
                          className={`pill ${success(item) ? "green" : "amber"}`}
                          title={statusHelp[item.status]}
                        >
                          {statusLabels[item.status]}
                        </span>
                        <small>{maskAccount(item.accountId)}</small>
                      </td>
                      <td>
                        {b.slice(0, 3).map(transactionLine)}
                        {b.length > 3 && (
                          <small>另有 {b.length - 3} 条，查看详情</small>
                        )}
                        {!b.length && <span className="muted">未找到记录</span>}
                      </td>
                      <td>
                        {l.slice(0, 3).map(transactionLine)}
                        {l.length > 3 && (
                          <small>另有 {l.length - 3} 条，查看详情</small>
                        )}
                        {!l.length && <span className="muted">未找到记录</span>}
                      </td>
                      <td className={net(b) !== net(l) ? "red-text" : ""}>
                        {money(net(b) - net(l))}
                      </td>
                      <td>
                        {decisionLabels[decisions[item.id]?.status || "open"]}
                      </td>
                      <td>
                        <button
                          className="text-button"
                          onClick={() => setDetail(item.id)}
                        >
                          查看详情
                        </button>
                        {item.status === "manual" && (
                          <button
                            className="text-button"
                            onClick={() => onUndo(item)}
                          >
                            撤销匹配
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!rows.length && (
              <div className="empty-small">
                此筛选下没有记录。请同时查看解析错误与范围警告。
              </div>
            )}
          </div>
          <div className="pagination">
            <button disabled={page === 0} onClick={() => setPage(page - 1)}>
              上一页
            </button>
            <span>
              {page + 1} / {Math.max(1, Math.ceil(rows.length / 30))}
            </span>
            <button
              disabled={(page + 1) * 30 >= rows.length}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
      <details className="manual-panel">
        <summary>自己配对记录（一对一 / 一笔拆成多笔 / 多笔合成一笔）</summary>
        <p className="muted">
          在详情里勾选要配对的记录，再回到这里确认。只有同一账户、同为人民币、同一方向、金额合计一致才能配对。当前已选银行{" "}
          {banks.length} 条、随手记 {ledger.length} 条。
        </p>
        <div className="manual-list">
          {selection.map((id) => selectTx(lookup.get(id)!))}
        </div>
        <div className="actions">
          <button
            className="primary"
            disabled={!banks.length || !ledger.length}
            onClick={() => {
              onManual(banks, ledger);
              setSelected([]);
            }}
          >
            确认所选匹配
          </button>
          <button onClick={() => setSelected([])}>清空选择</button>
        </div>
      </details>
      {detailItem && (
        <div className="modal-backdrop" onClick={() => setDetail(null)}>
          <section
            className="modal detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label="差异详情"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h2>{statusLabels[detailItem.status]}</h2>
              <button aria-label="关闭详情" onClick={() => setDetail(null)}>
                ✕
              </button>
            </div>
            <p className="status-help">{statusHelp[detailItem.status]}</p>
            <p>{detailItem.reason}</p>
            <p className="muted">
              {maskAccount(detailItem.accountId)} ·{" "}
              {settings.dateBasis === "transactionDate"
                ? "交易日期"
                : "入账日期"}{" "}
              · 原始行号按表格逻辑行（CSV 多行单元格计为一行）
            </p>
            <h3>银行记录</h3>
            {detailItem.bankIds.length ? (
              detailItem.bankIds.map((id) => selectTx(lookup.get(id)!))
            ) : (
              <p className="muted">银行账单里没有找到对应的记录。</p>
            )}
            <h3>随手记记录 / 可能对应的记录</h3>
            {detailItem.ledgerIds.length ? (
              detailItem.ledgerIds.map((id) => selectTx(lookup.get(id)!))
            ) : (
              <p className="muted">随手记里没有找到对应的记录。</p>
            )}
            <div className="actions">
              <button
                disabled={
                  !detailItem.bankIds.length ||
                  !detailItem.ledgerIds.length ||
                  success(detailItem)
                }
                onClick={() => {
                  onManual(detailItem.bankIds, detailItem.ledgerIds);
                  setDetail(null);
                }}
              >
                确认这组匹配
              </button>
              <button onClick={() => setDetail(null)}>继续选择其他记录</button>
            </div>
            <hr />
            <label>
              人工处理状态
              <select
                value={decisions[detailItem.id]?.status || "open"}
                onChange={(e) =>
                  onDecision(detailItem.id, {
                    note: decisions[detailItem.id]?.note || "",
                    status: e.target.value as Decision["status"],
                  })
                }
              >
                {Object.entries(decisionLabels).map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              本地备注
              <textarea
                maxLength={2000}
                placeholder="写下核实情况，仅保留在本次会话"
                value={decisions[detailItem.id]?.note || ""}
                onChange={(e) =>
                  onDecision(detailItem.id, {
                    status: decisions[detailItem.id]?.status || "open",
                    note: e.target.value,
                  })
                }
              />
            </label>
            <p className="muted">人工标记不会删除原始记录或改变账户汇总。</p>
          </section>
        </div>
      )}
    </section>
  );
}
