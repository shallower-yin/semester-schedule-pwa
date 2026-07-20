# 日程计划表项目交接说明（Claude 优化前）

更新时间：2026-07-20（北京时间）

## 1. 交接目标

本文件用于把当前项目交给 Claude 做全项目审查和渐进式优化。请先理解现有数据链路、跨端边界和发布保护，再开始改动。不要以“重构”为由重写产品、删除已有入口、改变用户数据语义或绕过测试。

项目本地目录今后固定为：

```text
D:\semester-schedule-pwa
```

目录名与 GitHub 仓库及 `package.json` 名称一致。不要再改回中文、带空格或特殊字符的工作区路径。

## 2. 当前代码与部署状态

- GitHub 仓库：`shallower-yin/semester-schedule-pwa`
- 当前分支：`main`
- 当前已部署提交：`b09c3d1 ci: isolate AI smoke test usage`
- 在线 PWA：<https://shallower-yin.github.io/semester-schedule-pwa/>
- 最近一次 Pages、Supabase Functions、AI 权限冒烟测试均已通过。
- 当前本地包含尚未发布的维护改动：删除中文路径专用 Gradle 绕过项、更新 README、增加本交接说明。
- `history/` 以及根目录中带任务 UUID 后缀的 Markdown 是用户本地会话资料，已加入 `.gitignore`；不要删除、读取后外传或提交。
- `.env.local`、GitHub Secrets、Supabase service role、R2、MiMo、DeepSeek、TPNS 凭据以及 Android keystore 均不得读取后输出、写入日志或提交。

当前 GitHub Actions 通过记录：

- Pages：<https://github.com/shallower-yin/semester-schedule-pwa/actions/runs/29693486982>
- Supabase Functions：<https://github.com/shallower-yin/semester-schedule-pwa/actions/runs/29693557151>
- AI 权限冒烟：<https://github.com/shallower-yin/semester-schedule-pwa/actions/runs/29693638878>

注意：这些记录对应已部署提交，不代表后续本地改动已经上线。未经用户明确要求，不要推送或部署。

## 3. 产品与平台边界

这是同一套 React/TypeScript 产品源码的两个交付目标：

1. 浏览器 PWA：桌面、平板和手机 Edge/Chrome，可安装并离线启动。
2. Capacitor Android APK：打包本地 `dist` 资源，为后续原生通知、返回键、深链、后台服务和 APK 更新提供桥接。

不能把浏览器测试当作 APK 测试，也不能为 Android 单独复制一套业务 UI。平台差异应封装在适配层。

当前 Android 信息：

- Capacitor 8
- applicationId：`io.github.shalloweryin.semesterschedule`
- minSdk 24，targetSdk/compileSdk 36
- versionCode 4
- versionName `0.1.0-dev.4`
- 当前安装包仍是开发调试包，不是最终公开分发的 release 签名包。
- 已接入 `@capacitor/app`，`src/lib/nativeApp.ts` 处理 Android 返回键。
- TPNS、厂商离线通道、完整原生通知跳转、正式 APK 更新器和长期后台服务仍属于后续原生阶段，不要假装已经完成。

## 4. 技术架构

### 前端

- React 18、TypeScript、Vite、Vitest。
- `src/main.tsx`：启动入口。
- `src/App.tsx`：当前主应用编排、导航、同步和多数全局弹窗入口，体积较大，是后续拆分候选，但必须渐进处理。
- `src/components/`：页面与弹窗组件。
- `src/lib/`：日期、同步、AI、备份、通知、附件、原生桥接等业务模块。
- `src/styles.css`：全局样式体积较大，可按模块拆分，但需保持手机、平板、桌面布局一致。
- Dexie/IndexedDB：本地优先数据、离线编辑和同步队列。

### 云端

