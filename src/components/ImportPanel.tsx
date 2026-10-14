import { useId, useRef, useState } from "react";
import { adapterRegistry } from "../adapters/registry";
import { fieldLabels, type Field, type ImportOptions } from "../adapters/types";
import { inspectSource } from "../adapters/source-check";
import { detectHeader } from "../adapters/profiles";
import { suggestMapping } from "../adapters/generic";
import { maskAccount } from "../domain/transactions/types";
import type { ImportedFile } from "./types";
export function FileEditor({
  entry,
  onApply,
  onRemove,
  onReplace,
  busy,
}: {
  entry: ImportedFile;
  onReplace: (file: File) => void;
  onApply: (options: ImportOptions) => void;
  onRemove: () => void;
  busy: boolean;
}) {
  const replaceInput = useRef<HTMLInputElement>(null);
  const accountInput = useRef<HTMLInputElement>(null);
  const previewBox = useRef<HTMLDivElement>(null);
  const accountHintId = useId();
  const [options, setOptions] = useState(entry.options);
  // Which row the five-row preview starts at; set when jumping to a bad row.
  const [previewFrom, setPreviewFrom] = useState<number | null>(null);
  const missingAccount =
    options.mapping.account === undefined && !options.fixedAccount.trim();
  const suggestedAccount = (
    {
      icbc: "工商银行",
      cmb: "招商活期",
      "cmb-credit": "招行信用卡(RMB)",
      wechat: "微支付",
    } as Record<string, string>
  )[entry.source];
  const sheet = entry.file.sheets.find((s) => s.name === options.sheet)!;
  const headers = sheet.rows[options.headerRow - 1] || [];
  const set = (p: Partial<ImportOptions>) => setOptions({ ...options, ...p });
  const previewStart = previewFrom ?? options.headerRow;
  const showRow = (row: number) => {
    setPreviewFrom(Math.max(0, row - 1));
    previewBox.current?.scrollIntoView({ block: "center" });
  };
  const dates =
    entry.result?.transactions
      .flatMap((t) => (t.transactionDate ? [t.transactionDate] : []))
      .sort() || [];
  return (
    <details className="file-editor" open={!entry.result || !!entry.parseError}>
      <summary>
        <span className="file-name">▤ {maskAccount(entry.file.name)}</span>
        <span className={`pill ${entry.result ? "green" : ""}`}>
          {entry.parseError
            ? "解析未完成 · 请查看提示"
            : entry.result
              ? `${entry.result.transactions.length} 条有效 · ${entry.result.errors.length} 条错误`
              : "待确认字段"}
        </span>
      </summary>
      <div className="file-body">
        {!entry.result && (
          <p className={missingAccount ? "warning-box" : "subtle-note"}>
            {missingAccount
              ? "还需指定本文件的账户：账单里没有账户列，请填写下方“这个文件属于哪个账户”，再点击“确认映射并解析”。"
              : "字段已自动识别。核对下方预览无误后，点击“确认映射并解析”即可；不需要逐个改下拉框。"}
          </p>
        )}
        {entry.source === "suishouji" && entry.file.sheets.length > 1 && (
          <label className="check">
            <input
              type="checkbox"
              checked={!!options.allSheets}
              onChange={(e) => set({ allSheets: e.target.checked })}
            />
            同时解析全部已识别工作表（各表独立映射；含转账两侧）
          </label>
        )}
        {inspectSource(entry.source, entry.file).kind === "unknown" && (
          <label className="check">
            <input
              type="checkbox"
              checked={!!options.sourceConfirmed}
              onChange={(e) => set({ sourceConfirmed: e.target.checked })}
            />
            我已核实此文件属于当前选择的银行 / 来源
          </label>
        )}
        {entry.source !== "suishouji" &&
          options.mapping.externalTransactionId !== undefined && (
            <label className="check">
              <input
                type="checkbox"
                checked={!!options.trustTransactionIds}
                onChange={(e) => set({ trustTransactionIds: e.target.checked })}
              />
              我已核实“交易编号”是本银行每笔交易唯一且稳定的编号（不确定不要勾选）
            </label>
          )}
        <div className="form-grid">
          <label>
            工作表
            <select
              value={options.sheet}
              onChange={(e) => {
                const s = entry.file.sheets.find(
                  (s) => s.name === e.target.value,
                )!;
                setPreviewFrom(null);
                set({
                  sheet: s.name,
                  headerRow: detectHeader(s),
                  mapping: suggestMapping(s.rows[detectHeader(s) - 1] || []),
                });
              }}
            >
              {entry.file.sheets.map((s) => (
                <option key={s.name}>{s.name}</option>
              ))}
            </select>
          </label>
          <label>
            表头在第几行
            <input
              type="number"
              min="1"
              max={sheet.rows.length}
              value={options.headerRow}
              onChange={(e) => {
                const n = Number(e.target.value);
                setPreviewFrom(null);
                set({
                  headerRow: n,
                  mapping: suggestMapping(sheet.rows[n - 1] || []),
                });
              }}
            />
          </label>
          <label>
            这个文件属于哪个账户
            <input
              ref={accountInput}
              aria-label="这个文件属于哪个账户"
              aria-invalid={missingAccount}
              aria-describedby={missingAccount ? accountHintId : undefined}
              value={options.fixedAccount}
              onChange={(e) => set({ fixedAccount: e.target.value })}
              placeholder="例如：工行尾号 1234"
            />
            {missingAccount && (
              <small id={accountHintId} className="required-hint">
                必填：填随手记里对应的账户名称，两边名字一致最省事
              </small>
            )}
          </label>
          <label>
            没有币种列时按什么币种
            <select
              value={options.defaultCurrency}
              onChange={(e) => set({ defaultCurrency: e.target.value })}
            >
              <option value="CNY">CNY 人民币（请确认）</option>
              <option value="">不设默认，逐行报错</option>
            </select>
          </label>
        </div>
        {missingAccount && suggestedAccount && (
          <div className="account-suggestion">
            <span>账户名称建议（请核对）：</span>
            <button
              disabled={busy}
              onClick={() => {
                set({ fixedAccount: suggestedAccount });
                accountInput.current?.focus();
              }}
            >
              使用“{suggestedAccount}”
            </button>
            <small>同一来源有多个账户时，请分别填写名称。</small>
          </div>
        )}
        <p className="eyebrow">
          原始预览 · 5 行 · 账号脱敏
          {previewFrom !== null && (
            <span>
              正在显示第 {previewStart + 1} 行附近
              <button
                className="text-button"
                onClick={() => setPreviewFrom(null)}
              >
                回到表头下方
              </button>
            </span>
          )}
        </p>
        <div className="table-scroll preview" ref={previewBox}>
          <table>
            <thead>
              <tr>
                <th>行</th>
                {headers.map((h, i) => (
                  <th key={i}>{maskAccount(h) || `列 ${i + 1}`}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sheet.rows
                .slice(previewStart, previewStart + 5)
                .map((row, i) => (
                  <tr
                    key={i}
                    className={
                      previewFrom !== null && i === 0 ? "preview-target" : ""
                    }
                  >
                    <td>{previewStart + i + 1}</td>
                    {row.map((v, j) => (
                      <td key={j}>
                        {/账户|账号|卡号/.test(headers[j] || "")
                          ? maskAccount(v)
                          : /金额|余额|收入|支出|日期|时间/.test(
                                headers[j] || "",
                              )
                            ? v
                            : maskAccount(v)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <p className="eyebrow">
          字段对应关系 <span>已自动识别；只有对不上时才需要改</span>
        </p>
        <div className="mapping-grid">
          {Object.entries(fieldLabels).map(([field, label]) => (
            <label key={field}>
              {label}
              <select
                aria-label={`${entry.source}-${field}`}
                value={options.mapping[field as Field] ?? ""}
                onChange={(e) => {
                  const mapping = { ...options.mapping };
                  if (e.target.value === "") delete mapping[field as Field];
                  else mapping[field as Field] = Number(e.target.value);
                  set({ mapping });
                }}
              >
                <option value="">不映射</option>
                {headers.map((h, i) => (
                  <option value={i} key={i}>
                    {i + 1}. {maskAccount(h) || "空表头"}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={options.signedAmount}
            onChange={(e) => set({ signedAmount: e.target.checked })}
          />
          这份账单用正数表示收入、负数表示支出（账单没有“收/支”列时才勾）
        </label>
        <>
          {JSON.stringify(options) !== JSON.stringify(entry.options) && (
            <p className="warning-box">
              字段设置有未应用的改动。当前对账仍使用上次确认版本，请点击“确认映射并解析”应用。
            </p>
          )}
        </>
        <div className="actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              if (missingAccount) accountInput.current?.focus();
              onApply(options);
            }}
          >
            确认映射并解析
          </button>
          <button disabled={busy} onClick={() => replaceInput.current?.click()}>
            替换文件
          </button>
          <input
            hidden
            type="file"
            ref={replaceInput}
            aria-label={`替换-${entry.file.name}`}
            accept={adapterRegistry
              .get(entry.source)
              ?.supportedFileTypes.map((x) => `.${x}`)
              .join(",")}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onReplace(f);
              e.target.value = "";
            }}
          />
          <button className="danger-link" disabled={busy} onClick={onRemove}>
            移除此文件
          </button>
          <small>
            本次版本：{entry.file.id.slice(0, 8)} · {entry.importedAt}
          </small>
        </div>
        {entry.parseError && (
          <p className="error-box file-parse-feedback" role="alert">
            解析未完成：{entry.parseError}。请修改对应字段后重试。
          </p>
        )}
        {entry.result && !entry.parseError && (
          <p className="subtle-note file-parse-feedback">
            解析完成：{entry.result.transactions.length} 条有效，
            {entry.result.errors.length}{" "}
            条错误。下一步到“关联账户与期间”设置对应账户。
          </p>
        )}
        {entry.result && (
          <div className="import-details">
            <p>
              日期范围：{dates[0] || "交易日期未提供"}
              {dates.length > 0 ? ` 至 ${dates.at(-1)}` : ""}
            </p>
            <p>
              检测账户：
              {[
                ...new Set(
                  entry.result.transactions.map((t) =>
                    maskAccount(t.accountName),
                  ),
                ),
              ].join("、") || "无"}
            </p>
            {entry.result.warnings.map((w) => (
              <p className="muted" key={w}>
                ⓘ {w}
              </p>
            ))}
            {entry.result.errors.length > 0 && (
              <div className="error-box">
                <strong>
                  {entry.result.errors.length} 行解析错误（以下最多展示 100
                  行，完整错误在报告内）
                </strong>
                {entry.result.errors.slice(0, 100).map((e, i) => (
                  <p key={i}>
                    {e.sheetName || options.sheet} / 第 {e.row} 行：{e.message}
                    {(e.sheetName || options.sheet) === options.sheet && (
                      <button
                        className="text-button"
                        onClick={() => showRow(e.row)}
                      >
                        在预览中查看这一行
                      </button>
                    )}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
export function ImportPanel({
  files,
  busy,
  onUpload,
  onApply,
  onRemove,
  onReplace,
}: {
  onReplace: (
    key: string,
    source: string,
    file: File,
    encoding: string,
  ) => void;
  files: ImportedFile[];
  busy: boolean;
  onUpload: (
    source: string,
    files: File[],
    append: boolean,
    encoding: string,
  ) => void;
  onApply: (key: string, options: ImportOptions) => void;
  onRemove: (key: string) => void;
}) {
  const [append, setAppend] = useState(false),
    [encoding, setEncoding] = useState("auto");
  const refs = useRef<Record<string, HTMLInputElement | null>>({});
  return (
    <section id="imports" className="panel">
      <div className="section-heading">
        <div>
          <span className="step-number">01</span>
          <h2>导入账单</h2>
        </div>
        <span className="muted">
          CSV / Excel / 信用卡 PDF · 单文件 ≤ 10 MB · 最多 15 个文件
        </span>
      </div>
      <p className="section-description">
        按来源分别上传文件，导入后会自动识别字段并解析；只有识别不出来的文件才需要你动手。在浏览器内预览字段并核对。
      </p>
      <div className="import-grid">
        {[...adapterRegistry.values()].map((adapter, index) => (
          <div
            className={`upload-card source-${adapter.id}`}
            key={adapter.id}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              if (!busy)
                onUpload(
                  adapter.id,
                  [...e.dataTransfer.files],
                  append,
                  encoding,
                );
            }}
          >
            <div className="source-heading">
              <span className="source-icon">
                {index === 0
                  ? "记"
                  : index === 1
                    ? "工"
                    : adapter.id === "wechat"
                      ? "微"
                      : "招"}
              </span>
              <div>
                <h3>{adapter.displayName}流水</h3>
                <small>
                  {index === 0
                    ? "多账户记账记录"
                    : adapter.id === "wechat"
                      ? "只核对零钱支出"
                      : "银行原始交易记录"}
                </small>
              </div>
              <span className="source-count">
                {files.filter((f) => f.source === adapter.id).length} 文件
              </span>
            </div>
            <button
              className="drop-zone"
              disabled={busy}
              onClick={() => refs.current[adapter.id]?.click()}
            >
              <span className="upload-symbol">↑</span>
              <strong>
                选择文件<span> 或拖拽至此</span>
              </strong>
              <small>支持多文件 · 本地解析</small>
            </button>
            {files.some((entry) => entry.source === adapter.id) && (
              <ul
                className="imported-files"
                aria-label={`${adapter.displayName}已导入文件`}
              >
                {files
                  .filter((entry) => entry.source === adapter.id)
                  .map((entry) => (
                    <li className="imported-file" key={entry.key}>
                      <span className="imported-file-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 28" fill="none">
                          <path d="M3 1h11l7 7v19H3z" />
                          <path d="M14 1v7h7M7 14h10M7 19h10" />
                        </svg>
                        <small>
                          {entry.file.name.split(".").pop()?.toUpperCase()}
                        </small>
                      </span>
                      <div className="imported-file-info">
                        <strong>{maskAccount(entry.file.name)}</strong>
                        <small>
                          {entry.parseError
                            ? `解析未完成：${entry.parseError}`
                            : entry.result
                              ? `已解析 · ${entry.result.transactions.length} 条有效${entry.result.errors.length ? ` · ${entry.result.errors.length} 条错误` : ""}`
                              : "已载入 · 待确认字段映射"}
                        </small>
                        {entry.source === "wechat" && entry.result && (
                          <small>
                            {entry.result.warnings.find((w) =>
                              w.startsWith("微信筛选："),
                            )}
                          </small>
                        )}
                      </div>
                    </li>
                  ))}
              </ul>
            )}
            <input
              hidden
              ref={(el) => {
                refs.current[adapter.id] = el;
              }}
              aria-label={`上传${adapter.displayName}`}
              type="file"
              multiple
              accept={adapter.supportedFileTypes.map((x) => `.${x}`).join(",")}
              onChange={(e) => {
                onUpload(
                  adapter.id,
                  [...(e.target.files || [])],
                  append,
                  encoding,
                );
                e.target.value = "";
              }}
            />
          </div>
        ))}
      </div>
      <div className="import-options">
        <label className="check">
          <input
            type="checkbox"
            checked={append}
            onChange={(e) => setAppend(e.target.checked)}
          />
          再次导入随手记时，保留之前已导入的随手记文件（默认替换成新文件）
        </label>
        <label className="inline-label">
          CSV 编码
          <select
            value={encoding}
            onChange={(e) => setEncoding(e.target.value)}
          >
            <option value="auto">自动识别（推荐）</option>
            <option value="utf-8">UTF-8</option>
            <option value="gb18030">GB18030 / GBK</option>
            <option value="utf-16le">UTF-16 LE</option>
          </select>
        </label>
      </div>
      {files.map((entry) => (
        <div key={entry.key} className="source-file">
          <span className="file-source">
            {adapterRegistry.get(entry.source)?.displayName}
          </span>
          <FileEditor
            entry={entry}
            busy={busy}
            onReplace={(f) => onReplace(entry.key, entry.source, f, encoding)}
            onApply={(o) => onApply(entry.key, o)}
            onRemove={() => onRemove(entry.key)}
          />
        </div>
      ))}
      <div className="subtle-note">
        ⓘ 已适配提供的样本结构，不代表支持所有官方导出版本。XLS / XLSX
        支持纯值表格；PDF
        仅支持招行信用卡人民币文本账单，扫描件、加密文件与公式暂不支持。
      </div>
    </section>
  );
}
