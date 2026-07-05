# 日程提醒

事项可以选择不提醒，或在开始时、提前 5/10/15/30/60 分钟、提前 1 天提醒。

## 两层提醒

1. 应用打开或恢复到前台时，每 30 秒检查本地 IndexedDB，并通过 Service Worker 显示系统通知。
2. 应用完全关闭时，GitHub Actions 每 5 分钟调用受令牌保护的 Supabase RPC，使用 Web Push 向已订阅设备发送通知。

后台调度受 GitHub Actions、浏览器推送服务、操作系统省电策略和网络影响，不承诺秒级准时。

## 用户要求

- 必须通过 HTTPS 在线地址使用。
- 每台手机或电脑都要登录同一账号。
- 首次打开事项提醒时，需要由用户点击允许通知。
- Android 应使用 Chrome，Windows 应使用 Edge 或 Chrome。
- 浏览器无痕模式、清除站点数据或退出登录会移除当前设备的推送订阅，需要重新允许。

## 安全

- VAPID 私钥和提醒调度令牌只保存在 GitHub Actions Secrets。
- 后台任务使用 Supabase Legacy `anon` key 调用受令牌保护的 RPC；该 key 仅保存在 GitHub Actions Secret `SUPABASE_ANON_KEY`。
- 浏览器只获得 VAPID 公钥和 Supabase Publishable key。
- 推送订阅表启用 RLS，用户只能管理自己的订阅。
- 调度 RPC 仅接受 SHA-256 哈希校验通过的随机令牌。
