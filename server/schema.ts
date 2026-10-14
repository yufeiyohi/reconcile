import { z } from "zod";
const text = z.string().max(10000);
const keys = [
  "transactionDate",
  "postingDate",
  "direction",
  "amount",
  "balance",
  "paymentMethod",
  "income",
  "expense",
  "account",
  "description",
  "note",
  "counterparty",
  "externalTransactionId",
  "currency",
  "category",
] as const;
export const statementInput = z.object({
  source: z.enum(["suishouji", "icbc", "cmb", "cmb-credit", "wechat"]),
  file: z.object({
    id: z.string().regex(/^[a-f0-9]{64}$/),
    name: z.string().min(1).max(255),
    warnings: z.array(text).max(1000),
    sheets: z
      .array(
        z.object({
          name: z.string().min(1).max(255),
          rows: z.array(z.array(text).max(100)).max(20100),
        }),
      )
      .min(1)
      .max(20),
  }),
  options: z.object({
    sheet: z.string().max(255),
    headerRow: z.number().int().min(1).max(20100),
    mapping: z.partialRecord(z.enum(keys), z.number().int().min(0).max(99)),
    fixedAccount: z.string().max(255),
    defaultCurrency: z.string().max(16),
    signedAmount: z.boolean(),
    allSheets: z.boolean().optional(),
  }),
  expectedVersion: z.number().int().min(1).optional(),
});
export const storedWorkspace = z.object({
  statementHashes: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(15),
  settings: z.object({
    mappings: z.record(z.string().max(512), z.string().max(512)),
    accountIds: z.array(z.string().max(512)).max(200),
    start: z.string().max(10),
    end: z.string().max(10),
    tolerance: z.number().int().min(0).max(31),
    dateBasis: z.enum(["transactionDate", "postingDate"]),
    confirmedExternalIds: z.boolean(),
  }),
  manual: z
    .array(
      z.object({
        id: z.string().max(256),
        bankIds: z.array(text).max(100),
        ledgerIds: z.array(text).max(100),
      }),
    )
    .max(10000),
  decisions: z.record(
    text,
    z.object({
      status: z.enum(["open", "verified", "revise"]),
      note: z.string().max(2000),
    }),
  ),
  balanceInputs: z.record(
    z.string().max(512),
    z.object({
      start: z.string().max(10),
      opening: z.string().max(64),
      complete: z.boolean(),
      bankClosing: z.record(z.string().max(10), z.string().max(64)),
    }),
  ),
});
export const workspaceInput = z.object({
  revision: z.number().int().min(0),
  state: storedWorkspace,
  action: z.enum(["save", "clear", "reconcile", "review"]).default("save"),
});
