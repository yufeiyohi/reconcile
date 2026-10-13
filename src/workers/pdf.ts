import DOMMatrixShim from "@thednp/dommatrix";
import type { ParsedSheet } from "../adapters/types";
import { parseDate } from "../domain/transactions/normalize";
export interface PdfLine {
  page: number;
  line: number;
  text: string;
}
export function parseCreditLines(lines: PdfLine[]): {
  sheets: ParsedSheet[];
  warnings: string[];
} {
  lines = lines.map((l) => ({
    ...l,
    text: l.text.normalize("NFKC").replace(/\u2ea0/g, "民"),
  }));
  const all = lines.map((l) => l.text).join("\n");
  if (
    !all.includes("招商银行") ||
    !all.includes("人民币金额") ||
    !all.includes("记账日")
  )
    throw new Error(
      "当前 PDF 仅适配已验证结构的招行信用卡人民币文本账单；请改用 CSV / XLSX",
    );
  const label = lines.findIndex((l) => /账单日|Statement\s+Date/i.test(l.text));
  const nearby = lines
    .slice(Math.max(0, label - 2), label + 4)
    .map((l) => l.text)
    .join(" ");
  const dateMatch = nearby.match(
    /(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/,
  );
  if (!dateMatch)
    throw new Error("无法确认 PDF 账单年份，请使用 CSV / XLSX，不猜测跨年日期");
  const statement = parseDate(
    `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}`,
  )!;
  const fullDate = (mmdd: string) => {
    const [mo, d] = mmdd.split("/").map(Number);
    let year = Number(dateMatch[1]);
    let date = parseDate(`${year}-${mo}-${d}`)!;
    if (date > statement) date = parseDate(`${year - 1}-${mo}-${d}`)!;
    return date;
  };
  const headers = [
    "交易日期",
    "入账日期",
    "方向",
    "金额",
    "账户",
    "摘要",
    "币种",
    "原PDF页",
    "原PDF行",
  ];
  const rows: string[][] = [headers];
  const warnings = [
    "PDF 仅解析文本型招行信用卡人民币表；不执行脚本、附件、链接或 OCR。请核对预览，交易地金额不参与 CNY 核对。",
  ];
  let count = 0;
  for (const line of lines) {
    const s = line.text.trim();
    if (!/^\d{1,2}\/\d{1,2}\b/.test(s)) continue;
    count++;
    const m = s.match(
      /^(\d{2}\/\d{2})\s+(?:(\d{2}\/\d{2})\s+)?(.+?)\s+(-?[\d,]+\.\d{2})\s+(\d{4})\s+(-?[\d,]+\.\d{2})\s*$/,
    );
    if (!m)
      throw new Error(
        `PDF 第 ${line.page} 页文本第 ${line.line} 行存在无法识别的交易，已停止导入，避免漏行`,
      );
    const amount = m[4],
      negative = amount.startsWith("-");
    rows.push([
      m[2] ? fullDate(m[1]) : "",
      fullDate(m[2] || m[1]),
      negative ? "收入" : "支出",
      amount.replace(/^-/, ""),
      `信用卡尾号${m[5]}`,
      m[3],
      "CNY",
      String(line.page),
      String(line.line),
    ]);
  }
  if (!count) throw new Error("PDF 中未识别出交易表，不能按空账单导入");
  if (rows.some((r) => !r[0]))
    warnings.push(
      "部分还款仅提供记账日，交易日期保持为空；请使用入账日期口径或在来源文件核实。",
    );
  warnings.push(
    "信用卡正数按账户支出、负数按账户收入保留；还款、分期和手续费不自动视为消费分类。",
  );
  return { sheets: [{ name: "信用卡人民币明细", rows }], warnings };
}
export async function readCreditPdf(
  buffer: ArrayBuffer,
): Promise<{ sheets: ParsedSheet[]; warnings: string[] }> {
  if (!("DOMMatrix" in globalThis))
    Object.assign(globalThis, { DOMMatrix: DOMMatrixShim });
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const workerUrl = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  );
  const pdfWorker = new Worker(workerUrl, { type: "module" });
  pdfjs.GlobalWorkerOptions.workerPort = pdfWorker;
  const loading = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableFontFace: true,
    useSystemFonts: false,
    isOffscreenCanvasSupported: false,
    useWorkerFetch: false,
    enableXfa: false,
    useWasm: false,
    verbosity: 0,
  });
  loading.onPassword = () => {
    void loading.destroy();
  };
  try {
    const doc = await loading.promise;
    if (doc.numPages > 30) throw new Error("PDF 超过 30 页，请按账期分割");
    const lines: PdfLine[] = [];
    let chars = 0;
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const content = await page.getTextContent();
      const groups: {
        y: number;
        parts: { x: number; width: number; text: string }[];
      }[] = [];
      for (const item of content.items) {
        if (!("str" in item)) continue;
        chars += item.str.length;
        if (chars > 1_000_000) throw new Error("PDF 文本量超限");
        if (!item.str.trim()) continue;
        const y = item.transform[5],
          x = item.transform[4];
        let g = groups.find((g) => Math.abs(g.y - y) < 2);
        if (!g) {
          g = { y, parts: [] };
          groups.push(g);
        }
        g.parts.push({ x, width: item.width, text: item.str });
      }
      groups.sort((a, b) => b.y - a.y);
      groups.forEach((g, i) =>
        lines.push({
          page: p,
          line: i + 1,
          text: g.parts
            .sort((a, b) => a.x - b.x)
            .reduce(
              (text, part, index, parts) =>
                text +
                (index &&
                part.x - (parts[index - 1].x + parts[index - 1].width) > 1
                  ? " "
                  : "") +
                part.text,
              "",
            )
            .replace(/\s+/g, " ")
            .trim(),
        }),
      );
      page.cleanup();
    }
    if (chars < 100)
      throw new Error("PDF 无足够可读取文本；扫描件、图片型 PDF 暂不支持 OCR");
    return parseCreditLines(lines);
  } catch (e) {
    if (
      e instanceof Error &&
      (/password|encrypted|destroyed/i.test(e.message) ||
        e.name === "PasswordException")
    )
      throw new Error("不支持加密或需密码的 PDF");
    throw e;
  } finally {
    await loading.destroy();
    pdfWorker.terminate();
    pdfjs.GlobalWorkerOptions.workerPort = null;
  }
}
