import { randomBytes, scrypt as derive, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
const scrypt = promisify(derive);
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12 || password.length > 256)
    throw new Error("管理员密码须为 12–256 个字符");
  const salt = randomBytes(16).toString("hex");
  const hash = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${hash.toString("hex")}`;
}
export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const match = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded);
  if (!match || password.length > 256) return false;
  const actual = (await scrypt(password, match[1], 64)) as Buffer;
  return timingSafeEqual(actual, Buffer.from(match[2], "hex"));
}
export function validPasswordHash(hash: string) {
  return /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(hash);
}