- Supabase Auth：邮箱密码注册、登录、找回密码。免密邮件链接入口已取消，不要重新加入，除非重新设计 APK/PWA 深链闭环。
- Supabase Database：结构化业务数据、权限、同步、AI 调用记录。
- Supabase Storage：需要持久管理的专注音频等媒体。
- Cloudflare R2：长音频等 AI 临时大文件；处理完成后应清理。
- Edge Functions：
  - `supabase/functions/ai-assistant/`
  - `supabase/functions/admin/`
  - `supabase/functions/send-reminders/`
  - `supabase/functions/app-hosting/`
- 数据库迁移位于 `supabase/migrations/`，必须幂等、向后兼容，并与 RPC 声明类型一致。新增迁移建议使用完整时间戳前缀（如 `20260720093000_xxx.sql`）保证字典序，不再依赖 `z_`/`zz_`/`zzz_` 后缀排序；已有旧迁移文件保持原名不变，避免破坏历史执行顺序。

### AI

- 支持 Xiaomi MiMo 和 DeepSeek。
- 普通 AI 功能必须服从服务端配置的默认模型、通道和 Token Plan。
- ASR 转写固定使用按量 API；转写后的总结尽量回到默认模型。
- 管理员 AI 不限额；普通用户和会员分别使用可配置的日/周额度。
- 所有 AI 功能保留文件选择器；电脑浏览器支持粘贴截图、图片，以及浏览器能从剪贴板提供的 PDF/文档/音频 File。
- 模型选择、配额和密钥必须由服务端权威控制，不能信任前端自报身份或额度。

## 5. 不可破坏的业务规则

- 时区策略为“跟随设备本地时区”（用户已确认）。用户可见的日期、相对时间、星期、课程周和提醒逻辑跟随设备时区：`src/lib/date.ts` 使用设备本地时间计算，事项/纪念日等表单保存 `Intl.DateTimeFormat().resolvedOptions().timeZone` 解析出的设备时区。出国跨时区时“今天/周数/提醒”会按新设备时区变化，属产品既定取舍，不视为缺陷。以下场景固定按 `Asia/Shanghai`，不随设备漂移（改动时勿误改）：中国法定节日与农历纪念日推算（`aiEventActions.ts`）、发布版本号日期（`vite.config.ts`）、AI 上下文时间戳（`deepSeekAssistant.ts`）。任一改动都用具体日期验证上述两类语义。
- 数据按用户隔离；RLS、同步查询和管理员接口不得串用户。
- 本地优先不等于只保存在本地：登录后需通过同步队列与 Supabase 双向同步。
- 云同步不能替代 JSON 迁移、误删恢复和故障备份；备份入口可以降低视觉优先级，但不能删除。
- 修改记录、健康活动与训练记录等误触风险操作应支持撤销或确认。
- 更新说明只能写面向用户的新增功能与体验优化，不能出现后台、密钥、权限或供应商内部配置。
- APK、PWA 可以并存；它们本地存储彼此独立，同一账号通过云同步共享业务数据。
- Android 更新必须保持 applicationId 和正式签名密钥不变，并递增 versionCode。

## 6. AI 长文件规则

### 扫描版和长 PDF

- 禁止写死 24、25、120 页等产品上限。
- 应按实际页数自适应分批提取、分段总结、分层生成脑图。
- 必须限制单次请求体和输出规模，避免一次请求消耗百万 Token。
- 模型 JSON 必须严格校验；不完整结果应可修复或从已保存分段恢复。
- 支持取消生成、失败保留附件、针对附件或脑图继续追问。
- 不能因一次生成失败丢失附件或已经完成的中间提取结果。

### 长音频

- 使用 R2 临时 URL 分片转写。
- 当前分片目标约 7 MB，但必须依据真实接口请求体、编码膨胀和超时余量验证，不能只改前端提示。
- 相关修改必须使用真实大文件测试；历史测试目录为 `E:\大三下课程\测控3\测控3机电+液压\测控3\录音`。
- 测试失败、超时或取消后应清理临时对象，同时保留可复用的已完成结果。

## 7. 本地开发环境

当前 Windows 环境：

- Node.js `v24.16.0`
- npm `11.13.0`
- Java：Android Studio JBR 21
- Android Studio/JBR：`D:\AndroidDev\AndroidStudio`
- Android SDK：`D:\AndroidDev\Sdk`
- Gradle 用户目录：`D:\AndroidDev\Gradle`

