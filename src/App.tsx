import { useEffect, useMemo, useRef, useState } from "react";
import { ImportPanel } from "./components/ImportPanel";
import { SettingsPanel } from "./components/SettingsPanel";
import { ResultsPanel } from "./components/ResultsPanel";
import { HelpModal } from "./components/HelpModal";
import type { Decision, ImportedFile } from "./components/types";
import type { ImportOptions, ParsedFile } from "./adapters/types";
import { adapterRegistry } from "./adapters/registry";
import { initialOptions } from "./adapters/profiles";
import { suggestMapping } from "./adapters/generic";
import {
  accountKey,
  type ManualMatch,
  type Reconciliation,
  type Settings,
} from "./domain/reconciliation/types";
import { validateManual } from "./domain/reconciliation/engine";
import { suggestAccountMappings } from "./domain/reconciliation/suggest";
import type { ParseResult } from "./domain/transactions/types";
import { workerTask, cancelAllWorkers } from "./workers/client";
import { MAX_FILES, MAX_FILE_SIZE, MAX_TOTAL_ROWS } from "./workers/limits";
import { buildReport, downloadReport } from "./export/report";
import { demoFiles } from "./demo";
const initialSettings: Settings = {
  mappings: {},
  accountIds: [],
  start: "",
  end: "",
  dateBasis: "transactionDate",
  tolerance: 0,
  confirmedExternalIds: false,
};
function fingerprints(r: Reconciliation): Map<string, number> {
  const byId = new Map(r.transactions.map((t) => [t.id, t]));
  const m = new Map<string, number>();
  for (const item of r.items) {
    if (["matched", "manual"].includes(item.status)) continue;
    const key = JSON.stringify([
      item.status,
      item.accountId,
      [...item.bankIds, ...item.ledgerIds]
        .map((id) => {
          const t = byId.get(id)!;
          return [
            t.source,
            t.accountId,
            t.transactionDate,
            t.postingDate,
            t.amountMinor,
            t.direction,
            t.currency,
            t.description,
          ];
        })
        .sort(),
    ]);
    m.set(key, (m.get(key) || 0) + 1);
  }
  return m;
}
export default function App() {
  const [files, setFiles] = useState<ImportedFile[]>([]),
    [settings, setSettings] = useState<Settings>(initialSettings),
    [result, setResult] = useState<Reconciliation | null>(null),
    [manual, setManual] = useState<ManualMatch[]>([]),
    [decisions, setDecisions] = useState<Record<string, Decision>>({}),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState(""),
    [comparison, setComparison] = useState(""),
    [comparisonPrevious, setComparisonPrevious] =
      useState<Reconciliation | null>(null),
    [privacy, setPrivacy] = useState(false),
    [help, setHelp] = useState(false),
    [guideOff, setGuideOff] = useState(false);
  const generation = useRef(0),
    busyRef = useRef(false),
    previous = useRef<Reconciliation | null>(null),
    knownAccounts = useRef<string[]>([]);
  const transactions = useMemo(
    () => files.flatMap((f) => f.result?.transactions || []),
    [files],
  );
  useEffect(() => {
    const keys = [
      ...new Set(
        transactions.filter((t) => t.source !== "suishouji").map(accountKey),
      ),
    ];
    const dates = transactions
      .flatMap((t) => (t[settings.dateBasis] ? [t[settings.dateBasis]!] : []))
      .sort();
    const addedKeys = keys.filter((a) => !knownAccounts.current.includes(a));
    setSettings((s) => ({
      ...s,
      // Suggested links are pre-filled; a choice the user already made stays.
      mappings: suggestAccountMappings(transactions, s.mappings),
      accountIds: [
        ...s.accountIds.filter((a) => keys.includes(a)),
        ...addedKeys.filter((a) => !s.accountIds.includes(a)),
      ],
      start: s.start || dates[0] || "",
      end: s.end || dates.at(-1) || "",
    }));
    knownAccounts.current = keys;
  }, [transactions, settings.dateBasis]);
  useEffect(() => () => cancelAllWorkers(), []);
  function invalidate() {
    if (result) previous.current = result;
    setResult(null);
    setComparison("");
    setComparisonPrevious(null);
  }
  async function task(fn: (token: number) => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    const token = ++generation.current;
    try {
      await fn(token);
    } catch (e) {
      if (token === generation.current)
        setError(
          e instanceof Error
            ? e.message || "操作失败：解析库未提供详细信息"
            : "操作失败",
        );
    } finally {
      if (token === generation.current) {
        busyRef.current = false;
        setBusy(false);
      }
    }
  }
  const active = (token: number) => generation.current === token;
  function cancel() {
    generation.current++;
    cancelAllWorkers();
    busyRef.current = false;
    setBusy(false);
    setMessage("处理已取消，本次未完成操作没有应用。");
  }
  async function upload(
    source: string,
    incoming: File[],
    append: boolean,
    encoding: string,
    replacingKey?: string,
  ) {
    if (!incoming.length) return;
    await task(async (token) => {
      const retained = replacingKey
        ? files.filter((f) => f.key !== replacingKey)
        : source === "suishouji" && !append
          ? files.filter((f) => f.source !== "suishouji")
          : files;
      if (retained.length + incoming.length > MAX_FILES)
        throw new Error("最多同时导入 15 个文件，请先移除旧文件");
      const added: ImportedFile[] = [];
      for (const f of incoming) {
        if (
          !adapterRegistry
            .get(source)
            ?.supportedFileTypes.includes(
              f.name.split(".").pop()?.toLowerCase() || "",
            )
        )
          throw new Error(
            "此来源不支持该文件格式；PDF 仅限招行信用卡，图片与扫描件不支持",
          );
        if (f.size > MAX_FILE_SIZE)
          throw new Error("文件超过 10 MB，请分段导出");
        const parsed = await workerTask<ParsedFile>("read", {
          name: f.name,
          buffer: await f.arrayBuffer(),
          encoding,
        });
        if (!active(token)) return;
        if ([...files, ...added].some((x) => x.file.id === parsed.id))
          throw new Error(
            "相同文件内容已导入，不会重复计入；如需修改映射，请展开原文件",
          );
        added.push({
          key: `${source}:${parsed.id}`,
          source,
          file: parsed,
          options: initialOptions(source, parsed),
          importedAt: new Date().toLocaleTimeString("zh-CN", { hour12: false }),
        });
      }
      if (
        [...retained, ...added].reduce(
          (n, f) => n + f.file.sheets.reduce((m, s) => m + s.rows.length, 0),
          0,
        ) > MAX_TOTAL_ROWS
      )
        throw new Error("本次总行数超过 50,000，请缩小范围");
      // Parse straight away with the detected fields: a beginner only has to
      // step in when detection was not enough.
      const prepared: ImportedFile[] = [];
      for (const entry of added) {
        try {
          const parsed = await workerTask<ParseResult>("normalize", {
            source: entry.source,
            file: entry.file,
            options: entry.options,
          });
          if (!active(token)) return;
          prepared.push({ ...entry, result: parsed });
        } catch (e) {
          if (!active(token)) return;
          prepared.push({
            ...entry,
            parseError:
              e instanceof Error
                ? e.message || "自动识别字段失败，请在下方确认后重试"
                : "自动识别字段失败，请在下方确认后重试",
          });
        }
      }
      invalidate();
      setFiles([...retained, ...prepared]);
      setDecisions({});
      const done = prepared.filter((f) => f.result);
      const rows = done.reduce((n, f) => n + f.result!.transactions.length, 0);
      const bad = done.reduce((n, f) => n + f.result!.errors.length, 0);
      const replaced =
        source === "suishouji" && !append
          ? "已载入新版随手记文件，旧版已替换；原人工匹配将重新验证。"
          : "";
      setMessage(
        replaced +
          (done.length < prepared.length
            ? `已自动解析 ${done.length} 个文件；${prepared.length - done.length} 个文件还需要你补充信息，已在下方展开并说明原因。`
            : prepared.length === 1
              ? `解析完成：${rows} 条有效，${bad} 条错误。请关联账户后开始对账。`
              : `已自动解析 ${prepared.length} 个文件：共 ${rows} 条有效，${bad} 条错误。请关联账户后开始对账。`),
      );
    });
  }
  async function apply(key: string, options: ImportOptions) {
    await task(async (token) => {
      const entry = files.find((f) => f.key === key)!;
      setFiles((fs) =>
        fs.map((f) => (f.key === key ? { ...f, parseError: undefined } : f)),
      );
      let parsed: ParseResult;
      try {
        parsed = await workerTask<ParseResult>("normalize", {
          source: entry.source,
          file: entry.file,
          options,
        });
      } catch (e) {
        if (active(token)) {
          const parseError =
            e instanceof Error
              ? e.message || "解析失败，请检查字段设置后重试"
              : "解析失败，请重试";
          setFiles((fs) =>
            fs.map((f) => (f.key === key ? { ...f, parseError } : f)),
          );
        }
        throw e;
      }
      if (!active(token)) return;
      invalidate();
      setFiles((fs) =>
        fs.map((f) =>
          f.key === key
            ? { ...f, options, result: parsed, parseError: undefined }
            : f,
        ),
      );
      setMessage(
        `解析完成：${parsed.transactions.length} 条有效，${parsed.errors.length} 条错误。请关联账户后开始对账。`,
      );
    });
  }
  async function run(nextManual = manual) {
    await task(async (token) => {
      const next = await workerTask<Reconciliation>("reconcile", {
        transactions,
        settings,
        manual: nextManual,
      });
      if (!active(token)) return;
      const before = result || previous.current;
      setComparisonPrevious(before);
      if (before) {
        const old = fingerprints(before),
          now = fingerprints(next);
        let still = 0,
          oldCount = 0,
          newCount = 0;
        for (const [key, n] of old) {
          oldCount += n;
          still += Math.min(n, now.get(key) || 0);
        }
        for (const n of now.values()) newCount += n;
        setComparison(
          `与上次对账相比：${oldCount - still} 组旧差异不再出现，${still} 组仍存在，${newCount - still} 组新增或发生变化。基于标准字段比较，差异消失不等于已修正；无稳定编号时不承诺准确继承。`,
        );
      }
      setResult(next);
      previous.current = next;
      setManual(
        nextManual.filter((m) => !next.invalidManualIds.includes(m.id)),
      );
      setDecisions((ds) =>
        Object.fromEntries(
          Object.entries(ds).filter(([id]) =>
            next.items.some((i) => i.id === id),
          ),
        ),
      );
      setMessage("本地对账完成。疑似差异需要结合原始账单核实。");
      document
        .getElementById("results")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }
  function addManual(bankIds: string[], ledgerIds: string[]) {
    const m: ManualMatch = { id: crypto.randomUUID(), bankIds, ledgerIds };
    const invalid = validateManual(m, transactions, settings);
    if (invalid) {
      setError(invalid);
      return;
    }
    void run([...manual, m]);
  }
  function clear() {
    if (
      files.length &&
      !window.confirm(
        "清除全部本次文件、流水和人工决策？此操作只影响当前页面。",
      )
    )
      return;
    cancel();
    setFiles([]);
    setSettings(initialSettings);
    setResult(null);
    setManual([]);
    setDecisions({});
    setComparison("");
    setComparisonPrevious(null);
    previous.current = null;
    knownAccounts.current = [];
    setError("");
    setMessage("本次数据已清除。");
  }
  async function demo() {
    if (files.length && !window.confirm("使用人工构造演示替换本次数据？"))
      return;
    await task(async (token) => {
      const prepared: ImportedFile[] = [];
      for (const [source, content] of Object.entries(demoFiles)) {
        const file = await workerTask<ParsedFile>("read", {
          name: `人工构造-${source}.csv`,
          buffer: new TextEncoder().encode(content).buffer,
          encoding: "utf-8",
        });
        const options: ImportOptions = {
          sheet: "CSV",
          headerRow: 1,
          mapping: suggestMapping(file.sheets[0].rows[0]),
          fixedAccount: "",
          defaultCurrency: "CNY",
          signedAmount: false,
        };
        const parsed = await workerTask<ParseResult>("normalize", {
          source,
          file,
          options,
        });
        if (!active(token)) return;
        prepared.push({
          key: source + file.id,
          source,
          file,
          options,
          result: parsed,
          importedAt: "人工构造演示",
        });
      }
      invalidate();
      setFiles(prepared);
      setSettings({
        ...initialSettings,
        start: "2026-06-01",
        end: "2026-06-30",
        tolerance: 1,
        accountIds: ["icbc:工行尾号1234", "cmb:招行尾号5678"],
        mappings: {
          "suishouji:工行工资卡": "icbc:工行尾号1234",
          "suishouji:招行储蓄卡": "cmb:招行尾号5678",
        },
      });
      setManual([]);
      setDecisions({});
      previous.current = null;
      setMessage(
        "已载入人工构造演示数据。点击“开始对账”查看匹配、漏记、同额歧义和未映射账户。",
      );
    });
  }
  const validFiles = files.filter((f) => f.result).length;
  const hasLedger = transactions.some((t) => t.source === "suishouji");
  const hasStatement = transactions.some((t) => t.source !== "suishouji");
  // Everything still standing between the user and a reconciliation run, in
  // the order it should be dealt with.
  const blockers = !files.length
    ? ["导入随手记账本文件，以及至少一个银行或微信账单文件"]
    : ([
        files.some((f) => !f.result) && "完成上方还没解析好的文件",
        !hasLedger && "导入随手记账本文件",
        !hasStatement && "导入至少一个银行或微信账单文件",
        !settings.accountIds.length && "在第 2 步勾选要对账的银行账户",
        (!settings.start || !settings.end) && "在第 2 步选择开始和结束日期",
      ].filter(Boolean) as string[]);
  const nextStep = blockers.length
    ? blockers[0]
    : result
      ? "在第 3 步逐笔核实差异，必要时修订随手记后重新导入"
      : "点击“开始对账”";
  return (
    <>
      <header className="site-header">
        <a className="brand" href="#">
          <span className="brand-mark">≋</span>
          <strong>
            清账<span>RECONCILE</span>
          </strong>
        </a>
        <nav>
          <a href="#imports">导入账单</a>
          <a href="#settings">账户与规则</a>
          <a href="#results">对账结果</a>
          <button className="text-button" onClick={() => setHelp(true)}>
            常见问题
          </button>
        </nav>
        <div className="header-actions">
          <span className="local-badge">
            <i />
            本地处理
          </span>
          <button onClick={clear}>清除本次数据</button>
        </div>
      </header>
      <main>
        <section className="hero">
          <div>
            <p className="eyebrow">
              <span className="tiny-line" />
              个人多银行流水对账
            </p>
            <h1>
              把流水对清，
              <br className="mobile-break" />
              <span>让记账安心。</span>
            </h1>
            <p>
              银行账单与随手记逐笔核对。找到疑似差异，追溯原始记录，
              <br />
              每一步确认都由你掌握。
            </p>
            <div className="hero-actions">
              <a className="primary button" href="#imports">
                开始导入 <span>↗</span>
              </a>
              <button onClick={() => void demo()} disabled={busy}>
                试用合成示例
              </button>
              <span>无需注册 · 无需连接银行</span>
            </div>
          </div>
          <div className="hero-card">
            <div className="hero-card-top">
              <span>每一笔，都清楚</span>
              <span className="lock-icon">▣</span>
            </div>
            <div className="flow">
              <span>银行流水</span>
              <i>⇄</i>
              <span>随手记账本</span>
            </div>
            <div className="hero-card-bottom">
              <i className="dot green-dot" />
              只在你的浏览器中核对<small>文件不上传 · 刷新即清除</small>
            </div>
          </div>
        </section>
        <div className="privacy-strip">
          <span className="shield">◇</span>
          <p>
            <strong>你的账单，始终由你保管。</strong>不上传文件，不调用
            AI，不连接银行。数据仅留在本次页面内存中。
          </p>
          <button className="text-button" onClick={() => setPrivacy(true)}>
            隐私与限制 ↗
          </button>
        </div>
        {!files.length && !guideOff && (
          <section className="onboarding">
            <div className="onboarding-head">
              <h2>第一次用？三步就能对完一个月</h2>
              <button className="text-button" onClick={() => setGuideOff(true)}>
                不用引导，收起
              </button>
            </div>
            <ol>
              <li>
                <b>导入</b>
                从随手记导出账本，从网银导出银行流水，按下面的来源各选一个文件。字段会自动识别，不用自己设置。
              </li>
              <li>
                <b>关联</b>
                告诉网站随手记里的账户对应哪份账单。名字能对上的已经帮你选好，核对一下即可。
              </li>
              <li>
                <b>核对</b>
                点「开始对账」，逐条看差异。每种情况都写明了是什么意思、该怎么办。
              </li>
            </ol>
            <div className="onboarding-actions">
              <button onClick={() => void demo()} disabled={busy}>
                先用示例数据走一遍
              </button>
              <button className="text-button" onClick={() => setHelp(true)}>
                常见问题 ↗
              </button>
              <small>示例全部为人工构造，不是真实账单。</small>
            </div>
          </section>
        )}
        <p className="next-step">
          <b>下一步</b>
          {nextStep}
        </p>
        <div className="workflow">
          <div className={files.length ? "complete" : ""}>
            <b>1</b>
            <span>
              导入与字段确认
              <small>
                {validFiles} / {files.length} 文件已解析
              </small>
            </span>
          </div>
          <i>—</i>
          <div
            className={
              Object.values(settings.mappings).filter(Boolean).length
                ? "complete"
                : ""
            }
          >
            <b>2</b>
            <span>
              关联账户与期间<small>账户隔离，精确核算</small>
            </span>
          </div>
          <i>—</i>
          <div className={result ? "complete" : ""}>
            <b>3</b>
            <span>
              检查差异与修订<small>重新导入，持续核对</small>
            </span>
          </div>
        </div>
        {(message || error || busy) && (
          <div
            className={`notification ${error ? "error-box" : ""}`}
            role={error ? "alert" : "status"}
          >
            {busy ? (
              <>
                <span className="spinner" />
                正在浏览器内处理…<button onClick={cancel}>取消处理</button>
              </>
            ) : (
              error || message
            )}
          </div>
        )}
        <ImportPanel
          files={files}
          busy={busy}
          onReplace={(key, source, file, encoding) =>
            void upload(source, [file], true, encoding, key)
          }
          onUpload={(...args) => void upload(...args)}
          onApply={(...args) => void apply(...args)}
          onRemove={(key) => {
            invalidate();
            setFiles((fs) => fs.filter((f) => f.key !== key));
            setMessage("文件已移除，结果已清空；请重新对账。");
          }}
        />
        <SettingsPanel
          transactions={transactions}
          settings={settings}
          onChange={(s) => {
            if (busy) cancel();
            invalidate();
            setSettings(s);
          }}
          onRun={() => void run()}
          busy={busy}
          blockers={blockers}
        />
        <ResultsPanel
          key={result ? "result" : "empty"}
          result={result}
          settings={settings}
          files={files}
          decisions={decisions}
          onDecision={(id, d) => setDecisions((ds) => ({ ...ds, [id]: d }))}
          onManual={addManual}
          onUndo={(item) =>
            void run(
              manual.filter(
                (m) =>
                  JSON.stringify([...m.bankIds].sort()) !==
                    JSON.stringify([...item.bankIds].sort()) ||
                  JSON.stringify([...m.ledgerIds].sort()) !==
                    JSON.stringify([...item.ledgerIds].sort()),
              ),
            )
          }
          onReset={() => {
            setDecisions({});
            void run([]);
          }}
          onExport={() => {
            if (
              result &&
              window.confirm(
                "报告包含财务信息，请仅保存在可信设备，并谨慎分享。确认导出全部结果（不受筛选影响）？",
              )
            )
              downloadReport(buildReport(result, settings, files, decisions));
          }}
          comparison={comparison}
          comparisonPrevious={comparisonPrevious}
        />
        <footer>
          <span className="footer-brand">
            ≋ 清账 <small>让每一笔都有据可查</small>
          </span>
          <span>仅提供核对线索 · 不自动修改账本或执行交易</span>
          <button className="text-button" onClick={() => setHelp(true)}>
            常见问题
          </button>
          <button className="text-button" onClick={() => setPrivacy(true)}>
            隐私说明
          </button>
        </footer>
      </main>
      {help && <HelpModal onClose={() => setHelp(false)} />}
      {privacy && (
        <div className="modal-backdrop" onClick={() => setPrivacy(false)}>
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="隐私说明"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h2>你的数据留在本地</h2>
              <button
                onClick={() => setPrivacy(false)}
                aria-label="关闭隐私说明"
              >
                ✕
              </button>
            </div>
            <p>
              文件解析和对账在浏览器 Worker 中运行，不上传账单，不向 AI
              或第三方接口发送内容，无统计、广告或会话录制。
            </p>
            <p>
              不使用 localStorage、IndexedDB 或 Service Worker
              保存流水。刷新、关闭页面或“清除本次数据”会清空会话。你主动下载的报告会保留在设备上，需要自行管理。
            </p>
            <p>
              账号默认脱敏。金额、交易摘要和备注仍是敏感信息；共享屏幕或导出前请留意。
            </p>
            <p>
              只对 CNY
              自动核对。仅验证已提供样本的结构，其他官方导出版本尚未验证；首末日期不保证账单完整，所有疑似问题需要人工核实。转账和信用卡还款不自动推断性质。
            </p>
            <p>
              公开代码不等于公开账单。请勿把真实文件、报告或凭证提交到公开仓库。
            </p>
          </section>
        </div>
      )}
    </>
  );
}
