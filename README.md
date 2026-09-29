# 日程计划表

同时面向 Android APK、Android Edge/Chrome、Windows Edge/Chrome 和普通网页浏览器的响应式日程应用。数据优先保存在浏览器 IndexedDB 中，登录后通过 Supabase 在设备间同步。

## 项目定位与校园应用价值

日程计划表是一款面向高校学生的本地优先学期日程与学习规划工具。它把课程表、临时事项、待办、习惯、纪念日、备忘录和专注计时放在同一个日程入口中，帮助学生在校园学习、作息安排和跨设备复习之间减少重复录入。离线可用、按天/周查看和可选云端同步，适合课表变化频繁、需要手机与电脑协同的学习场景。

主要目标用户是需要管理学期课程和日常学习任务的大学生；天津大学课表 HTML-XLS 导入和响应式移动布局也服务于校园课表迁移与手机端快速查看场景。

## 技术栈

- React 18、TypeScript、Vite 和 `lucide-react`：构建响应式前端界面。
- Dexie + IndexedDB：保存本地课程、事项、习惯、备忘录和专注记录，并支持离线编辑。
- Supabase Auth、PostgreSQL/RLS、Storage 和 Edge Functions：提供可选账号、跨设备同步、提醒与 AI 相关云端能力。
- `vite-plugin-pwa`、Service Worker 和 Web Push：提供离线缓存、更新提示和浏览器提醒。
- Capacitor Android：复用前端代码打包 Android APK，并接入原生通知/闹钟能力。
- Vitest、Testing Library：执行日期规则、数据层和组件测试。

完整的架构、数据流和关键取舍见 [DESIGN.md](DESIGN.md)。

## 应用截图

以下截图均为独立文件，展示电脑端和手机端的实际界面。

| 功能 | 电脑端 | 手机端 |
| --- | --- | --- |
| 今天 | [查看截图](screenshots/desktop_today.png) | [查看截图](screenshots/mobile_today.png) |
| 日程 | [查看截图](screenshots/desktop_schedule.png) | [查看截图](screenshots/mobile_schedule.jpg) |
| 待办 | [查看截图](screenshots/desktop_todos.png) | [查看截图](screenshots/mobile_todos.png) |
| 习惯 | [查看截图](screenshots/desktop_habits.png) | — |
| 纪念日 | [查看截图](screenshots/desktop_anniversaries.png) | — |
| 备忘录 | [查看截图](screenshots/desktop_memos.png) | [查看截图](screenshots/mobile_memos.png) |
| 专注 | [查看截图](screenshots/desktop_focus.png) | [查看截图](screenshots/mobile_focus.jpg) |
| 健康 | [查看截图](screenshots/desktop_health.png) | — |
| 设置 | [查看截图](screenshots/desktop_settings.png) | [查看截图](screenshots/mobile_settings.jpg) |
| 使用说明 | [查看截图](screenshots/desktop_help.png) | — |
| 日程助手 | [查看截图](screenshots/desktop_schedule_assistant.png) | [查看截图](screenshots/mobile_schedule_assistant.jpg) |
| AI 助手 | [查看截图](screenshots/desktop_ai_assistant.png) | [查看截图](screenshots/mobile_ai_assistant.jpg) |
| 翻译助手 | [查看截图](screenshots/desktop_translation.png) | — |
| AI 思维导图 | [查看截图](screenshots/desktop_mind_map.png) | — |
| AI 音频转写 | [查看截图](screenshots/desktop_audio_transcription.png) | — |
| 全局搜索 | [查看截图](screenshots/desktop_search.png) | — |
| 快速录入 | — | [查看截图](screenshots/mobile_quick_entry.jpg) |

## 比赛提交材料

- [项目简介](README.md)
- [技术设计文档](DESIGN.md)
- [电脑端和手机端演示截图](screenshots/)
- [版权合规承诺书（本人手签扫描 PDF）](版权合规承诺书.pdf)

## 在线使用