常用命令：

```powershell
cd D:\semester-schedule-pwa
npm.cmd install
npm.cmd run test
npm.cmd run build
npm.cmd run android:sync

$env:JAVA_HOME='D:\AndroidDev\AndroidStudio\jbr'
$env:ANDROID_HOME='D:\AndroidDev\Sdk'
$env:ANDROID_SDK_ROOT='D:\AndroidDev\Sdk'
$env:GRADLE_USER_HOME='D:\AndroidDev\Gradle'
cd android
.\gradlew.bat testDebugUnitTest assembleDebug --no-daemon --console=plain
```

不要把这些本机路径写进面向所有开发者的构建逻辑；它们只用于本机执行说明。

## 8. 2026-07-20 英文路径迁移验证

工作区从 `D:\轻量版日程` 改为 `D:\semester-schedule-pwa` 后，已删除：

- `android.overridePathCheck=true`
- Windows Gradle wrapper 中的 `-Dfile.encoding=GBK`

验证结果：

- Vitest：72 个测试文件、252 项测试全部通过。
- PWA 生产构建：通过。
- Android 模式 Vite 构建与 Capacitor sync：通过。
- Gradle `testDebugUnitTest assembleDebug`：`BUILD SUCCESSFUL`。
- Android 示例单测：1 项通过，0 failure，0 error。
- APK：`android/app/build/outputs/apk/debug/app-debug.apk`
- APK SHA-256：`11B685BBB5D02F94BBF284395A1662F85E247EB51C68A8AC65C557170D3C683D`
- APK 使用 v2 签名验证通过，签名证书与此前开发包一致。

当前构建警告：

- Vite 有两个约 500 KB 的主代码块，建议通过路由/功能级动态导入降低首屏体积。
- Gradle 提示 `flatDir` 不支持依赖元数据，目前不阻塞构建。
- GitHub Actions 中 `supabase/setup-cli@v1` 曾出现 Node 20 弃用提示，后续应跟踪官方 action 更新。

## 9. Claude 优化建议顺序

### 第一阶段：只审查，不改行为

1. 运行 `git status --short`，保留用户现有改动。
2. 建立模块依赖图，识别 `App.tsx`、`styles.css`、AI 助手和同步链路的高耦合点。
3. 记录性能、可测试性、类型安全、重复逻辑和文档不一致问题。
4. 给每项建议标明风险、收益、影响平台和验证方式，先让用户确认大范围重构。

### 第二阶段：低风险优化

1. 修正文档与实际功能不一致。
2. 抽取重复纯函数并补测试。
3. 对 PDF、思维导图、音频转写等重量功能使用动态导入，降低首屏包体。
4. 清理仅由生成器产生且可安全重建的缓存，不删除用户数据或附件。
5. 改进错误边界、取消状态、重试状态和可观测诊断，不向用户暴露内部凭据或路由。

### 第三阶段：需要专项测试的优化

1. 拆分 `App.tsx` 全局状态与弹窗编排。
2. 拆分 `styles.css`，同时验证 327px 手机、390px 手机、平板和 1440px 桌面。
3. 优化 Dexie/Supabase 同步事务、冲突处理和离线恢复。
4. 强化长 PDF 分段恢复、脑图 JSON 校验、长音频真实大文件流程。
5. 建立 Android 平台适配层，为 TPNS、通知深链、前台服务和 APK 更新做准备。

## 10. 每次改动的最低验证

普通逻辑改动：

```powershell
npm.cmd run test -- <受影响测试文件>
npm.cmd run test
npm.cmd run build
```

UI 改动还必须：

- 使用真实浏览器检查桌面和手机视口。
- 检查按钮触控尺寸、中文换行、弹窗边界、键盘遮挡、滚动和横向溢出。
- Android 相关行为必须在真实 APK/设备上验证，不能只看 Chrome 模拟器。

发布时还必须：

