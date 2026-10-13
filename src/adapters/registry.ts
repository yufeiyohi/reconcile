import suishouji from "./suishouji";
import icbc from "./banks/icbc";
import cmb from "./banks/cmb";
import credit from "./banks/cmb-credit";
import wechat from "./wechat";
import type { StatementAdapter } from "./types";
export function createRegistry(adapters: StatementAdapter[]) {
  const map = new Map<string, StatementAdapter>();
  for (const adapter of adapters) {
    if (map.has(adapter.id)) throw new Error("适配器 ID 重复");
    map.set(adapter.id, adapter);
  }
  return map;
}
export const adapterRegistry = createRegistry([
  suishouji,
  icbc,
  cmb,
  credit,
  wechat,
]);
