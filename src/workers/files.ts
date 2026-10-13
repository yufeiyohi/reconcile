import Papa from "papaparse";
import readXlsx from "read-excel-file/universal";
import { Unzip, UnzipInflate, strFromU8 } from "fflate";
import { readLegacyXls } from "./xls";
import { readCreditPdf } from "./pdf";
import type { ParsedFile, ParsedSheet } from "../adapters/types";
import { MAX_FILE_SIZE, MAX_ROWS, MAX_COLUMNS } from "./limits";
const MAX_UNPACKED = 30 * 1024 * 1024;
/** Inspect actual streamed decompression, not just attacker-controlled ZIP sizes. */
export function inspectXlsx(bytes: Uint8Array): void {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b)
    throw new Error("不支持加密工作簿、旧版 XLS 或伪装的 XLSX 文件");
  let total = 0,
    entries = 0;
  const names = new Set<string>();
  const unzip = new Unzip((file) => {
    if (++entries > 500) throw new Error("XLSX 内部文件过多");
    if (names.has(file.name)) throw new Error("XLSX 含重复内部文件");
    names.add(file.name);
    if (file.originalSize && file.originalSize > MAX_UNPACKED)
      throw new Error("XLSX 解压体积超过 30 MB");
    if (/vbaProject|externalLinks|embeddings/i.test(file.name))
      throw new Error("不支持包含宏、外部工作簿或嵌入对象的文件");
    const parts: Uint8Array[] = [];
    let size = 0;
    file.ondata = (error, data, final) => {
      if (error) throw new Error("XLSX 压缩数据损坏或加密");
      total += data.length;
      size += data.length;
      if (total > MAX_UNPACKED) throw new Error("XLSX 解压体积超过 30 MB");
      parts.push(data);
      if (final && /\.xml$|\.rels$/i.test(file.name)) {
        const merged = new Uint8Array(size);
        let offset = 0;
        for (const p of parts) {
          merged.set(p, offset);
          offset += p.length;
        }
        const xml = strFromU8(merged);
        if (
          /<!DOCTYPE|<!ENTITY|<(?:\w+:)?f(?:\s|\/?>)|TargetMode\s*=\s*["']External["']/i.test(
            xml,
          )
        )
          throw new Error(
            "不支持含公式、外部链接或 XML 实体的工作簿，请先另存为纯值文件",
          );
        if (/worksheets\/.*\.xml$/i.test(file.name)) {
          for (const match of xml.matchAll(
            /\br\s*=\s*["']([A-Z]*)(\d+)["']/g,
          )) {
            let col = 0;
            for (const c of match[1]) col = col * 26 + c.charCodeAt(0) - 64;
            if (Number(match[2]) > MAX_ROWS + 100 || col > MAX_COLUMNS)
              throw new Error("工作表行列范围超限（20,000 条记录 / 100 列）");
          }
        }
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  try {
    for (let offset = 0; offset < bytes.length; offset += 16384)
      unzip.push(
        bytes.subarray(offset, offset + 16384),
        offset + 16384 >= bytes.length,
      );
  } catch (e) {
    if (e instanceof Error) throw e;
    throw new Error("XLSX 文件损坏或不受支持");
  }
  if (!names.has("xl/workbook.xml") || !names.has("[Content_Types].xml"))
    throw new Error("无效 XLSX 工作簿");
}
/** Pick the text encoding for a CSV so beginners do not have to know theirs. */
export function decodeCsv(
  buffer: ArrayBuffer,
  encoding = "auto",
): { decoded: string; warning?: string } {
  const bytes = new Uint8Array(buffer);
  const tryDecode = (label: string) => {
    try {
      const decoded = new TextDecoder(label, { fatal: true }).decode(buffer);
      // A UTF-16 file decodes as valid UTF-8 full of NUL bytes; reject that.
      return decoded.includes("\u0000") ? null : decoded;
    } catch {
      return null;
    }
  };
  if (encoding !== "auto") {
    const decoded = tryDecode(encoding);
    if (decoded === null)
      throw new Error(
        "按所选编码读取失败，请把“CSV 编码”改回“自动识别”，或将文件另存为 UTF-8 CSV",
      );
    return { decoded };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    const decoded = tryDecode("utf-16le");
    if (decoded !== null)
      return { decoded, warning: encodingNote("UTF-16 LE") };
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    const decoded = tryDecode("utf-16be");
    if (decoded !== null)
      return { decoded, warning: encodingNote("UTF-16 BE") };
  }
  for (const [label, name] of [
    ["utf-8", "UTF-8"],
    ["gb18030", "GB18030 / GBK（中文 Windows 常用）"],
    ["utf-16le", "UTF-16 LE"],
  ]) {
    const decoded = tryDecode(label);
    if (decoded !== null)
      return {
        decoded,
        warning: label === "utf-8" ? undefined : encodingNote(name),
      };
  }
  throw new Error(
    "文本编码无法识别，请在“CSV 编码”里手动选择 GB18030，或将文件另存为 UTF-8 CSV",
  );
}
const encodingNote = (name: string) =>
  `已自动按 ${name} 编码读取此 CSV；若预览出现乱码，请在“CSV 编码”里手动选择后重新导入。`;
export async function readFileData(
  name: string,
  buffer: ArrayBuffer,
  encoding = "auto",
): Promise<ParsedFile> {
  if (buffer.byteLength > MAX_FILE_SIZE)
    throw new Error("文件超过 10 MB，请分段导出");
  if (!buffer.byteLength) throw new Error("文件为空");
  const ext = name.split(".").pop()?.toLowerCase();
  if (!["csv", "xlsx", "xls", "pdf"].includes(ext || ""))
    throw new Error(
      "支持 CSV、XLSX、XLS 及招行信用卡文本 PDF；不支持图片、扫描件或加密文件",
    );
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  const id = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  let sheets: ParsedSheet[];
  let extraWarnings: string[] = [];
  if (ext === "csv") {
    const text = decodeCsv(buffer, encoding);
    const decoded = text.decoded;
    if (text.warning) extraWarnings.push(text.warning);
    const parsed = Papa.parse<string[]>(decoded, {
      skipEmptyLines: false,
      dynamicTyping: false,
    });
    const meaningful = parsed.errors.filter(
      (e) => e.code !== "UndetectableDelimiter",
    );
    if (meaningful.length)
      throw new Error(
        `CSV 结构错误：${meaningful[0].code}；请检查引号与分隔符`,
      );
    sheets = [{ name: "CSV", rows: parsed.data }];
  } else if (ext === "xls") {
    sheets = await readLegacyXls(buffer);
    extraWarnings.push(
      "旧版 XLS 已读取；请核对工作表和金额显示，数值精度受原文件存储限制。",
    );
  } else if (ext === "pdf") {
    const parsed = await readCreditPdf(buffer);
    sheets = parsed.sheets;
    extraWarnings = parsed.warnings;
  } else {
    inspectXlsx(new Uint8Array(buffer));
    try {
      const book = await readXlsx(buffer, {
        parseNumber: (s) => s,
        trim: false,
      });
      sheets = book.map((s) => ({
        name: s.sheet,
        rows: s.data.map((row) =>
          row.map((cell) =>
            cell instanceof Date
              ? `${cell.getUTCFullYear()}-${String(cell.getUTCMonth() + 1).padStart(2, "0")}-${String(cell.getUTCDate()).padStart(2, "0")}`
              : cell === null
                ? ""
                : String(cell),
          ),
        ),
      }));
    } catch {
      throw new Error("XLSX 解析失败：文件损坏、加密或不支持的单元格格式");
    }
  }
  if (!sheets.length || sheets.length > 20)
    throw new Error("工作表为空或超过 20 张");
  let rows = 0;
  for (const sheet of sheets) {
    rows += sheet.rows.length;
    if (
      sheet.rows.some(
        (r) => r.length > MAX_COLUMNS || r.some((c) => c.length > 10000),
      )
    )
      throw new Error("列数超过 100 或单元格文字过长");
  }
  if (rows > MAX_ROWS + 100)
    throw new Error("单个文件超过 20,000 条记录，请分段导出");
  if (!sheets.some((s) => s.rows.some((r) => r.some((c) => c.trim()))))
    throw new Error("文件没有可读取的数据");
  return {
    id,
    name,
    sheets,
    warnings: [
      ...extraWarnings,
      "文件首末交易日期仅表示观测范围，无法证明中间日期无缺页或漏导出。",
    ],
  };
}
