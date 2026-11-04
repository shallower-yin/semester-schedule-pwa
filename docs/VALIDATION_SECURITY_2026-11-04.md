# 验证、压力与安全测试报告

日期：2026-11-04（Asia/Shanghai）。对象：当前未提交工作区，包含前两轮重构与用户已有修改，不代表线上已部署版本。

> 本文保留修复前的审计证据。随后已按用户授权完成本地修复，最新状态与复验结果见 [修复报告](SECURITY_FIXES_2026-11-04.md)。下文的失败计数、未修复说明与依赖告警数属于修复前基线。

## 结论

功能与有界数据压力验证通过，但新增安全验收未通过。确认管理员中转地址的内网校验存在 IPv4-mapped IPv6 绕过；普通 AI 问题没有应用层长度边界；畸形输入错误分类需要修正。另有构建依赖告警及大量备忘录列表的主线程停顿。

本轮只新增测试与报告，没有修改产品实现、依赖、数据库或部署配置；发现的问题尚未修复。红色安全回归保留，不应跳过或改成“断言不安全现状即通过”。

## 隔离与执行范围

- 主代理 + 3 个独立子代理并行；子代理使用 GPT-6.1 Sol、low 推理配置。当前工具未提供 Fast/Ultrafast 服务档位切换参数，未改变 Codex 全局配置。
- 数据压力使用 jsdom/fake-indexeddb；数据库额度验证使用 PGlite 与仓库真实迁移 SQL；Edge 入口使用真实实现，但所有 HTTP、DNS、S3 都由测试替身处理。
- Deno 未授予运行时网络权限；未知 Mock 地址触发失败。
- 浏览器采用新建独立会话、本地 Vite 4182、禁用 Supabase 配置并拦截非本地请求；只创建合成数据。
- 未向生产发送压力或攻击流量，未访问真实内网，未进行付费 AI 调用，未提交、推送或部署。

## 验证汇总

| 项目 | 结果 | 证据范围 |
| --- | --- | --- |
| 全量 Vitest | 126 文件、812 项通过 | 包含新增 7 项数据压力测试 |
| TypeScript | 通过 | `tsc --project tsconfig.app.json --noEmit` |
| Deno 检查与全套测试 | 类型检查通过；21 项通过、2 项失败；28 子步骤通过、3 子步骤失败 | 两个失败父测试均为本轮新增安全验收，三个失败原因见下文 |
| Android 离线单测 | 4 类、16 项通过，0 失败/错误/跳过 | Gradle debug Java 编译及本地 JUnit；不是 APK 真机验收 |
| 浏览器功能 | 通过已执行场景 | 事项新增/编辑/当日完成、待办新增/完成、备忘录新增/编辑、通知精确跳转、返回/前进、已加载页离线浏览 |
| 文本 XSS | 所测入口未执行标记载荷 | 事项标题/备注、待办标题、备忘录正文；不能外推到所有渲染入口 |
| RLS/SQL 权限 | 定向静态检查见现有保护 | 未用真实 Postgres 角色或生产令牌验证 |
| 依赖审计 | 全依赖 12 项告警：9 中危、3 低危；高危/严重为 0；`--omit=dev` 为 0 | 这是受影响依赖项数，不是 12 个独立运行时漏洞 |

本轮未改变产品实现，因此未重复上轮已通过的 Vite 生产构建；本轮新增测试已通过 TypeScript 检查，后端安全失败独立保留。

## 安全发现

### S1：管理员中转地址的内网校验绕过（P2 / 中等）

- 代码：`supabase/functions/admin/index.ts` 的 `validatePublicRelayBaseUrl` / `isPrivateAddress`（约 1022–1068 行）。
- 本地复现：有效且启用的管理员提交映射 IPv6 回环地址，URL 规范化成 `https://[::ffff:7f00:1]/v1` 后，入口返回 200，并发生 1 次 Mock 配置写入。
- 原因：校验只匹配带十进制 IPv4 尾部的 `::ffff:127.` 等形式，没有识别规范化后的十六进制映射地址。IPv6 字面量 DNS 查询失败后转为空结果，不能补上这层拦截。
- 边界：普通用户、禁用管理员和过期管理员仍被拒绝。未测试真实内网连通、TLS、响应内容，不能声称已完成 SSRF、泄露或提权。
- 建议：规范化并分类 IPv4-mapped IPv6，在保存和使用中转地址时统一校验；另行验证重定向与 DNS 变化防护，不能只修一个字符串样例。
- 回归：`supabase/functions/admin/security_validation_test.ts` 第四个子步骤保持失败；其余登录、角色、自助删除目标隔离、普通内网地址保护通过。

### S2：普通 AI 问题缺少应用层长度边界（中等候选风险）

- 代码：`supabase/functions/ai-assistant/requestHandler.ts:24` 直接解析 JSON；`index.ts:551` 普通问题只 trim；普通问答向 provider 拼接完整问题。
- 探针：已授权 member 发送 2 MiB 普通问题，返回 200 并调用一次 Mock provider；实收请求体 2,103,729 字符，user 消息 2,097,182 字符，未截断。
- 可能影响：解析内存、上游上下文与费用放大。次数额度仍然预留，没有证据表明次数额度被绕过。
- **2 MiB 是本轮新增探针阈值，不是已有产品合同。** 未测真实模型/网关限制、生产内存或并发极限，不能宣称已经证明线上 DoS。
- 建议：按 action/输入类型定义普通问题、历史、附件及请求体的限制，在 provider/额度消费前拒绝无效输入；不能把所有合法音频/图片一律压成相同小上限。
- 回归：`security_validation_test.ts` 的 oversized question 子步骤保持失败，明确标为新增加固目标未达。

