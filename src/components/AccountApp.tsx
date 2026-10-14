import { useCallback, useEffect, useRef, useState } from "react";
import App from "../App";
import { api, ApiError, RemoteWorkspace } from "../api";
import type {
  AuditEvent,
  StatementSummary,
  StoredFile,
  WorkspaceResponse,
  WorkspaceState,
} from "../../shared/workspace";
import { maskAccount, sourceNames } from "../domain/transactions/types";
const labels: Record<string, string> = {
  "auth.login": "登录",
  "auth.logout": "退出登录",
  "auth.password-reset": "重置管理员凭据",
  "statement.import": "导入账单",
  "statement.update": "修改字段",
  "statement.delete": "永久删除账单",
  "workspace.save": "保存工作区",
  "workspace.clear": "清空工作区",
  "workspace.review": "人工复核",
  "reconcile.run": "执行对账",
  "report.export": "导出报告",
};
export function AccountApp() {
  const [phase, setPhase] = useState<"loading" | "login" | "ready" | "error">(
      "loading",
    ),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [initial, setInitial] = useState<WorkspaceResponse | null>(null),
    [status, setStatus] = useState("已载入保存的工作区"),
    [saveError, setSaveError] = useState(false),
    [panel, setPanel] = useState<"files" | "audit" | null>(null),
    [page, setPage] = useState(0),
    [library, setLibrary] = useState<StatementSummary[]>([]),
    [audit, setAudit] = useState<AuditEvent[]>([]),
    [total, setTotal] = useState(0),
    [externalFile, setExternalFile] = useState<StoredFile | null>(null);
  const remote = useRef<RemoteWorkspace | null>(null),
    snapshot = useRef<WorkspaceState | null>(null);
  const ready = useCallback(async (name: string) => {
    const data = await api<WorkspaceResponse>("/workspace");
    remote.current?.dispose();
    remote.current = new RemoteWorkspace(data, (message, failed) => {
      setStatus(message);
      setSaveError(failed);
    });
    snapshot.current = data.state;
    setInitial(data);
    setUsername(name);
    setPhase("ready");
    setError("");
  }, []);
  useEffect(() => {
    void api<{ username: string }>("/auth/me")
      .then((u) => ready(u.username))
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setPhase("login");
        else {
          setError(e.message);
          setPhase("error");
        }
      });
    return () => remote.current?.dispose();
  }, [ready]);
  const observe = useCallback((state: WorkspaceState) => {
    snapshot.current = state;
    remote.current?.observe(state);
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (remote.current?.latest || remote.current?.running) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  const event = useCallback((action: string) => {
    void api("/events", {
      method: "POST",
      body: JSON.stringify({ action }),
    }).catch((e) => {
      setStatus("审计记录失败：" + e.message);
      setSaveError(true);
    });
  }, []);
  async function loadPanel(kind: "files" | "audit", current: number) {
    setPanel(kind);
    setPage(current);
    setError("");
    try {
      if (kind === "files") {
        const data = await api<{ items: StatementSummary[]; total: number }>(
          `/statements?page=${current}`,
        );
        setLibrary(data.items);
        setTotal(data.total);
      } else {
        const data = await api<{ items: AuditEvent[]; total: number }>(
          `/audit?page=${current}`,
        );
        setAudit(data.items);
        setTotal(data.total);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function logout() {
    setBusy(true);
    try {
      await remote.current?.flush();
      await api("/auth/logout", { method: "POST" });
      remote.current?.dispose();
      remote.current = null;
      setInitial(null);
      setPhase("login");
      setPassword("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (phase !== "ready")
    return (
      <main className="login-page">
        <section className="login-card">
          <div className="brand">
            <span className="brand-mark">≋</span>
            <strong>清账 · 私人对账</strong>
          </div>
          <h1>
            {phase === "loading"
              ? "正在连接服务…"
              : phase === "error"
                ? "暂时无法连接"
                : "登录你的账户"}
          </h1>
          <p>账单和对账设置保存于你的 MySQL 数据库，登录后可继续上次的核对。</p>
          {error && (
            <p className="error-box" role="alert">
              {error}
            </p>
          )}
          {phase === "login" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                setBusy(true);
                setError("");
                void api<{ username: string }>("/auth/login", {
                  method: "POST",
                  body: JSON.stringify({ username, password }),
                })
                  .then((u) => {
                    setPassword("");
                    return ready(u.username);
                  })
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              <label>
                登录名
                <input
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                  maxLength={64}
                />
              </label>
              <label>
                密码
                <input
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  maxLength={256}
                />
              </label>
              <button type="submit" className="primary" disabled={busy}>
                {busy ? "正在登录…" : "登录"}
              </button>
            </form>
          )}
          {phase === "error" && (
            <button onClick={() => location.reload()}>重新连接</button>
          )}
          <small>仅限本人使用 · 财务数据请在可信设备上处理</small>
        </section>
      </main>
    );
  return (
    <>
      <div className="account-toolbar">
        <span>已登录：{username}</span>
        <span
          className={saveError ? "red-text" : "muted"}
          role="status"
          aria-label="数据库保存状态"
        >
          {status}
        </span>
        {saveError && (
          <>
            <button
              onClick={() => void remote.current?.flush().catch(() => {})}
            >
              重试保存
            </button>
            <button
              onClick={() => {
                if (window.confirm("重新载入会放弃尚未保存的更改，是否继续？"))
                  location.reload();
              }}
            >
              重新载入
            </button>
          </>
        )}
        <button onClick={() => void loadPanel("files", 0)}>已保存账单</button>
        <button onClick={() => void loadPanel("audit", 0)}>审计日志</button>
        <button disabled={busy} onClick={() => void logout()}>
          退出登录
        </button>
      </div>
      {error && (
        <p role="alert" className="error-box">
          {error}
        </p>
      )}
      <App
        initialState={initial!.state}
        onState={observe}
        externalFile={externalFile}
        onAudit={event}
      />
      {panel && (
        <div className="modal-backdrop" onClick={() => setPanel(null)}>
          <section
            className="modal storage-modal"
            role="dialog"
            aria-modal="true"
            aria-label={panel === "files" ? "已保存账单" : "审计日志"}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="section-heading">
              <h2>{panel === "files" ? "已保存账单" : "审计日志"}</h2>
              <button
                aria-label="关闭数据库窗口"
                onClick={() => setPanel(null)}
              >
                ✕
              </button>
            </div>
            {error && (
              <p className="error-box" role="alert">
                {error}
              </p>
            )}
            {panel === "files" ? (
              <>
                <p>
                  从当前工作区移除文件不会删除数据库记录。可靠重复副本只从库内有效流水排除，原始账单仍可恢复；当前对账按选中的文件去重。随手记暂以导入快照更新，自动接口尚未接入。
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>来源 / 文件</th>
                        <th>库内有效 / 重复副本</th>
                        <th>保存时间</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {library.map((f) => (
                        <tr key={f.hash}>
                          <td>
                            {sourceNames[f.source]}
                            <br />
                            {maskAccount(f.name)}
                          </td>
                          <td>
                            {f.rows} / {f.excludedRows || 0}
                          </td>
                          <td>{new Date(f.savedAt).toLocaleString("zh-CN")}</td>
                          <td>
                            <button
                              onClick={() => {
                                void api<StoredFile>(`/statements/${f.hash}`)
                                  .then((file) => {
                                    remote.current?.remember(file);
                                    setExternalFile(file);
                                    setPanel(null);
                                  })
                                  .catch((e) => setError(e.message));
                              }}
                            >
                              加入当前对账
                            </button>
                            <button
                              disabled={snapshot.current?.files.some(
                                (x) => x.file.id === f.hash,
                              )}
                              onClick={() => {
                                if (
                                  window.confirm(
                                    "永久删除这份账单及其解析记录？此操作不能撤销。",
                                  )
                                )
                                  void api(`/statements/${f.hash}`, {
                                    method: "DELETE",
                                    body: JSON.stringify({
                                      version: f.version,
                                    }),
                                  })
                                    .then(() => {
                                      remote.current?.saved.delete(f.hash);
                                      return loadPanel("files", page);
                                    })
                                    .catch((e) => setError(e.message));
                              }}
                            >
                              永久删除
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <>
                <p>
                  记录登录、账单导入 / 字段修改 /
                  删除、工作区保存、对账、人工复核和报告导出。日志不记录密码、会话密钥或交易明细。
                </p>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>时间</th>
                        <th>用户 / IP</th>
                        <th>操作</th>
                        <th>结果 / 对象</th>
                      </tr>
                    </thead>
                    <tbody>
                      {audit.map((row) => (
                        <tr key={row.id}>
                          <td>
                            {new Date(row.createdAt).toLocaleString("zh-CN")}
                          </td>
                          <td>
                            {row.actor}
                            <br />
                            {row.ip}
                          </td>
                          <td>{labels[row.action] || row.action}</td>
                          <td>
                            {row.outcome === "success" ? "成功" : "失败"} ·{" "}
                            {row.target || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {!total && <p>暂无记录。</p>}
            <div className="pagination">
              <button
                disabled={!page}
                onClick={() => void loadPanel(panel, page - 1)}
              >
                上一页
              </button>
              <span>
                {page + 1} / {Math.max(1, Math.ceil(total / 30))}
              </span>
              <button
                disabled={(page + 1) * 30 >= total}
                onClick={() => void loadPanel(panel, page + 1)}
              >
                下一页
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
