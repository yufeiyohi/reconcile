import type { Transaction } from "../transactions/types";
import { accountKey } from "./types";
/**
 * Keyword rules for the sources this site has verified. Order matters: a credit
 * card must win over the bank it belongs to.
 */
const sourceKeywords: [string, RegExp][] = [
  ["wechat", /微信|微支付|零钱/],
  ["cmb-credit", /(招商|招行|cmb).*(信用|贷记)|(信用卡|贷记卡).*(招商|招行)/i],
  ["cmb", /招商|招行/],
  ["icbc", /工商|工行|icbc/i],
];
/**
 * Pre-fill the ledger-to-statement mapping from account names, so a first-time
 * user confirms a suggestion instead of building it from scratch. Only an
 * unambiguous single candidate per source is suggested, and an entry the user
 * already touched (including one cleared on purpose) is never overwritten.
 */
export function suggestAccountMappings(
  transactions: Transaction[],
  existing: Record<string, string> = {},
): Record<string, string> {
  const ledger = new Map<string, string>();
  const banks = new Map<string, string[]>();
  for (const t of transactions) {
    if (t.source === "suishouji") ledger.set(accountKey(t), t.accountName);
    else {
      const keys = banks.get(t.source) || [];
      if (!keys.includes(accountKey(t))) keys.push(accountKey(t));
      banks.set(t.source, keys);
    }
  }
  const result = { ...existing };
  for (const [key, name] of ledger) {
    if (key in result) continue;
    const source = sourceKeywords.find(([, re]) => re.test(name))?.[0];
    const candidates = source ? banks.get(source) || [] : [];
    if (candidates.length === 1) result[key] = candidates[0];
  }
  return result;
}