[打开日程计划表](https://schedule.nfsg.eu.cc/)

在 Android Edge/Chrome 或 Windows Edge/Chrome 打开后，可通过“设置 → 安装到设备”或浏览器菜单安装。Android Edge 和 Chrome 都可以将应用添加到手机桌面；Windows 安装后一定会出现在开始菜单，但浏览器不一定自动创建桌面图标。

## 已实现

- 学期名称、开学日期、总周数和当前周计算
- 周一至周日分别自定义任意数量的课程节次和休息时段
- 桌面七日课表与手机单日课表
- 手机底部导航、浮动新增按钮和左右滑动切换日期
- 日期显示在星期上方，今日高亮
- 统一左侧时间轴和可安排事项的午休时段
- 课程与临时事项统一在“日程”入口管理
- “今天”页集中显示今日安排、逾期未完成和快捷操作
- 顶部全局搜索可直接查课程、事项、习惯、纪念日和备忘录
- 顶部快速录入可用一句话创建事项，并内置格式样例
- 顶部日程助手可在本地回答日程、课程、未完成、逾期、冲突和统计问题
- 可选 AI 助手：智能分析日程安排，可按账号或访问口令限制使用，并可从自然语言创建事项
- 管理后台可查看用户数据概览，并管理 AI 助手和管理员权限
- 首页显示今日安排、今日未完成、本周专注和今日课程概览
- 首页概览可直接打开今天的课程或事项，今日未完成可一键筛选
- 首页概览显示本周完成率、逾期未完成事项和本周专注趋势
- 日程搜索、按课程/分类/完成状态筛选、批量处理和事项快速复制
- 今天页会提示“接下来”建议项，并支持未完成事项批量推迟到明天
- 事项支持开始日期到结束日期的连续每日安排，同一时间段会出现在中间每一天
- 事项支持每天、工作日、每周、每月同日和自定义间隔重复
- 事项支持模板保存与套用、转备忘录、推迟到明天/周末/指定日期
- 习惯管理，支持日期范围、提醒、今日打卡、完成率和连续打卡统计
- 纪念日、生日和节日管理，支持搜索、分类筛选和单独提醒
- 新增课程、事项和习惯时会提示可能的时间冲突
- 事项冲突取消保存后，可一键改到系统找到的下一个空闲时间
- 课程、教师、教室、颜色、备注
- 一门课程多个上课安排
- 任意周数数组、连续周全选和单独选择
- 指定日期停课
- 天津大学 HTML-XLS 课表导入，支持合并/替换/追加、导入预览和已有课程冲突提示
- 普通事项、全天事项、日期范围和每周重复
- 分类颜色、文字和图标
- 事项按每次出现独立标记完成
- 备忘录、文件夹和搜索
- 专注计时、番茄钟、倒计时、锁机模式和专注记录统计
- 统计报表显示本周完成率、习惯完成率、逾期数量和专注趋势
- 统计报表包含分类完成率、习惯热力图和专注关联事项
- 可导出系统日历 `.ics` 文件，用于导入手机或电脑日历
- 数据健康检查可查看待同步、失败项、重复分类和异常事项
- 硬删除、版本和设备 ID
- 本地同步队列、同步诊断和重新拉取云端
- JSON 导入与导出
- JSON 导入预览和导入前自动备份
- PWA 离线缓存与更新提示
- PWA 更新支持分阶段状态提示和清缓存重载入口
- Vitest 日期、周数和重复规则测试
- Supabase 邮箱密码注册、登录和找回密码
- PostgreSQL RLS、多设备同步和最后修改者生效
- 可选事项提醒、应用内系统通知和后台 Web Push
- 应用内 PWA 安装入口，可创建桌面或主屏幕图标

## 本地运行

需要 Node.js 22 或更高版本（本地也可使用满足依赖要求的更新版本）。

不熟悉命令行时，直接双击项目根目录中的 `启动日程.cmd`，等待浏览器自动打开。不要直接双击 `index.html`。

```powershell
npm.cmd install
npm.cmd run dev
```

浏览器打开终端显示的地址，通常为 `http://localhost:5173`。

`index.html` 依赖 Vite 的模块转换和开发服务器，使用 `file://` 方式直接打开会因为模块路径和浏览器安全限制显示空白。部署后应访问 HTTPS 网站地址。

## 构建和测试

```powershell
npm.cmd run test
npm.cmd run build
npm.cmd run preview
```

生产文件生成在 `dist` 目录。

## 项目结构

- `src/App.tsx`、`src/components/`：应用入口和页面/对话框组件。
- `src/lib/`：日期、重复规则、同步、提醒、导入导出、专注和 AI 辅助等领域逻辑。
- `src/db.ts`、`src/types.ts`：Dexie 本地数据库和共享数据类型。
- `src/styles/`、`public/`：分层样式、图标、PWA 与静态资源。
- `supabase/`：数据库结构、迁移和 Edge Functions。
- `android/`、`capacitor.config.ts`：Android 工程与 Capacitor 配置。
- `scripts/`、`.github/workflows/`：本地检查、镜像部署和 CI/CD 脚本。
- `screenshots/`：项目展示截图；提交前应确认其中不含个人隐私信息。

## 部署说明

浏览器版本可由 `npm.cmd run build` 生成 `dist` 静态文件，部署到支持 HTTPS 的静态托管服务。仓库内的 GitHub Actions 提供 GitHub Pages 和无代理静态镜像流程；Cloudflare PWA 流程为手动触发。需要账号、跨设备同步、提醒或 AI 云端能力时，还需按 [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md) 配置 Supabase，并按 [docs/REMINDERS.md](docs/REMINDERS.md) 配置提醒相关服务。Android 版本使用 `npm.cmd run build:android` 后由 Capacitor 工程继续构建。

## 初次使用

1. 创建学期，开学日期填写第一教学周的星期一。
2. 在“设置 → 每日时间块设置”中分别调整周一至周日作息，可增删节次、午休和其他休息。
3. 在“日程 → 新增日程”中选择课程、临时事项或习惯。
4. 在日程空白处点击，可按对应时段创建临时事项；如果把结束日期设为后续日期，中间每一天同一时间段都会显示该事项。
5. 如需导入学校课表，进入“设置 → 天津大学课表提取器”，选择学校导出的 `.xls` 文件，并按提示选择合并、替换或追加。
6. 在“设置 → JSON 数据备份”中导出备份。

## 手机使用

- 底部导航可在“设置 → 底部按钮设置”中自行选择显示哪些入口和顺序；未显示入口仍可从左上角菜单进入。
- 日程页右下角蓝色圆形按钮用于快速新增日程。
- 手机单日视图支持左右滑动切换日期：周日继续左滑会进入下周一，周一右滑会进入上周日。
- 手机单日视图可长按空白时间格快速新增事项。
- 表单弹窗在手机上以底部抽屉显示，保存按钮固定在底部区域。

## 账号、同步和提醒

- 登录同一个邮箱账号后，手机和电脑通过 Supabase 同步数据。
- 无网时可以继续查看和编辑；恢复联网、打开应用或点击“立即同步”后会上传。
- “账号与同步”里可以查看待上传数量、同步失败原因、通知订阅状态，并可手动重新拉取云端。
- 事项、习惯和纪念日提醒分两类：应用打开时每 30 秒本地检查；应用关闭后由 Supabase Edge Function 约每分钟派发 Web Push。浏览器和系统通知权限必须都允许，错过 15 分钟以上的提醒不会补发。

## 快捷入口

- 顶部搜索按钮可以跨模块查找并直接打开记录。
- 顶部按钮可在“设置 → 顶部按钮设置”中选择显示哪些工具和顺序；手机底部入口仍在“设置 → 底部按钮设置”中单独管理。
- 顶部快速录入按钮或新增日程中的“快速录入”可用一句话创建事项。支持示例：`今天 18点30 写实验报告`、`明天 9:00 交作业`、`后天 20点 背单词`、`这周五 14:30 开组会`、`下周一 8点10 上机测试`、`7月18日 19:00 看电影`。
- 键盘 `/` 打开全局搜索，`A` 打开本地日程助手，`D` 打开 AI 助手，`M` 打开思维导图，`Q` 打开快速录入，`N` 新增今天事项，`T` 回到今天页，`Esc` 关闭当前弹窗。
- “日程助手”是本地规则问答，不会把日程发送给外部 AI。可问：`今天有什么安排？`、`明天有哪些未完成事项？`、`这周五下午有什么课？`、`高数在哪个教室？`、`最近有哪些逾期事项？`、`这周完成率多少？`、`最近 7 天专注了多久？`、`明天有冲突吗？`
- “AI 助手”可根据当前日程摘要回答安排、冲突、未完成事项和时间规划问题；也能按明确指令创建事项、习惯、纪念日、生日、节日和备忘录。后台选择 `mimo-v2.5` 时还可导入图片、PDF、DOCX、TXT、Markdown 和 CSV。
- “管理后台”只对管理员账号显示，可通过内置下拉框切换 DeepSeek / Xiaomi MiMo 及其聊天模型；MiMo 的按量 API 与 Token Plan 使用相互独立的通道和凭据。设置保存在数据库中并从下一次 AI 请求起生效；同时可修改普通用户和会员的日/周额度并管理单个账号权限，管理员不限额。
- “今天”页可以把未完成事项标记完成，或快速推迟到明天、周末和指定日期。
- “设置 → 统计与日历导出”可查看完成率并导出 ICS；“设置 → 数据健康检查”可处理重复分类和异常事项。
- “账号与同步”里可以查看提醒诊断步骤，并创建 1 分钟后的真实提醒测试。

## Supabase

数据库结构位于 `supabase/schema.sql`，配置及首次账号测试见 [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)。
数据库升级脚本按文件名顺序位于 `supabase/migrations/`。提醒机制说明见 [docs/REMINDERS.md](docs/REMINDERS.md)。

## 当前边界

- PWA 不能保证浏览器完全关闭后继续后台同步；同步时机将设为启动、恢复前台、网络恢复和手动同步。
- 专注系统小窗基于浏览器画中画能力，支持时可在其他应用上方显示倒计时；不支持画中画的设备需要保留在专注页查看。
- 左侧显示统一参考时间；每日自定义时间显示在课程卡片中。

详细的网络测试步骤见 [docs/NETWORK_TEST.md](docs/NETWORK_TEST.md)。

如果关闭代理后无法使用 Codex，可先关闭代理，再双击 `测试Supabase直连.cmd`。测试结束后重新开启代理，将生成的 `supabase-connectivity-result.txt` 发给 Codex。
