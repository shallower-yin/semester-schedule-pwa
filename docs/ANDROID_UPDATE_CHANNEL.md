# Android 更新分发

## 通道

- 主清单：`https://schedule.nfsg.eu.cc/android/latest.json`。
- 主安装包：`https://schedule.nfsg.eu.cc/android/semester-schedule-v{versionCode}.apk`，直接由 Cloudflare 静态资产返回。
- 兼容备用：既有 Supabase `app-hosting/release.json` 和 APK 路径，继续服务旧客户端。
- 新客户端不把 APK 内置 `release.json` 当作远端检查结果。远端都失败时提示检查失败。

2026-10-24 已通过问题手机的中国移动流量验证主站 APK 37 清单和文件可达。这不替代新版本的真机版本检查、下载、断网恢复与覆盖安装验收。

## 发布顺序

1. 更新 Android 版本码及版本名，沿用包名、固定签名和 SHA-256 校验。最终发布提交同时包含用户可见更新说明。
2. 现有 APK workflow 构建、验签并发布 Supabase 兼容通道。此流程不部署网页或后端。
3. 手动运行 Cloudflare workflow，`apk_version_code` 填已通过校验的新版本码。该流程构建网页并保留旧静态清单和旧 APK。
4. `static-android-channel.mjs prepare` 校验待发布 APK 的 SHA，新增版本化文件及候选清单，不改变当前 `latest.json`。
5. 首次部署后，`promote` 从公网下载新 APK，核对 SHA、长度及带强 ETag 的 Range 响应；通过才在本地切换 `latest.json`。
6. 第二次部署发布新清单，检查线上版本、`Cache-Control: no-store` 和 CORS。保留当前与上一 APK。

单独部署网页时，留空 `apk_version_code`；流程下载并保留已有静态更新清单及当前、上一 APK，避免构建清理目录造成更新地址丢失。静态站同时承载英阶的独立更新路由；部署使用仓库的完整 Wrangler 配置及 Worker，不得改成仅资产配置覆盖现有路由。

## 客户端与过渡

下载地址列表中的每个来源最多尝试两次。部分文件按预期 SHA 和来源隔离；仅使用强 ETag 续传，验证 Content-Range、起始偏移和总长度。返回 200 时覆盖重下，避免拼接旧内容。下载后再次核 SHA，并核对包名、固定签名和严格递增的版本码后才打开安装器。

旧客户端只认识 Supabase。若其所在网络完全无法连接该入口，需要通过 Wi-Fi 升级一次，或从已验证可达的静态地址下载新 APK 覆盖安装；不卸载已有应用。
