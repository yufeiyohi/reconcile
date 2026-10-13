# 清账 · Reconcile

[简体中文](README.zh-CN.md)

A browser-local personal transaction reconciliation app with a Chinese-language interface. Compare your Suishouji (随手记) ledger against statements from ICBC, China Merchants Bank debit cards, China Merchants Bank credit cards, and WeChat Pay, account by account. Identify potential missing, extra, or duplicate entries, as well as date, direction, and amount discrepancies, and trace each result back to its original file and row.

**Public source code does not mean public financial data. Never commit real statements, exported reports, or supporting documents to this repository.** The app does not upload statements, use AI, log in to banks, make payments, or modify Suishouji. Session data is kept in memory by default and cleared when you refresh or close the page.

## Daily closing balance review

Results now default to one debit/payment account at a time, ordered oldest first. Enter the Suishouji closing balance immediately before the selected start date and confirm complete exports. All three ledger sheets—expenses, income, and transfers—contribute to the running balance. Transfers debit the source account and credit the destination account.

ICBC and CMB debit statements supply running balances. The app validates ordering and balance continuity before selecting the daily closing balance. Equal closing balances for the same account are hidden by default (with a toggle to show them); offsetting detail discrepancies on equal days are not flagged. Unequal days highlight bank expenses alongside ledger amounts, counterparties, descriptions, and source rows. Income and transfers appear separately.

WeChat imports retain only rows whose payment method is exactly “零钱” and whose direction is expenditure. Lingqiantong, card payments, income, and other rows are ignored before parsing; original row numbers and filter counts remain available. A missing payment-method column requires explicit mapping. The supplied WeChat statement has no balance column, and expense-only rows cannot determine or carry forward daily wallet balances. Missing or uncertain balances require a manually verified daily closing balance; equal daily cash flow alone never establishes equal account balances. Credit card matching is unchanged under “信用卡与逐笔核对”. The existing CSV report still exports transaction-level results, not the new daily balance inputs/results. All new inputs remain in memory only.

## Run locally

Requires Node.js 24 and npm, plus a modern browser with support for Web Workers, BigInt, and Web Crypto.

```bash
npm ci
npm run dev
```

Open the local URL printed in your terminal. Opening `index.html` directly is not supported because Workers require a development or static server. Use “试用合成示例” (Try synthetic examples) to explore the complete workflow with entirely artificial data.

```bash
npm run typecheck
npm test
npm run build
npm run preview
```

End-to-end tests exercise deployment under the `/reconcile/` subpath, covering file imports, account isolation, source tracing, manual confirmation and undo, ledger replacement, exports, clearing data on refresh, and mobile layout:

```bash
npx playwright install --with-deps chromium
VITE_BASE_PATH=/reconcile/ npm run build
npm run test:e2e
```

Tests use the Chromium executable specified by `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` first, then `/usr/bin/chromium` if present, and otherwise the browser installed by Playwright. All test data is synthetic.

## Quick start for first-time users

Before you import your first file, the home page displays a three-step getting-started card. A FAQ is available from the header and footer.

1. Click “先用示例数据走一遍” (Try the workflow with sample data) to explore the complete process using synthetic records.
2. Replace the examples with your own files: select a file for each source. Fields are detected and parsed automatically, and CSV encoding is detected automatically.
3. Follow the “下一步” (Next step) prompt at the top of the page. If “开始对账” (Start reconciliation) is disabled, the remaining requirements are listed beside it.
4. Accounts with uniquely matching names are linked automatically and marked “已自动关联 · 请核对” (Automatically linked — please verify). Check the links, then start reconciliation.
5. Read the three-step introduction on the results page, then open individual details. Each situation includes a plain-language explanation and suggested next steps.

Manual intervention is needed only when automatic detection is insufficient, such as a statement without an account column, an unrecognized template, or a CSV with an unusual encoding.

## Workflow

1. **Import files by source.** You can select multiple files at once. CSV encoding is detected automatically (UTF-8 / GB18030 / GBK / UTF-16); a notice appears when a non-UTF-8 encoding is detected, and you can override the encoding manually. Drag-and-drop, file removal, and cancellation are supported.
2. **Review parsing results.** Files are parsed immediately using the detected worksheet, header row, and field mapping. Results appear on each file card, with details collapsed by default. Failed files expand automatically and explain the problem, such as a missing account column. Expand the details to inspect a five-row preview, adjust fields, and click “确认映射并解析” (Confirm mapping and parse) to retry. For invalid rows, “在预览中查看这一行” (View this row in the preview) jumps directly to the source row. If the file has no column identifying your own account, the required account field is highlighted and account-name shortcuts are provided for you to verify. Do not use the counterparty's account as your own account.
3. **Handle Suishouji transfers.** Multi-sheet files can parse expenditure, income, and transfer sheets together. Each transfer row becomes two linked account entries, reconciled separately by account rather than counted again as spending.
4. **Link ledger and source accounts.** A unique name match is preselected automatically and marked for verification. Manual changes or cleared selections are not overwritten; when a source has multiple accounts, the app does not guess. Example mappings from the supplied samples:

   | Source | Suishouji account |
   | --- | --- |
   | ICBC | 工商银行 |
   | China Merchants Bank debit card | 招商活期 |
   | China Merchants Bank credit card, CNY | 招行信用卡(RMB) |
   | WeChat Pay | 微支付 |

   Assign distinct accounts to different cards from the same bank. Unmapped accounts are marked as excluded from the current reconciliation. WeChat Pay and bank statements may represent the same payment, so combined totals across channels cannot simply be treated as total spending.

