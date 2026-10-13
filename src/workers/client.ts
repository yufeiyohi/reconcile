const active = new Set<Worker>();
export function cancelAllWorkers() {
  for (const w of active) {
    w.dispatchEvent(new Event("cancel"));
    w.terminate();
  }
  active.clear();
}
export function workerTask<T>(type: string, payload: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./processor.ts", import.meta.url), {
      type: "module",
    });
    active.add(worker);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
      active.delete(worker);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error("处理超过 30 秒，已终止；请缩小文件或日期范围"));
    }, 30000);
    worker.addEventListener("cancel", () => {
      finish();
      reject(new Error("已取消处理"));
    });
    worker.onerror = () => {
      finish();
      reject(new Error("文件处理线程失败，未生成对账结果"));
    };
    worker.onmessage = (event) => {
      if (event.data?.kind !== "reconcile-result") return;
      finish();
      if (event.data.ok) resolve(event.data.result as T);
      else reject(new Error(event.data.error));
    };
    worker.postMessage({ type, payload });
  });
}
