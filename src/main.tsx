import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { FocusAudioProvider } from "./components/FocusAudioProvider";
import { initializeDatabase } from "./db";
import { initializeAppFontSize } from "./lib/fontSizes";
import { initializeNativeAppBridge } from "./lib/nativeApp";
import "./styles.css";

async function startApp() {
  initializeAppFontSize();
  await initializeDatabase();
  await initializeNativeAppBridge();
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <FocusAudioProvider>
        <App />
      </FocusAudioProvider>
    </React.StrictMode>
  );
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
  desc.textContent =
    "本地存储初始化失败，通常是浏览器处于无痕/隐私模式、禁用了本地存储，或设备存储空间不足。请调整后重试；已同步到云端的数据不会丢失。";
  desc.style.cssText = "margin:0;max-width:440px;line-height:1.7;color:#697386;font-size:14px;";

  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "重新加载";
  button.style.cssText =
    "border:0;border-radius:10px;padding:10px 24px;font-size:15px;font-weight:600;color:#fff;background:#3157d5;cursor:pointer;";
  button.addEventListener("click", () => window.location.reload());

  const info = document.createElement("details");
  info.style.cssText = "max-width:440px;color:#98a1b3;font-size:12px;";
  const summary = document.createElement("summary");
  summary.textContent = "错误详情";
  summary.style.cssText = "cursor:pointer;";
  const pre = document.createElement("pre");
  pre.textContent = detail;
  pre.style.cssText = "margin:8px 0 0;white-space:pre-wrap;word-break:break-word;text-align:left;";
  info.append(summary, pre);

  wrap.append(title, desc, button, info);
  root.append(wrap);
}

startApp().catch(renderStartupError);
