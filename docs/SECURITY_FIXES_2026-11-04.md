# 安全、性能与完整性修复

日期：2026-11-04（Asia/Shanghai）。范围：同日验证报告发现的问题。以下状态是本地工作区，不代表已上线。

## 修复结果

| 发现 | 修复 | 验证 |
| --- | --- | --- |
| IPv4-mapped IPv6 绕过内网校验 | 共享公网地址检查，覆盖 URL 规范化后的映射 IPv6、IPv4 兼容/转换地址；DNS 无结果或混入私网即拒绝；禁止 HTTP 重定向 | 原映射回环地址失败回归通过，配置写入为 0；保存、测试、实际模型调用复用规则 |
| 普通 AI 问题过大 | 问题最多 20,000 字符；按实际接收字节限制请求体 32 MiB；历史 50 条、每条 20,000、总 100,000 字符；转录正文 1,000,000 字符 | 2 MiB 问题返回 413，provider/额度调用为 0；缺失或伪造 Content-Length 不能绕过流计数 |
| 畸形输入 500/内部错误 | JSON、对象、字段及媒体语义校验；安全 400；深度/节点工作量限制 | 原坏 JSON、null、非法 question 类型回归通过；非法图片/音频/文档在授权检查后、额度预留前拒绝 |
| 千条备忘录列表停顿 | 列表每页 20 条，搜索和排序仍对全量数据执行；全局定位仍可打开非当前页记录 | 1001 条同等合成数据首屏 20 卡片、612 DOM 节点；此次窗口未观测长任务；分页、搜索末尾记录和编辑通过 |
| 构建依赖 12 项告警 | 固定兼容安全版本，并对没有已发布修复的 deepmerge 使用透明本地补丁 | 最终全依赖 npm audit 0；安全/兼容测试、干净安装、PWA 构建通过 |
| 事项分类引用完整性 | 新迁移增加 `(category_id,user_id)` 复合外键；分类删除仅清分类字段；本地删除在事务内同步解除引用 | 真实 PGlite 外键测试、本地事务回滚/owner 隔离/软删除保留测试通过 |

## 安全兼容边界

- 32 MiB 来自实际客户端上限：三张 6 MiB 图片编码后约 25.2M 字符，或三份各最多 7M 字符的 inline 扫描文档。更大扫描文档、音频使用 R2 引用。没有采用后端理论字段乘积得出的超大请求体上限。
- 读取请求体逐块计数，超过上限立即取消流；JSON 最大深度 64、节点 100,000。
- 只校验当前实际使用的自定义中转站，未使用通道的 DNS 故障不会阻断配置读取、清理、关闭音频会话或另一条内置通道。
- 附件语义校验在权限通过之后、额度预留之前，既不向无权限用户泄露处理能力，也不为纯参数错误扣额度。
- DNS 检查与实际建立连接之间仍存在网络层时间窗。本次修复关闭了已复现的地址表示绕过和 HTTP 重定向路径，不声称应用校验能替代出口网络隔离或彻底解决 DNS rebinding。

## 依赖处理说明

固定了 glob 14.0.3、minimatch 11.0.4、serialize-javascript 7.1.4、EJS 7.0.2。EJS 不再带入旧 jake/filelist 链；使用当前 OMT 的实际 loader 模板核对渲染兼容，并通过生产 Service Worker 构建。

deepmerge 最新已发布版仍为 4.3.1，未包含修复。本项目在 `vendor/deepmerge-safe/` 保留原 MIT 许可证，以 npm workspace 提供 `4.3.1-security.1`，仅让 node-resolve 构建依赖使用它。代码是在原 CommonJS bundle 的 `getKeys` 中应用窄范围 `__proto__` 过滤，来源是仍待合并的 [上游 PR #286](https://github.com/TehShrike/deepmerge/pull/286)，固定提交 `9add7d91abb595703679faf7b7942bbe7f87642b`。

这不是官方修复版，也不是只改版本号消警。执行测试覆盖实际安装的模块、source/target、空原型、嵌套、数组、merge.all、clone:false、getter以及普通键/symbol兼容。npm audit 不验证本地 vendor 包，因此必须同时保留这些安全测试和来源说明；待官方发布可信修复后再替换。

在独立临时目录，复制 package/lock/vendor 后执行 `npm ci --offline --ignore-scripts --no-audit --no-fund`，确认新安装可解析同一个本地补丁，不依赖原 node_modules。安装树检查无 invalid 依赖。没有运行 `npm audit fix --force`。

## 数据迁移

`supabase/migrations/20261104_event_category_owner.sql` 是幂等升级迁移；`schema.sql` 的新装定义一致。

- 新插入或改变关联时，分类必须存在且属于同一 owner；null 允许。
- 删除分类使用 `ON DELETE SET NULL (category_id)`，不会清空 owner 或删除事项。
- 升级约束采用 `NOT VALID`，保留历史异常关联供明确修复，不自动删除或静默改写历史内容；无关字段编辑和显式修复可继续。
- 历史异常关联跨设备重新插入会被新约束拒绝并保留待同步记录，需要恢复合法分类或更正关联后重试。应核查历史异常后再执行单独的约束验证。
- 本轮未执行任何生产迁移。数据库支持和线上已有约束状态仍须在正式发布时核对。

## 最终验证

- Vitest：**128 个文件、828 项全部通过**，`--maxWorkers=2`。
- Deno：**29 项测试、37 个子步骤全部通过**，包含原红色安全探针、真实迁移 SQL、签名/额度/重放压力。
- TypeScript 和 Vite 生产构建通过；PWA 生成 43 项预缓存资源。
- 全依赖 npm audit：**0 项告警**。本地 deepmerge 的安全性另由行为测试验证。
- 独立临时目录的离线干净安装及 node-resolve 实际依赖解析通过。
- 备忘录桌面 1280×900、手机 390×844 实际截图检查通过，分页及全量搜索可用、未见横向溢出。
- 首次将全量测试、构建、Deno 和干净安装并行时，一个原有农历批处理测试触发 15 秒超时；停止资源竞争后，单文件 16 项及完整 828 项均通过。没有调整超时或削弱断言。

备忘录性能数字为开发模式单轮抽样，不能承诺生产或低端手机的固定延迟。内存查询仍覆盖全部备忘录，本次有界化的是 DOM 渲染。

## 复现

```powershell
npm.cmd run test -- --maxWorkers=2
npm.cmd run build
npm.cmd audit --json
D:\deno\deno.exe test --no-config --node-modules-dir=none --cached-only --frozen --allow-env --allow-read supabase/functions/_shared/ supabase/functions/ai-assistant/ supabase/functions/admin/security_validation_test.ts
```

本次未提交、推送、部署、执行生产写入或调用付费 AI。真实设备、生产网络/RLS、真实 ASR/OCR 及出口网络隔离未在本轮验证。