5. **Choose accounts and a date range.** The date basis, tolerance, and transaction-ID matching are tucked into the collapsed advanced-rules section; keep the defaults if unsure. Missing requirements are shown beside the start button. Automatic reconciliation applies only to CNY. The first and last transaction dates are merely the observed range, not proof that no pages or periods are missing. Records with insufficient coverage are not directly classified as missing entries.
6. **Review differences, daily summaries, and matches.** Each category includes an explanation of what it means and what to do next. The results page has a first-time guide, category filters display contextual explanations, and detail dialogs begin with guidance. Records can be traced to their file, worksheet, and original row. PDFs include page numbers and text-line numbers reconstructed from coordinates. A multiline CSV cell belongs to one logical row.
7. **Confirm or group matches manually.** Confirm a candidate in its details, or select records for one-to-many or many-to-one matching. Records must share the same account, CNY currency, and transaction direction, with equal total amounts. Differences in amount or direction cannot be forced into a match; verify them and correct the source ledger instead. Undo, local notes, and verified / ready-to-revise markers are supported. Markers do not change the original discrepancy.
8. **Export a CSV report.** Columns use plain-language Chinese labels describing the situation, suggested action, amount difference (bank minus Suishouji), source location, and your handling status. Each row includes guidance. The report contains all results, errors, warnings, manual statuses, source locations, and settings, regardless of active filters, and all rows have the same column count. A financial-risk notice appears before export, and text that could trigger spreadsheet formulas is escaped.
9. **Re-import after correcting Suishouji.** By default, the new Suishouji batch replaces the previous ledger while bank files are retained. Multiple files selected together form one replacement batch; additional appends require an explicit opt-in. Recalculation revalidates manual groups and reports how many previous differences disappeared, remain, or are new. Without stable transaction identifiers, previous decisions cannot be guaranteed to carry over accurately.

## Supported formats and limitations

| Source | Support |
| --- | --- |
| Generic CSV / XLSX | Header-row selection, previews, and manual field mapping |
| Suishouji XLS | Expenditure, income, and transfer sheets validated against supplied samples |
| ICBC CSV | Sample structure validated; uses **posted amount / posted currency** and excludes trailing summary rows |
| China Merchants Bank debit card CSV | Sample structure validated; supports YYYYMMDD dates and separate income / expenditure columns |
| WeChat Pay XLSX | Sample structure validated; only 零钱 expenses are retained; card payments, Lingqiantong, income and other rows are ignored |
| China Merchants Bank credit card PDF | **Text-based CNY transaction tables only**; sample structure validated, with cross-year dates, posting-date-only records, and page / line tracing |

Support for XLS, text-based PDF, and WeChat Pay was added with user authorization after the initial requirements. **Support for every official export version is not claimed; other official templates have not been validated.** Unrecognized spreadsheet templates can use generic field mapping. Unsupported PDF layouts, scanned documents, images, encrypted files, formulas, macros, and external workbook links are rejected. XLS must be a genuine BIFF file, not HTML disguised as a spreadsheet.

Some credit-card repayments provide only a posting date; their transaction date remains empty. If you select posting dates as the common date basis, other files must also provide posting dates—there is no automatic fallback to transaction dates. Transfers, credit-card installments, and repayment classifications are not inferred automatically. WeChat rows outside the change-expense scope are ignored rather than reported as parse errors. Original expense rows retain their transaction status, including refunded expenses.

Amounts are stored as decimal strings in cents, with BigInt used for aggregation and comparison. Precision already lost in an Excel source file cannot be recovered. Input amounts may have at most two decimal places. Recognized non-CNY currencies are retained but are not reconciled automatically.

## Static deployment

No backend, database, secrets, or real statements are required. `dist/` contains only the application and synthetic examples.

For a general deployment, run `npm run build` and publish `dist/`. Asset paths are relative by default. For a GitHub Pages project site:

```bash
VITE_BASE_PATH=/reconcile/ npm run build
VITE_BASE_PATH=/reconcile/ npm run preview
```

In the GitHub repository, go to **Settings → Pages**, select **GitHub Actions**, and manually run the **Deploy static site** workflow. The workflow sets the subpath from the repository name; ordinary pushes do not automatically publish the site. For a custom domain served at its root, set `VITE_BASE_PATH=/`. The static server must serve JavaScript modules with the correct MIME type and make Worker files available.

CI runs type checking, unit tests, a build, and Playwright on pushes and pull requests. The original delivery validated the local production build and subpath behavior; it did not publish GitHub Pages on the user's behalf.

## Project structure and documentation

- `src/adapters/`: source registry, generic mapping, and sample-specific adapters.
- `src/domain/transactions/`: transaction models, amount handling, and date rules.
- `src/domain/reconciliation/`: independent, deterministic reconciliation, summaries, and account-link suggestions; no React or DOM dependency.
- `src/workers/`: file limits, parsing, matching workers, cancellation, and timeouts.
- `src/components/` and `src/App.tsx`: Chinese-language interface and in-memory session state.
- `src/export/`: CSV exports with formula-injection protection.
- `tests/`: synthetic fixtures, Vitest, and Playwright.
- Additional documentation (in Chinese): [FAQ](docs/faq.md), [Matching rules](docs/matching.md), [Adapter guide](docs/adapters.md), [Privacy and limitations](docs/privacy.md), [Dependencies and licenses](docs/dependencies.md), and [Validation notes](docs/validation.md).

## License

Licensed under [MIT](LICENSE); retain the original copyright notice. Third-party dependencies are distributed under their respective licenses. PDF.js and SheetJS CE use Apache-2.0. Real statements are not part of the public source code or test data.
