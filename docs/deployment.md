# Hermes 部署说明（第二阶段）

前端和 Node 后端部署到 `122.51.151.143`，连接 `1.15.64.31:3306` 的 MySQL 数据库 `reconcile`。本次只提交代码，不执行远程部署，不接入真实数据库或随手记账号。

## 准备与启动

需要 Node.js 24、npm、MySQL 8.0 或更高版本，以及同域 HTTPS 反向代理。应用默认从网站根路径提供前端和 `/api`。静态 GitHub Pages 不能运行此后端。

```bash
npm ci
cp .env.example .env
# Hermes 在 .env 中填写数据库账号、密码、实际 HTTPS APP_ORIGIN 和管理员凭据
npm run build
npm run db:migrate
npm start
```

`.env` 仅后端读取，默认已被 Git 忽略。所有凭据不要使用 `VITE_` 前缀，也不要传入前端构建变量。应用不创建 `reconcile` 数据库；初始化命令只创建有 `reconcile_` 前缀的业务表。初始化可重复执行，保留现有账号、账单和工作区。正常启动不运行迁移，不覆盖表。

优先用 `npm run password:hash` 生成 scrypt 密码摘要，填写 `ADMIN_PASSWORD_HASH`（使用单引号保留字面值）。该命令从标准输入读取密码；在可信终端通过隐藏输入提供：

```bash
read -r -s -p '管理员密码: ' reconcile_password
printf '\n'
printf '%s\n' "$reconcile_password" | npm run --silent password:hash
unset reconcile_password
```

密码须为 12–256 字符。也可只在首次初始化时设置 `ADMIN_PASSWORD`，初始化后删除该明文配置。之后修改 `.env` 不会自动覆盖已创建的管理员账号。要重置密码，在 `.env` 设置新摘要后运行 `npm run admin:password`，会更新单一管理员并撤销所有旧会话，记录审计事件。网站只支持一个管理员，无注册入口。

后端绑定 `127.0.0.1:3000`。Hermes 使用 systemd / PM2 等服务管理器保持运行，并从项目根目录启动（这里有 `.env`、`dist/`、`server-dist/`）。构建需要开发依赖；构建后运行时可用 `npm ci --omit=dev` 保留生产依赖。

## HTTPS 反向代理

替换域名和证书路径。`APP_ORIGIN` 必须与浏览器访问的 HTTPS 域名完全一致，包括非默认端口，不包含路径。`TRUST_PROXY=1` 仅用于一层本机 Nginx，并保持后端只监听回环地址。

```nginx
server {
    listen 443 ssl;
    server_name reconcile.example.com;
    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;
    client_max_body_size 25m;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $remote_addr;
        proxy_read_timeout 60s;
    }
}
```

Hermes 可增加 HTTP 到 HTTPS 重定向。不要把 `.env`、数据库证书或项目根目录直接作为静态目录；Node 只提供 `dist/`。

MySQL 账户需能在 `reconcile` 内初始化表、读写数据。可在迁移后改为运行专用账号。数据库应允许应用服务器 `122.51.151.143` 连接；应用不需要数据库管理公网入口。若数据库启用 TLS，在 `DB_SSL_CA_FILE` 配置 CA 文件，应用保持证书验证。

## 保存的数据

- `reconcile_users`：唯一管理员及密码摘要。
- `reconcile_sessions`：会话令牌摘要和 12 小时有效期；原令牌仅在 HttpOnly Cookie 中。
- `reconcile_statements`：CSV / Excel / PDF 提取的原始表格、字段映射、解析结果、文件哈希和版本。原始 XLS / PDF 二进制文件不保存。
- `reconcile_transactions`：后端重新标准化的逐笔记录；金额和余额以分保存，保留账户、日期和原始行位置。
- `reconcile_workspace`：本次选中的文件、账户关联、期间、期初余额、人工配对与复核备注。刷新和下次登录恢复它。
- `reconcile_audit`：登录成败、退出、导入、修改字段、删除、保存工作区、对账、复核和导出事件；没有密码、令牌或交易明细。

银行账单保存后持续保留。随手记目前保存导入快照，导入新版本替换工作区中的旧快照，历史文件仍可恢复；自动同步尚未接入。`GET /api/sync/status` 明确返回未配置，不会模拟成功或自动登录第三方。

