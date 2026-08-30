import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { FocusAudioProvider } from "./components/FocusAudioProvider";
import { db, initializeDatabase } from "./db";
import { clearAppCachesAndReload } from "./lib/appBootRecovery";
import { withTimeout } from "./lib/asyncTimeout";
import { initializeAppFontSize } from "./lib/fontSizes";
import { initializeNativeAppBridge } from "./lib/nativeApp";
import { getCurrentUserId } from "./lib/identity";
import "./styles.css";

async function startApp() {
  initializeAppFontSize();
  await withTimeout(
    initializeDatabase(getCurrentUserId()),
    10_000,
    "本地数据库打开超时。请关闭其他仍在运行的日程计划表标签页后重试。"
  );
  await withTimeout(initializeNativeAppBridge(), 5_000, "平台功能初始化超时。");
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <FocusAudioProvider>
        <AppReady />
        <App />
      </FocusAudioProvider>
    </React.StrictMode>
  );
}

function AppReady() {
  useEffect(() => {
    document.documentElement.dataset.appReady = "true";
    return () => {
      delete document.documentElement.dataset.appReady;
    };
  }, []);
  return null;
}

function renderStartupError(error: unknown): void {
  const root = document.getElementById("root");
  if (!root) return;
  const detail = error instanceof Error ? error.message : String(error);
  root.replaceChildren();

  const wrap = document.createElement("div");
  wrap.setAttribute("role", "alert");
  wrap.style.cssText =
    "min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:calc(env(safe-area-inset-top, 0px) + 32px) 32px 32px;box-sizing:border-box;font-family:'PingFang SC','Microsoft YaHei',system-ui,sans-serif;background:#f5f7fb;color:#172033;text-align:center;";

  const title = document.createElement("h1");
  title.textContent = "应用暂时无法启动";
  title.style.cssText = "margin:0;font-size:20px;";

  const desc = document.createElement("p");
  const databaseBlocked = detail.includes("数据库打开超时");
  desc.textContent = databaseBlocked
    ? "本地数据库可能正被另一个旧版本标签页占用。请关闭其他日程计划表标签页后重试；下面的操作不会删除本地数据库。"
    : "本地存储初始化失败，通常是浏览器处于无痕/隐私模式、禁用了本地存储，或设备存储空间不足。请调整后重试；已同步到云端的数据不会丢失。";
  desc.style.cssText = "margin:0;max-width:440px;line-height:1.7;color:#697386;font-size:14px;";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "重新加载";
  button.style.cssText =
    "border:0;border-radius:10px;padding:10px 24px;font-size:15px;font-weight:600;color:#fff;background:#3157d5;cursor:pointer;";
  button.addEventListener("click", () => window.location.reload());

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.textContent = "清缓存重载";
  clearButton.style.cssText =
    "border:1px solid #cfd6e5;border-radius:10px;padding:10px 24px;font-size:15px;font-weight:600;color:#3157d5;background:#fff;cursor:pointer;";
  clearButton.addEventListener("click", () => {
    db.close();
    void clearAppCachesAndReload("boot");
  });

  const actions = document.createElement("div");
  actions.style.cssText = "display:flex;flex-wrap:wrap;justify-content:center;gap:10px;";
  actions.append(button, clearButton);

  const info = document.createElement("details");
  info.style.cssText = "max-width:440px;color:#98a1b3;font-size:12px;";
  const summary = document.createElement("summary");
  summary.textContent = "错误详情";
  summary.style.cssText = "cursor:pointer;";
  const pre = document.createElement("pre");
  pre.textContent = detail;
  pre.style.cssText = "margin:8px 0 0;white-space:pre-wrap;word-break:break-word;text-align:left;";
  info.append(summary, pre);

  wrap.append(title, desc, actions, info);
  root.append(wrap);
}

startApp().catch(renderStartupError);