1. 同步更新版本号和 `release-notes.json`。
2. 更新说明只写用户可见功能和体验优化。
3. 推送后等待 GitHub Pages、Supabase Functions 和对应专项冒烟测试全部成功。
4. 验证线上版本、Service Worker 更新、后端响应和实际用户流程。
5. 任一流水线失败、取消或仍在运行时，不得声称部署完成。

## 11. 当前优先风险清单

1. APK 仍为开发调试阶段，正式 release keystore、升级链路和网页分发页尚未完成。
2. TPNS/厂商离线通知和通知点击深链仍需原生实现与多设备测试。
3. 长扫描 PDF 与长音频必须继续用真实大文件验证，不能由小样本替代。
4. `App.tsx` 与全局样式体积较大，重构容易引发跨端布局和状态回归。
5. PWA 与 APK 本地数据隔离，登录、退出、同步冲突和重复通知需要联测。
6. 备份、误删恢复和离线同步属于数据安全能力，优化时不能删除。
7. 生产包存在大 chunk 警告，性能优化应优先采用懒加载，而不是改变核心数据结构。

交接原则：先建立基线、再小步修改、每步测试、最后再决定是否发布。

## 12. 2026-07-20 优化落地记录（Claude 第二/三阶段）

本轮全部在本地提交、未推送、未部署；每步均跑受影响测试 + 全量测试（当前 74 文件 / 262 项）+ 生产构建。

### 第二阶段（低风险，已完成）

- F1 云端下载分页 + 镜像删除保险丝（`sync.ts`；新增 `syncDownload.test.ts`）。
- F2 重量弹窗 `React.lazy` 懒加载 + 抽出 `lucide-react` 独立 chunk，首屏 chunk 由约 500KB 降至约 323KB，构建告警消除；`mammoth`/`pdf` 保持按需加载，`chunkSizeWarningLimit` 调为 600。
- F3 `main.tsx` 启动兜底：`initializeDatabase` 失败时渲染带重试和错误详情的降级页（含 `env(safe-area-inset-top)`），不再白屏。
- F5 文档漂移：帮助页补键盘快捷键 FAQ；README 删除已不存在的备忘录“回收站”条目、补 `M`（思维导图）快捷键。经核实备忘录删除确为彻底删除，帮助页“彻底删除”文案正确、未改。
- F4 时区策略：确认核心 `date.ts` 与表单记录均跟随设备时区；`Asia/Shanghai` 仅保留在中国节日/农历、发布版本号、AI 上下文时间戳等本就应锁北京时间处。仅文档说明，未改逻辑。
- F8 迁移命名：新迁移改用完整时间戳前缀，不再新增 `z_`/`zz_` 后缀；旧文件不动。

### 安卓边到边安全区（一加顶部撞状态栏，已修）

- 根因：`targetSdk 36` 下 Android 15 强制 edge-to-edge，部分机型（如一加 ColorOS）WebView 画到状态栏之下，而 WebView 对 `env(safe-area-inset-top)` 不可靠。
- 方案：`MainActivity.java` 显式开启 edge-to-edge，并把真实 `systemBars()+displayCutout()` insets 作为 `--android-safe-top/right/bottom/left` 注入 WebView；`styles.css` 用 `--safe-top/--safe-bottom = max(env(...), var(--android-...))` 驱动头部与底部导航。浏览器/非边到边机型解析为 0，不受影响。已在 API 36 模拟器用 CDP 验证注入链路。

### 专注“系统小窗”跨端（APK 原生悬浮窗，已实现并验证）

