import express, {
  type Request,
  type Response,
  type NextFunction,
} from "express";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { Pool, RowDataPacket, PoolConnection } from "mysql2/promise";
import type { Config } from "./config";
import { refreshDuplicates } from "./duplicates";
import { transaction, json } from "./database";
import { verifyPassword } from "./password";
import { statementInput, workspaceInput, storedWorkspace } from "./schema";
import { verifySource, inspectSource } from "../src/adapters/source-check";
import { adapterRegistry } from "../src/adapters/registry";
import type { ImportedFile } from "../src/components/types";
import type { StoredFile } from "../shared/workspace";
class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const tokenHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
function cookie(req: Request) {
  try {
    return decodeURIComponent(
      req.headers.cookie
        ?.split(";")
        .map((x) => x.trim())
        .find((x) => x.startsWith("reconcile_session="))
        ?.slice(18) || "",
    );
  } catch {
    return "";
  }
}
const stamp = (date: unknown) =>
  new Date(String(date).replace(" ", "T") + "Z").toISOString();
function reviewedEntry(value: unknown): ImportedFile {
  const entry = json<ImportedFile>(value);
  const check = inspectSource(entry.source, entry.file);
  if (
    check.kind === "mismatch" ||
    (check.kind === "unknown" && !entry.options.sourceConfirmed)
  )
    return {
      ...entry,
      result: undefined,
      parseError: check.message + "请从正确来源重新导入或确认来源。",
    };
  try {
    return {
      ...entry,
      result: adapterRegistry
        .get(entry.source)!
        .parse(entry.file, entry.options),
      parseError: undefined,
    };
  } catch (e) {
    return { ...entry, result: undefined, parseError: (e as Error).message };
  }
}
export function createApp(pool: Pool, config: Config, serveAssets = true) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.TRUST_PROXY === "1" ? 1 : false);
  app.use((req, res, next) => {
    res.locals.requestId = randomUUID();
    res.setHeader("X-Request-ID", res.locals.requestId);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "DENY");
    if (req.path.startsWith("/api")) res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use("/api", express.json({ limit: "25mb" }));
  app.use("/api", (req, res, next) => {
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      (req.headers.origin !== new URL(config.APP_ORIGIN).origin ||
        req.headers["x-reconcile-request"] !== "1")
    )
      return res.status(403).json({ error: "请求来源无效，请从网站页面操作" });
    next();
  });
  const audit = async (
    c: Pool | PoolConnection,
    req: Request,
    action: string,
    outcome = "success",
    target = "",
    details: Record<string, unknown> = {},
    actor?: string,
  ) => {
    await c.execute(
      "INSERT INTO reconcile_audit(actor,action,outcome,target,ip,details) VALUES(?,?,?,?,?,?)",
      [
        actor || req.res?.locals.user?.username || "anonymous",
        action,
        outcome,
        target,
        req.ip?.slice(0, 64) || "",
        JSON.stringify(details),
      ],
    );
  };
  const sessionOptions = {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/api",
    maxAge: 12 * 3600 * 1000,
  };
  const authenticated = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    const token = cookie(req);
    if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401, "请先登录");
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT u.id,u.username FROM reconcile_sessions s JOIN reconcile_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>UTC_TIMESTAMP()",
      [tokenHash(token)],
    );
    if (!rows.length) throw new HttpError(401, "登录已过期，请重新登录");
    res.locals.user = rows[0];
    next();
  };
  app.get("/api/health", async (_req, res) => {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.post("/api/auth/login", async (req, res) => {
    const username =
        typeof req.body?.username === "string" ? req.body.username : "",
      password =
        typeof req.body?.password === "string" ? req.body.password : "";
    const key = req.ip || "unknown",
      now = Date.now();
    for (const [k, a] of attempts) if (a.until < now) attempts.delete(k);
    if (attempts.size > 10000)
      throw new HttpError(429, "登录请求过多，请稍后重试");
    const attempt = attempts.get(key) || {
      count: 0,
      until: now + 15 * 60 * 1000,
    };
    if (attempt.count >= 5) {
      res.setHeader("Retry-After", Math.ceil((attempt.until - now) / 1000));
      throw new HttpError(429, "登录尝试过多，请 15 分钟后重试");
    }
    attempt.count++;
    attempts.set(key, attempt);
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT id,username,password_hash FROM reconcile_users WHERE id=1",
    );
    if (!rows.length) throw new HttpError(503, "服务尚未初始化");
    const valid = await verifyPassword(
      password.slice(0, 257),
      rows[0].password_hash,
    );
    if (!valid || username !== rows[0].username) {
      await audit(pool, req, "auth.login", "failure");
      throw new HttpError(401, "账号或密码不正确");
    }
    const token = randomBytes(32).toString("hex");
    await transaction(pool, async (c) => {
      await c.execute(
        "DELETE FROM reconcile_sessions WHERE expires_at<=UTC_TIMESTAMP()",
      );
      await c.execute(
        "INSERT INTO reconcile_sessions(token_hash,user_id,expires_at) VALUES(?,?,DATE_ADD(UTC_TIMESTAMP(),INTERVAL 12 HOUR))",
        [tokenHash(token), rows[0].id],
      );
      await audit(c, req, "auth.login", "success", "", {}, rows[0].username);
    });
    attempts.delete(key);
    res.cookie("reconcile_session", token, sessionOptions);
    res.json({ username: rows[0].username });
  });
  app.get("/api/auth/me", authenticated, (_req, res) =>
    res.json({ username: res.locals.user.username }),
  );
  app.post("/api/auth/logout", authenticated, async (req, res) => {
    await transaction(pool, async (c) => {
      await c.execute("DELETE FROM reconcile_sessions WHERE token_hash=?", [
        tokenHash(cookie(req)),
      ]);
      await audit(c, req, "auth.logout");
    });
    res.clearCookie("reconcile_session", sessionOptions);
    res.json({ ok: true });
  });
  app.use("/api", authenticated);
  app.get("/api/workspace", async (_req, res) => {
    const data = await transaction(pool, async (c) => {
      const [rows] = await c.query<RowDataPacket[]>(
        "SELECT revision,state FROM reconcile_workspace WHERE id=1",
      );
      if (!rows.length) throw new HttpError(503, "请先运行数据库初始化");
      const state = storedWorkspace.parse(json(rows[0].state));
      const [entries] = state.statementHashes.length
        ? await c.query<RowDataPacket[]>(
            "SELECT hash,entry,version,updated_at FROM reconcile_statements WHERE hash IN (?)",
            [state.statementHashes],
          )
        : [[], []];
      const found = new Map(
        entries.map((r) => [
          r.hash,
          {
            ...reviewedEntry(r.entry),
            version: r.version,
            savedAt: stamp(r.updated_at),
          },
        ]),
      );
      return {
        revision: rows[0].revision,
        state: {
          ...state,
          files: state.statementHashes.map((h) => found.get(h)).filter(Boolean),
        },
      };
    });
    res.json(data);
  });
  app.put("/api/workspace", async (req, res) => {
    const data = workspaceInput.safeParse(req.body);
    if (!data.success) throw new HttpError(400, "工作区数据无效或超过限制");
    const { state, revision, action } = data.data;
    if (new Set(state.statementHashes).size !== state.statementHashes.length)
      throw new HttpError(400, "工作区文件重复");
    const next = await transaction(pool, async (c) => {
      const [rows] = await c.query<RowDataPacket[]>(
        "SELECT revision FROM reconcile_workspace WHERE id=1 FOR UPDATE",
      );
      if (rows[0]?.revision !== revision)
        throw new HttpError(409, "另一个页面已更新工作区，请重新载入后操作");
      const [entries] = await c.query<RowDataPacket[]>(
        "SELECT hash,entry FROM reconcile_statements WHERE hash IN (?)",
        [state.statementHashes.length ? state.statementHashes : [""]],
      );
      const hashes = new Set(entries.map((r) => r.hash));
      if (state.statementHashes.some((h) => !hashes.has(h)))
        throw new HttpError(409, "部分账单尚未保存或已被删除，请重新载入");
      const totalRows = entries.reduce(
        (n, r) =>
          n +
          json<ImportedFile>(r.entry).file.sheets.reduce(
            (m, s) => m + s.rows.length,
            0,
          ),
        0,
      );
      if (totalRows > 50000)
        throw new HttpError(400, "当前工作区超过 50,000 行，请移除部分账单");
      await c.execute(
        "UPDATE reconcile_workspace SET state=?,revision=revision+1,updated_at=UTC_TIMESTAMP() WHERE id=1",
        [JSON.stringify(state)],
      );
      await audit(c, req, `workspace.${action}`, "success", "workspace", {
        files: state.statementHashes.length,
        manualMatches: state.manual.length,
        reviewNotes: Object.keys(state.decisions).length,
      });
      return revision + 1;
    });
    res.json({ revision: next });
  });
  app.get("/api/statements", async (req, res) => {
    const page = Math.max(0, Math.min(100000, Number(req.query.page) || 0));
    const [count] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM reconcile_statements",
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT s.hash,s.source,s.name,s.version,s.updated_at,JSON_LENGTH(s.entry,'$.result.transactions') AS rows_count,(SELECT COUNT(*) FROM reconcile_transactions t WHERE t.statement_id=s.id AND t.excluded_duplicate=1) AS excluded_count FROM reconcile_statements s ORDER BY s.updated_at DESC,s.id DESC LIMIT 30 OFFSET ?",
      [Math.floor(page) * 30],
    );
    res.json({
      total: count[0].total,
      items: rows.map((r) => ({
        hash: r.hash,
        source: r.source,
        name: r.name,
        version: r.version,
        rows: (r.rows_count || 0) - Number(r.excluded_count || 0),
        excludedRows: Number(r.excluded_count || 0),
        savedAt: stamp(r.updated_at),
      })),
    });
  });
  app.get("/api/statements/:hash", async (req, res) => {
    const [rows] = await pool.execute<RowDataPacket[]>(
      "SELECT entry,version,updated_at FROM reconcile_statements WHERE hash=?",
      [req.params.hash],
    );
    if (!rows.length) throw new HttpError(404, "账单不存在");
    res.json({
      ...reviewedEntry(rows[0].entry),
      version: rows[0].version,
      savedAt: stamp(rows[0].updated_at),
    });
  });
  app.post("/api/statements", async (req, res) => {
    const data = statementInput.safeParse(req.body);
    if (!data.success) throw new HttpError(400, "账单字段无效或超出限额");
    const { file, source, options, expectedVersion } = data.data;
    try {
      verifySource(source, file, options);
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
    if (
      !adapterRegistry
        .get(source)!
        .supportedFileTypes.includes(
          file.name.split(".").pop()?.toLowerCase() || "",
        )
    )
      throw new HttpError(400, "文件格式与所选来源不符");
    const rowCount = file.sheets.reduce((n, s) => n + s.rows.length, 0);
    if (rowCount > 20100) throw new HttpError(400, "单文件行数超出限制");
    const entry: ImportedFile = {
      key: `${source}:${file.id}`,
      source,
      file,
      options,
      importedAt: new Date().toISOString(),
    };
    try {
      entry.result = adapterRegistry.get(source)!.parse(file, options);
    } catch (e) {
      entry.parseError = e instanceof Error ? e.message : "字段解析失败";
    }
    if (entry.result?.transactions.some((t) => t.accountName.length > 255))
      throw new HttpError(400, "账户名称超过 255 字符，请检查字段映射");
    const stored = await transaction(pool, async (c) => {
      // Serialize imports/deletions before deciding which duplicate is canonical.
      await c.query("SELECT id FROM reconcile_workspace WHERE id=1 FOR UPDATE");
      const [existing] = await c.execute<RowDataPacket[]>(
        "SELECT id,source,entry,version,updated_at FROM reconcile_statements WHERE hash=? FOR UPDATE",
        [file.id],
      );
      let id: number,
        version = 1;
      if (existing.length) {
        const old = existing[0];
        if (old.source !== source)
          throw new HttpError(
            409,
            "相同文件已保存到另一个来源，请从已保存账单恢复",
          );
        if (expectedVersion === undefined) {
          const previous = json<ImportedFile>(old.entry);
          const defaults = (o: typeof options) => ({
            ...o,
            sourceConfirmed: !!o.sourceConfirmed,
            trustTransactionIds: !!o.trustTransactionIds,
            allSheets: !!o.allSheets,
          });
          if (!isDeepStrictEqual(defaults(previous.options), defaults(options)))
            throw new HttpError(
              409,
              "相同账单已保存，字段设置不同，请从已保存账单恢复后修改",
            );
          return {
            ...previous,
            version: old.version,
            savedAt: stamp(old.updated_at),
          };
        }
        if (old.version !== expectedVersion)
          throw new HttpError(409, "此账单已在另一个页面更新，请重新载入");
        id = old.id;
        version = old.version + 1;
        await c.execute(
          "UPDATE reconcile_statements SET name=?,entry=?,version=?,updated_at=UTC_TIMESTAMP() WHERE id=?",
          [file.name, JSON.stringify(entry), version, id],
        );
        await c.execute(
          "DELETE FROM reconcile_transactions WHERE statement_id=?",
          [id],
        );
      } else {
        if (expectedVersion !== undefined)
          throw new HttpError(409, "此账单已被删除，请重新载入");
        const [r] = await c.execute(
          "INSERT INTO reconcile_statements(hash,source,name,entry) VALUES(?,?,?,?)",
          [file.id, source, file.name, JSON.stringify(entry)],
        );
        id = (r as { insertId: number }).insertId;
      }
      const ts = entry.result?.transactions || [];
      for (let i = 0; i < ts.length; i += 200) {
        const values = ts
          .slice(i, i + 200)
          .map((t) => [
            id,
            t.accountName,
            t.transactionDate,
            t.direction,
            t.currency,
            t.amountMinor,
            t.balanceMinor ?? null,
            JSON.stringify(t),
          ]);
        await c.query(
          "INSERT INTO reconcile_transactions(statement_id,account_name,business_date,direction,currency,amount_minor,balance_minor,record) VALUES ?",
          [values],
        );
      }
      const duplicates = await refreshDuplicates(c, source);
      await audit(
        c,
        req,
        existing.length ? "statement.update" : "statement.import",
        "success",
        String(id),
        {
          source,
          rawRows: rowCount,
          transactions: ts.length,
          errors: entry.result?.errors.length || 0,
          excludedDuplicates: duplicates.excluded,
          referenceConflicts: duplicates.conflicts,
          possibleOverlaps: duplicates.possible,
        },
      );
      return {
        ...entry,
        version,
        savedAt: new Date().toISOString(),
      } satisfies StoredFile;
    });
    res.json(stored);
  });
  app.delete("/api/statements/:hash", async (req, res) => {
    const version = Number(req.body?.version);
    if (!Number.isInteger(version) || version < 1)
      throw new HttpError(400, "请提供账单版本");
    await transaction(pool, async (c) => {
      const [workspace] = await c.query<RowDataPacket[]>(
        "SELECT state FROM reconcile_workspace WHERE id=1 FOR UPDATE",
      );
      const [rows] = await c.execute<RowDataPacket[]>(
        "SELECT id,version,source FROM reconcile_statements WHERE hash=? FOR UPDATE",
        [req.params.hash],
      );
      if (!rows.length) throw new HttpError(404, "账单不存在");
      if (rows[0].version !== version)
        throw new HttpError(409, "账单已更新，请刷新后删除");
      const state = json<{ statementHashes: string[] }>(workspace[0].state);
      if (state.statementHashes.includes(String(req.params.hash)))
        throw new HttpError(
          409,
          "请先从当前工作区移除此文件并等待保存，再永久删除",
        );
      await c.execute("DELETE FROM reconcile_statements WHERE id=?", [
        rows[0].id,
      ]);
      await refreshDuplicates(c, rows[0].source);
      await audit(c, req, "statement.delete", "success", String(rows[0].id));
    });
    res.json({ ok: true });
  });
  app.get("/api/audit", async (req, res) => {
    const page = Math.max(
      0,
      Math.min(100000, Math.floor(Number(req.query.page) || 0)),
    );
    const [count] = await pool.query<RowDataPacket[]>(
      "SELECT COUNT(*) AS total FROM reconcile_audit",
    );
    const [rows] = await pool.query<RowDataPacket[]>(
      "SELECT * FROM reconcile_audit ORDER BY id DESC LIMIT 30 OFFSET ?",
      [page * 30],
    );
    res.json({
      total: count[0].total,
      items: rows.map((r) => ({
        id: r.id,
        createdAt: stamp(r.created_at),
        actor: r.actor,
        action: r.action,
        outcome: r.outcome,
        target: r.target,
        ip: r.ip,
        details: json(r.details),
      })),
    });
  });
  app.post("/api/events", async (req, res) => {
    if (!["report.export", "reconcile.run"].includes(req.body?.action))
      throw new HttpError(400, "不支持的审计事件");
    await audit(pool, req, req.body.action);
    res.json({ ok: true });
  });
  app.get("/api/sync/status", (_req, res) =>
    res.json({
      provider: "suishouji",
      available: false,
      message: "随手记接口尚未配置；目前通过导入新版账本更新。",
    }),
  );
  app.use("/api", (_req, res) => res.status(404).json({ error: "接口不存在" }));
  if (serveAssets) {
    const root = resolve("dist");
    app.use(express.static(root, { index: "index.html", dotfiles: "deny" }));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(root, "index.html")),
    );
  }
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      const e = error as { status?: number; code?: string; type?: string };
      const status =
        error instanceof HttpError
          ? error.status
          : e.type === "entity.too.large"
            ? 413
            : e.type === "entity.parse.failed"
              ? 400
              : 503;
      if (status >= 500)
        console.error(
          JSON.stringify({
            event: "request.failure",
            requestId: res.locals.requestId,
            code: e.code || "INTERNAL",
          }),
        );
      res.status(status).json({
        error:
          error instanceof HttpError
            ? error.message
            : status === 413
              ? "文件内容过大，请分段导入"
              : status === 400
                ? "请求格式无效"
                : "服务暂不可用，请稍后重试",
        requestId: res.locals.requestId,
      });
    },
  );
  return app;
}
