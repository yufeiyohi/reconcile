import { readFileData } from "./files";
import { adapterRegistry } from "../adapters/registry";
import { reconcile } from "../domain/reconciliation/engine";
self.onmessage = async (event: MessageEvent) => {
  const { type, payload } = event.data;
  try {
    let result;
    if (type === "read")
      result = await readFileData(
        payload.name,
        payload.buffer,
        payload.encoding,
      );
    else if (type === "normalize") {
      const adapter = adapterRegistry.get(payload.source);
      if (!adapter) throw new Error("适配器不存在");
      result = adapter.parse(payload.file, payload.options);
    } else if (type === "reconcile")
      result = reconcile(
        payload.transactions,
        payload.settings,
        payload.manual,
      );
    else throw new Error("任务类型无效");
    self.postMessage({ kind: "reconcile-result", ok: true, result });
  } catch (e) {
    self.postMessage({
      kind: "reconcile-result",
      ok: false,
      error:
        e instanceof Error
          ? e.message ||
            `处理失败（${e.name}）：解析库未提供详细错误，请检查文件格式`
          : "处理失败，请检查文件或设置",
    });
  }
};
