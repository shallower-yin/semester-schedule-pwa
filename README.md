# 日程计划表

面向 Android Chrome、Windows Edge/Chrome 和普通网页浏览器的响应式 PWA。数据优先保存在浏览器 IndexedDB 中，登录后通过 Supabase 在设备间同步。

## 在线使用

[打开日程计划表](https://shallower-yin.github.io/semester-schedule-pwa/)

在 Android Chrome 或 Windows Edge/Chrome 打开后，可通过“设置 → 安装到设备”或浏览器菜单安装。Windows 安装后一定会出现在开始菜单，但浏览器不一定自动创建桌面图标；应用内安装引导说明了手动创建快捷方式的方法。

## 已实现

- 学期名称、开学日期、总周数和当前周计算
- 周一至周日分别自定义任意数量的课程节次和休息时段
- 桌面七日课表与手机单日课表
- 日期显示在星期上方，今日高亮
- 统一左侧时间轴和可安排事项的午休时段
- 课程与临时事项统一在“日程”入口管理
- 课程、教师、教室、颜色、备注
- 一门课程多个上课安排
- 任意周数数组、连续周全选和单独选择
- 指定日期停课
- 普通事项、全天事项和每周重复
- 分类颜色、文字和图标
- 事项按每次出现独立标记完成
- 软删除、版本和设备 ID
- 本地同步队列
- JSON 导入与导出
- PWA 离线缓存与更新提示
- Vitest 日期、周数和重复规则测试
- Supabase 邮箱密码、魔法链接和找回密码
- PostgreSQL RLS、多设备同步和最后修改者生效
- 可选事项提醒、应用内系统通知和后台 Web Push
- 应用内 PWA 安装入口，可创建桌面或主屏幕图标

## 本地运行

需要 Node.js 20 或更高版本。

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

## 初次使用

1. 创建学期，开学日期填写第一教学周的星期一。
2. 在“设置 → 每日时间块设置”中分别调整周一至周日作息，可增删节次、午休和其他休息。
3. 在“日程 → 新增日程”中选择课程或临时事项。
4. 在日程空白处点击，可按对应时段创建临时事项。
5. 在“设置 → JSON 数据备份”中导出备份。

## Supabase

数据库结构位于 `supabase/schema.sql`，配置及首次账号测试见 [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)。
数据库升级脚本按文件名顺序位于 `supabase/migrations/`。提醒机制说明见 [docs/REMINDERS.md](docs/REMINDERS.md)。

## 当前边界

- PWA 不能保证浏览器完全关闭后继续后台同步；同步时机将设为启动、恢复前台、网络恢复和手动同步。
- 左侧显示统一参考时间；每日自定义时间显示在课程卡片中。

详细的网络测试步骤见 [docs/NETWORK_TEST.md](docs/NETWORK_TEST.md)。

如果关闭代理后无法使用 Codex，可先关闭代理，再双击 `测试Supabase直连.cmd`。测试结束后重新开启代理，将生成的 `supabase-connectivity-result.txt` 发给 Codex。
