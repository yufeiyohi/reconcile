# 新增来源适配器

实现 src/adapters/types.ts 的 StatementAdapter，再加入 src/adapters/registry.ts。UI 从注册表生成入口；引擎只处理标准模型，不写银行分支。

```ts
import { createGenericAdapter } from "../generic";
export default createGenericAdapter("new-bank", "新银行");
```

通用适配器支持预览与手动映射。有样本时可用 profiledAdapter 提供必要表头和警告，或自己实现 detect / parse。detect 返回置信度、理由；没有样本必须说明未验证。

parse 返回记录、逐行错误、警告，不把失败变成零条成功，不猜本人账户，不静默丢弃未知行。汇总尾行只能按已知结构排除并报告行号。转换时保留行槽，不能过滤后重编号。

支持单金额加方向，或独立收入 / 支出。用符号推断方向须用户确认。未知币种、非法金额 / 日期、方向冲突要报错。业务 ID 不可默认当作跨来源同义编号。

转账拆成两腿须分别建立唯一 ID，保留同一个 transferGroupId 和 isTransfer。其他文件格式须有资源限制与明确拒绝规则。

先添加合成解析测试，再验证标准记录进入引擎。tests/unit/parsing.test.ts 示范注册 testbank 并成功匹配，未修改引擎。真实账单、摘要截图、凭证和测试快照不能放进仓库。
