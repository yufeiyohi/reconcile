import type { Direction } from "./types";
export function parseAmount(raw: string): {
  minor: string;
  negative: boolean;
  explicitPositive: boolean;
} {
  let s = raw.trim().replace(/^[¥￥]\s*/, "");
  const negative = s.startsWith("-") || /^\(.*\)$/.test(s),
    explicitPositive = s.startsWith("+");
  s = s.replace(/^[-+]/, "").replace(/^\((.*)\)$/, "$1");
  if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(s))
    throw new Error("金额格式无法识别（只接受至多两位小数，不支持科学计数法）");
  const [whole, part = ""] = s.replaceAll(",", "").split(".");
  if (whole.length > 30) throw new Error("金额超过允许长度");
  return {
    minor: (BigInt(whole) * 100n + BigInt(part.padEnd(2, "0"))).toString(),
    negative,
    explicitPositive,
  };
}
export function parseDate(raw: string): string | null {
  if (!raw.trim()) return null;
  const input = /^\d{8}$/.test(raw.trim())
    ? raw.trim().replace(/^(\d{4})(\d{2})(\d{2})$/, "$1-$2-$3")
    : raw.trim();
  const m = input.match(
    /^(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?(?:[ T]\d{1,2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/,
  );
  if (!m) throw new Error("日期无法识别，请使用 YYYY-MM-DD（可带时间）");
  const y = Number(m[1]),
    mo = Number(m[2]),
    d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (
    y < 1900 ||
    y > 2100 ||
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== mo - 1 ||
    dt.getUTCDate() !== d
  )
    throw new Error("日期不存在或超出 1900–2100 范围");
  return `${m[1]}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
export function parseDirection(raw: string): Direction {
  const s = raw.trim().toLowerCase();
  if (
    ["收入", "收", "贷", "贷方", "income", "入账", "转入", "退款"].includes(s)
  )
    return "income";
  if (["支出", "支", "借", "借方", "expense", "出账", "转出"].includes(s))
    return "expense";
  if (["转账", "transfer", "内部转账"].includes(s)) return "transfer";
  return "unknown";
}
export function parseCurrency(raw: string): string {
  const s = raw.trim().toUpperCase();
  if (["CNY", "RMB", "人民币", "人民币元", "元", "￥", "¥"].includes(s))
    return "CNY";
  if (
    [
      "USD",
      "HKD",
      "EUR",
      "JPY",
      "GBP",
      "AUD",
      "CAD",
      "SGD",
      "CHF",
      "NZD",
    ].includes(s)
  )
    return s;
  throw new Error("币种无法识别，请明确选择币种列或默认 CNY");
}
