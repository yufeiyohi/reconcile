import type { ParsedSheet } from "../adapters/types";
export async function readLegacyXls(
  buffer: ArrayBuffer,
): Promise<ParsedSheet[]> {
  const bytes = new Uint8Array(buffer);
  if (
    bytes[0] !== 0xd0 ||
    bytes[1] !== 0xcf ||
    bytes[2] !== 0x11 ||
    bytes[3] !== 0xe0
  )
    throw new Error("仅支持真正的 BIFF XLS；不支持伪装为 XLS 的 HTML 文件");
  const { read, utils } = await import("@e965/xlsx");
  let book;
  try {
    book = read(buffer, {
      type: "array",
      cellDates: true,
      cellFormula: true,
      bookVBA: true,
      bookFiles: false,
      sheetRows: 20102,
    });
  } catch {
    throw new Error("XLS 解析失败，不支持加密、损坏或伪装格式");
  }
  if (book.vbaraw) throw new Error("不支持含宏的 XLS 文件");
  if (book.SheetNames.length > 20) throw new Error("工作表超过 20 张");
  return book.SheetNames.map((name) => {
    const sheet = book.Sheets[name];
    const range = utils.decode_range(
      sheet["!fullref"] || sheet["!ref"] || "A1",
    );
    if (range.e.r > 20100 || range.e.c >= 100)
      throw new Error("XLS 工作表超过允许行列范围");
    for (const [key, cell] of Object.entries(sheet)) {
      if (key.startsWith("!")) continue;
      if (cell.f || cell.l)
        throw new Error("不支持包含公式或超链接的 XLS；请另存为纯值文件");
    }
    const rows = utils
      .sheet_to_json<unknown[]>(sheet, {
        header: 1,
        raw: true,
        defval: "",
        blankrows: true,
        range: 0,
      })
      .map((row) =>
        row.map((value) =>
          value instanceof Date
            ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`
            : String(value ?? ""),
        ),
      );
    return { name, rows };
  });
}
