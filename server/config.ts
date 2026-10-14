import "dotenv/config";
import { z } from "zod";
const environment = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default("127.0.0.1"),
  APP_ORIGIN: z.string().url().default("http://127.0.0.1:5173"),
  TRUST_PROXY: z.enum(["0", "1"]).default("0"),
  DB_HOST: z.string().min(1),
  DB_PORT: z.coerce.number().int().min(1).max(65535).default(3306),
  DB_DATABASE: z.string().min(1),
  DB_USER: z.string().min(1),
  DB_PASSWORD: z.string().min(1),
  DB_SSL_CA_FILE: z
    .string()
    .transform((s) => s || undefined)
    .optional(),
  ADMIN_USERNAME: z.string().min(1).max(64).default("owner"),
  ADMIN_PASSWORD_HASH: z.string().optional(),
  ADMIN_PASSWORD: z.string().optional(),
});
export type Config = z.infer<typeof environment>;
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = environment.safeParse(env);
  if (!parsed.success)
    throw new Error(
      "缺少或无效的配置项：" +
        [...new Set(parsed.error.issues.map((i) => i.path.join(".")))].join(
          ", ",
        ),
    );
  if (
    parsed.data.NODE_ENV === "production" &&
    !parsed.data.APP_ORIGIN.startsWith("https://")
  )
    throw new Error("生产环境 APP_ORIGIN 必须为 HTTPS 地址");
  const url = new URL(parsed.data.APP_ORIGIN);
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password
  )
    throw new Error("APP_ORIGIN 只能包含协议、主机和端口");
  return parsed.data;
}
