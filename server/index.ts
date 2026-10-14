import { loadConfig } from "./config";
import { database, migrate } from "./database";
import { createApp } from "./app";
import { hashPassword, validPasswordHash } from "./password";
import { transaction } from "./database";
import type { Pool } from "mysql2/promise";
let pool: Pool | undefined;
try {
  const config = loadConfig();
  pool = database(config);
  if (process.argv.includes("--migrate")) {
    await migrate(pool, config);
    await pool.end();
    console.log("数据库初始化完成；现有数据和管理员账号保留。");
  } else if (process.argv.includes("--reset-admin")) {
    const passwordHash =
      config.ADMIN_PASSWORD_HASH ||
      (config.ADMIN_PASSWORD ? await hashPassword(config.ADMIN_PASSWORD) : "");
    if (!validPasswordHash(passwordHash))
      throw new Error("请在 .env 配置新的管理员密码摘要");
    await transaction(pool, async (c) => {
      const [rows] = await c.query(
        "SELECT id FROM reconcile_users WHERE id=1 FOR UPDATE",
      );
      if (!(rows as unknown[]).length) throw new Error("管理员尚未初始化");
      await c.execute(
        "UPDATE reconcile_users SET username=?,password_hash=? WHERE id=1",
        [config.ADMIN_USERNAME, passwordHash],
      );
      await c.execute("DELETE FROM reconcile_sessions");
      await c.execute(
        "INSERT INTO reconcile_audit(actor,action,outcome,target,ip,details) VALUES(?,'auth.password-reset','success','1','local','{}')",
        [config.ADMIN_USERNAME],
      );
    });
    await pool.end();
    console.log("管理员凭据已更新，所有旧会话已撤销。");
  } else {
    await pool.query("SELECT id FROM reconcile_users WHERE id=1");
    const server = createApp(pool, config).listen(
      config.PORT,
      config.HOST,
      () =>
        console.log(
          `Reconcile server listening on ${config.HOST}:${config.PORT}`,
        ),
    );
    const stop = () =>
      server.close(() => void pool!.end().then(() => process.exit(0)));
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  }
} catch (e) {
  console.error(
    e instanceof Error && !("code" in e)
      ? e.message
      : "服务启动失败，请检查数据库配置及初始化状态",
  );
  await pool?.end().catch(() => {});
  process.exitCode = 1;
}