### S3：畸形请求返回 500 和内部类型/解析错误（低严重度）

- `{`、`null`、数字或对象形式的 question 均返回 500，而非安全的 400 输入错误。
- provider 和额度预留均为 0，未造成鉴权绕过。
- 建议：增加请求 schema/类型验证，错误响应不返回原始解析器/类型错误细节。
- 回归：`security_validation_test.ts` 的 malformed bodies 子步骤保持失败。

### 已验证的安全保护

- 缺失/无效身份以及无功能权限在 provider/额度调用前拒绝。
- 跨账号临时文档 objectKey 删除被拒绝，S3 调用为 0。
- 过期、篡改和超出有效期窗口的音频签名被拒绝，存储/provider/额度预留为 0。
- 自助注销忽略伪造目标，只使用身份服务返回的当前用户 ID。
- 现有音频任务用例验证签名重放、manifest 变化、关闭/过期、并发与重试上限，以及 service_role 授权。
- SQL 静态检查发现主要业务表 owner RLS、关键父子复合外键、管理员 RPC 的函数内鉴权及 service_role-only 计费 RPC；迁移部署状况仍未验证。

## 压力测试

所有数字为本机单轮观测，不是容量承诺；不同轮次和并行任务会影响时延。

| 场景 | 参数 | 结果 |
| --- | --- | --- |
| 同记录写入与旧确认竞争 | 200 并发写 | 最终版本和最新队列保留；代表轮 p50 97.10ms、p95 147.13ms，含事务排队 |
| 跨账号队列隔离 | 两账号、100 组相同 ID，共 200 并发 | owner/ID 不混合 |
| 专注完成幂等 | 两账号各 100 次，共 200 并发 | 每账号仅一条记录和队列项 |
| 删除/恢复原子性 | 第 100 次删除、第 1000 条恢复注入故障 | 全部回滚；随后恢复 1000 条成功 |
| 重叠布局计算 | 1000 / 10000 条全部重叠事项 | 条目不丢、列独立、结果不越界；代表轮约 16 / 206ms，仅算法计算 |
| 请求诊断隔离 | Mock 50 并发、500 请求 | 500 个独立诊断 ID；最终整套执行约 558ms，不是生产 RPS |
| SQL 准入/重放 | PGlite 50 并发、500 调用 | 首次准入唯一，其他拒绝或 busy；400 次完成后重放全部缓存命中，额度只计 1 次 |
| 浏览器备忘录 | 100 / 1000 条、每条约 200 字 | bulkPut 约 5.5 / 37.5ms；完整 1001 条列表有 14341 DOM 节点，观测 243ms 主线程长任务 |

浏览器列表未崩溃，但千条规模的完整列表存在可感知停顿，建议后续评估分页或虚拟列表。搜索计时含固定 350ms 等待，不能用来声称端到端性能精确达到某个数值。PGlite 是单连接排队，不代表真实 PostgreSQL 多连接锁竞争能力。

## 依赖与其他观察

生产依赖审计未报告已知告警；构建依赖的 12 项告警主要沿 PWA/Workbox 工具链传播。底层公告包括：

- deepmerge 返回对象的原型污染风险，当前公告未列修复版本。[GitHub Advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4)
- glob 在取消后继续遍历的风险。[GitHub Advisory](https://github.com/advisories/GHSA-3g3m-2fjr-6pw4)
- minimatch 的模式放大资源消耗风险。[GitHub Advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249)
- serialize-javascript 的特定序列化输出 XSS 风险。[GitHub Advisory](https://github.com/advisories/GHSA-m5mm-p8h7-m29v)

没有验证这些公告在本项目中的具体可利用路径。建议单独处理兼容升级/替换，不能直接执行可能降级 PWA 插件的 `npm audit fix --force`。

SQL 静态核查另见 `events.category_id` 缺少同 owner/存在性外键。这是引用完整性缺口，不是已证实的数据读取越权。下载页动态公告使用 `escapeHtml` 后才进入 innerHTML；本轮未对下载页做浏览器攻击测试。

## 尚未验证

- ADB 没有已连接设备。检测到 `sched_api36` AVD，但未启动、安装或改变该既有模拟器；真机/模拟器通知、后台、冷启动、升级均未验收。
- 真实双设备同步、网络断连下的跨设备冲突、真实登录/RLS/服务角色及生产迁移状态。
- 生产 Service Worker 冷启动离线、真实推送、真实 ASR/OCR 与大文件模型服务。
- 生产网关/WAF/速率限制、分布式压测、TLS/内网可达性、资源耗尽及多连接数据库并发。
- 未进行全仓历史凭据扫描、完整渗透测试或第三方安全认证。本报告不能作为“无法被攻击”的保证。

## 复现入口

```powershell
npm.cmd run test -- --maxWorkers=4
node node_modules/typescript/bin/tsc --project tsconfig.app.json --noEmit
D:\deno\deno.exe test --no-config --node-modules-dir=none --cached-only --frozen --allow-env --allow-read supabase/functions/_shared/ supabase/functions/ai-assistant/ supabase/functions/admin/security_validation_test.ts
npm.cmd audit --json
npm.cmd audit --omit=dev --json
# 工作目录：android；ANDROID_HOME=D:\AndroidDev\Sdk
.\gradlew.bat :app:testDebugUnitTest --offline --no-daemon --console=plain
```

分项记录与截图位于 `output/validation-20261104/`：`backend-security.md`、`data-stress.md`、`rls-review.md`、`browser.md` 和 `browser/*.png`。这些本地产物未发布。