移除文件 / 清空工作区仅修改选择，数据库账单仍保留。永久删除需要在“已保存账单”里确认，且先从当前工作区移除并等待保存。删除原始表格及关联记录，保留审计事件。建议 Hermes 建立数据库备份和恢复流程；应用不提供自动备份。

自动保存会显示等待、保存中、成功或失败。修改账单和工作区均使用版本检查，冲突时停止保存，要求重新载入，避免覆盖另一页面的数据。离开前确认显示“已保存到数据库”。

## 本地开发与验证

```bash
# 开发环境 .env: NODE_ENV=development，APP_ORIGIN=http://127.0.0.1:5173
npm run build:server
npm run db:migrate
npm start
# 另一终端
npm run dev
```

Vite 将 `/api` 代理到 `127.0.0.1:3000`。必须用 APP_ORIGIN 对应的地址访问，否则修改请求被拒绝。登录限流为每个 IP 15 分钟内最多 5 次失败，成功后重置。生产 Cookie 为 Secure / HttpOnly / SameSite=Strict；修改请求校验同源及专用请求头。

```bash
npm run typecheck
npm test
npm run build
# 需要独立 reconcile_test* 数据库，绝不能使用真实 reconcile 库
TEST_DB_HOST=127.0.0.1 TEST_DB_PORT=33306 npm run test:server
npm run test:e2e
```

服务端测试使用 `TEST_DB_*`，默认仅连接本机合成测试库并清理该测试库数据；名称必须以 `reconcile_test` 开头。MySQL 集成测试和登录浏览器测试要求先执行默认服务器模式构建。最后一个命令为原浏览器计算流程重新构建明确的 `VITE_APP_MODE=local` 模式，不会操作 MySQL；生产发布前必须重新执行不带该变量的 `npm run build`。

## 后续随手记接口

待确认使用的随手记产品、官方 API 文档及授权方式后，增加同步适配器：由后端保管凭据、拉取数据、生成新账本快照并记录同步日志。现阶段不需要将随手记密码写入 `.env`，不抓取 Cookie，不提供未经验证的接口调用。

## 导入防呆与跨文件去重升级

更新代码后执行 `npm run build`、`npm run db:migrate`，再重启服务。迁移会为 `reconcile_transactions` 添加 `excluded_duplicate`、`duplicate_of`、`duplicate_issue` 三列，重复执行保留现有数据，正常启动不自动迁移。MySQL 8.0.24 的连接兼容性配置保留。

前端根据已验证的表头结构检查来源，已知来源不符拒绝导入；未知模板需明确确认。后端重复校验，确认选项不能绕过来源冲突。旧文件恢复时也检查来源：来源不符或未确认的未知模板暂停对账，不删除原表格。已错误归类的旧文件可从工作区移除、在账单库中永久删除，再从正确窗口重新导入。

公司 / 对公账户不根据银行关键词自动关联。旧的未确认公司卡关联会清空并要求手动选择，手动确认存入工作区；没有账单被删除。普通账户自动建议不再把一个目标账户同时分配给多个未确认的账本账户。

跨文件去重以同一来源、账户、可靠唯一交易编号及一致的关键内容为条件。验证过的“银行交易编号”字段和微信“交易单号”可用；普通“交易编号” / “流水号”需用户在文件字段设置确认它确实逐笔唯一且稳定。空值、0 等占位编号不使用；同文件重复编号、同编号内容冲突、仅同日同额记录全部保留。

原始账单及每一行都保留。数据库规范流水用 `excluded_duplicate=1` 标记可靠副本、`duplicate_of` 指向当前保留记录；查询全库有效流水时使用 `WHERE excluded_duplicate=0`。`duplicate_issue` 的 possible / conflict 表示需核实，不自动删除。新增、修改、删除文件后在事务内重算同来源的标记；删除保留记录会提升幸存副本。当前工作区按选中账单独立去重，单独恢复一份原始文件仍可核对其完整内容。

审计事件含去重及疑似重叠数量，不包含交易内容。前端显示原始文件 / 行号与排除数量，汇总、余额、人工配对和 CSV 报告均遵守排除标记。存在疑似重叠或编号冲突的账户余额暂不判为正常。