- 浏览器/PWA：保留原有 `<video>` 画中画（`focusPictureInPicture.ts`）。
- APK：新增原生 Capacitor 插件 `FocusOverlayPlugin.java`（`SYSTEM_ALERT_WINDOW`，`TYPE_APPLICATION_OVERLAY`，可拖动、点按拉起应用、自走秒），在 `MainActivity` 用 `registerPlugin` 注册。
- 适配层 `src/lib/focusSystemWindow.ts`：由 `isNativeApp()` 路由，浏览器走画中画、APK 走原生悬浮窗；同一 `ActiveFocusState` 驱动，`FocusPage`/`FocusFloatingTimer` 不感知平台。权限仅在用户点按“系统小窗”时申请（interactive），后台自动打开未授权则静默跳过。新增 `focusSystemWindow.test.ts`。
- 修复：`FocusFloatingTimer` 空闲时每秒调用 close，浏览器无害但原生会每秒发 `hide()` IPC 并误关悬浮窗；改为仅在会话结束时关闭。
- 验证：API 36 模拟器 + CDP 直接调用插件 + `dumpsys window` 确认：插件已注册、权限桥 `granted`、`show()` 生成归属本应用的 `ty=APPLICATION_OVERLAY` 窗口（`mHasSurface=true`、frame 约 525x260px）、持续存在无 hide 抖动、`hide()` 干净移除。

### 本机安卓验证环境

- `D:AndroidDev`：Android Studio/JBR、SDK（platform-tools/emulator/build-tools/platform-36）、Gradle 用户目录；SDK/AVD/用户目录均落 D 盘。
- 已建 AVD `sched_api36`（API 36 google_apis x86_64，已装 emulator 与系统镜像）。
- WebView 调试：`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`，Node 全局 `WebSocket` 走 CDP `Runtime.evaluate`。

### 第三阶段进展与判断（2026-07-20 续）

- F6（起步，已提交 `4dc07ae`）：全局键盘快捷键从 `App.tsx` 抽到 `src/lib/useGlobalShortcuts.ts`（用 ref 保存 handler，监听注册一次、始终调用最新闭包），并首次为快捷键补单测（键位映射、输入框内抑制且 Esc 仍生效、卸载清理）。行为不变。
- F6 剩余（把尾部弹窗编排抽成 `AppDialogs`）：约 230 行、约 40 个 props，TypeScript 只能挡类型不匹配，挡不住同为 `() => void` 的 onClose 误接，且无 App 级集成测试；宜有人值守用运行态逐个弹窗核验，本轮未做。
- F7（评估后暂缓）：`styles.css` 全文 9768 行几乎无分节注释、无 `url()`/`@import`。连续切分无逻辑边界、收益近零；按页面前缀切分需把规则移出共享 `@media` 块，可能改动同优先级级联，且无法在无人值守下对全部页面 × 6 皮肤 × 弹窗 × 断点证明无回归。按交接红线（重构不得引发跨端回归）暂缓，待有人值守用 Chrome+CDP 四视口逐页截图对比再做。

### APK 构建校验（本轮已完成）

- 本轮新增原生 `FocusOverlayPlugin.java`、`MainActivity` insets、清单 `SYSTEM_ALERT_WINDOW` 后，跑 `npm run android:sync` + `gradlew testDebugUnitTest assembleDebug --no-daemon --console=plain` → `BUILD SUCCESSFUL`，产出 `app-debug.apk`（约 6.0MB），安卓单测通过。构建产物（`dist/`、`android/**/build/`）均已 gitignore，工作区保持干净。

### 仍需你本人确认/提供资源的事项

- 一加真机（ColorOS）验安全区修复与专注原生悬浮窗：模拟器是 AOSP，证不了 ColorOS 皮肤专属行为；请在你的一加上装最新调试包，核验顶部不再撞状态栏、专注“系统小窗”能弹出并可拖动、点按能拉起应用。
- 长音频/长扫描 PDF 强化：交接明确禁止用小样本验收，需真实大文件（历史目录 `E:...录音`）与真实额度，宜有人值守。
- 同步冲突/离线恢复优化属数据安全能力，改动需你在场评估。

### 仓库编辑注意（CRLF 混排）

- `styles.css`、`vite.config.ts` 等文件为 CRLF/LF 混排（`core.autocrlf=true`）。按 LF 精确匹配的替换工具会失败；可靠做法：Node 读入 → `replace(/
/g,"
")` → `indexOf` 定位并断言唯一 → 写回；提交时 git 归一化为 LF，diff 干净。
