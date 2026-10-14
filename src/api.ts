import type {
  WorkspaceState,
  WorkspaceResponse,
  StoredFile,
} from "../shared/workspace";
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: "same-origin",
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-Reconcile-Request": "1",
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => {
    throw new ApiError("后端服务未连接，请检查部署或稍后重试", 503);
  });
  if (!res.ok) throw new ApiError(data.error || "操作失败", res.status);
  return data as T;
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, canonical(v)]),
    );
  return value;
}
const fileSignature = (file: WorkspaceState["files"][number]) =>
  JSON.stringify(canonical([file.source, file.file.id, file.options]));
export class RemoteWorkspace {
  revision: number;
  saved = new Map<string, { version: number; signature: string }>();
  latest: WorkspaceState | null = null;
  prior: WorkspaceState;
  timer: ReturnType<typeof setTimeout> | undefined;
  running: Promise<void> | null = null;
  stopped = false;
  constructor(
    initial: WorkspaceResponse,
    private status: (message: string, error: boolean) => void,
  ) {
    this.revision = initial.revision;
    this.prior = initial.state;
    for (const file of initial.state.files as StoredFile[]) this.remember(file);
  }
  remember(file: StoredFile) {
    this.saved.set(file.file.id, {
      version: file.version,
      signature: fileSignature(file),
    });
  }
  observe(state: WorkspaceState) {
    if (this.stopped) return;
    this.latest = state;
    this.status("有更改，等待保存…", false);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush().catch(() => {}), 650);
  }
  async flush(): Promise<void> {
    clearTimeout(this.timer);
    if (this.stopped && this.latest)
      throw new ApiError("工作区发生冲突，请重新载入后再保存或退出", 409);
    if (this.running) {
      await this.running;
      if (this.latest) return this.flush();
      return;
    }
    const drain = async () => {
      while (this.latest && !this.stopped) {
        const next = this.latest;
        this.latest = null;
        this.status("正在保存到数据库…", false);
        try {
          for (const file of next.files) {
            const previous = this.saved.get(file.file.id);
            if (previous?.signature === fileSignature(file)) continue;
            const stored = await api<StoredFile>("/statements", {
              method: "POST",
              body: JSON.stringify({
                source: file.source,
                file: file.file,
                options: file.options,
                expectedVersion: previous?.version,
              }),
            });
            this.remember(stored);
          }
          const { files, ...state } = next;
          const review =
            JSON.stringify([this.prior.manual, this.prior.decisions]) !==
            JSON.stringify([next.manual, next.decisions]);
          const action =
            !files.length && this.prior.files.length
              ? "clear"
              : review
                ? "review"
                : "save";
          const result = await api<{ revision: number }>("/workspace", {
            method: "PUT",
            body: JSON.stringify({
              revision: this.revision,
              state: { ...state, statementHashes: files.map((f) => f.file.id) },
              action,
            }),
          });
          this.revision = result.revision;
          this.prior = next;
          this.status("已保存到数据库", false);
        } catch (e) {
          this.latest = this.latest || next;
          this.status(e instanceof Error ? e.message : "保存失败", true);
          if (e instanceof ApiError && e.status === 409) this.stopped = true;
          throw e;
        }
      }
    };
    this.running = drain();
    try {
      await this.running;
    } finally {
      this.running = null;
    }
  }
  dispose() {
    this.stopped = true;
    clearTimeout(this.timer);
  }
}
