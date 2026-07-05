import { CheckCircle2, Clipboard, Download, Monitor, Smartphone } from "lucide-react";
import { useState } from "react";
import { Modal } from "./Modal";

interface InstallDialogProps {
  installed: boolean;
  promptAvailable: boolean;
  message: string;
  installing: boolean;
  onInstall: () => Promise<void>;
  onClose: () => void;
}

export function InstallDialog({
  installed,
  promptAvailable,
  message,
  installing,
  onInstall,
  onClose
}: InstallDialogProps) {
  const [copied, setCopied] = useState(false);

  async function copyAddress() {
    try {
      await navigator.clipboard.writeText("https://shallower-yin.github.io/semester-schedule-pwa/");
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <Modal title="安装日程计划表" onClose={onClose}>
      <div className="install-guide">
        {installed && (
          <div className="install-result success">
            <CheckCircle2 size={20} />
            <span>当前窗口已作为应用运行。</span>
          </div>
        )}
        {message && <div className="install-result"><span>{message}</span></div>}
        {promptAvailable && !installed && (
          <button className="button primary install-primary-button" disabled={installing} onClick={() => void onInstall()}>
            <Download size={18} />{installing ? "正在打开安装窗口…" : "立即安装"}
          </button>
        )}
        {!promptAvailable && !installed && (
          <p className="install-note">
            当前浏览器没有提供自动安装窗口，通常是因为使用了无痕/内置浏览器、之前取消过安装，或浏览器认为应用已经安装。
          </p>
        )}

        <section className="install-platform">
          <Monitor size={22} />
          <div>
            <h3>Windows Edge / Chrome</h3>
            <ol>
              <li>必须用普通窗口打开，不能使用无痕窗口或微信等内置浏览器。</li>
              <li>点击浏览器右上角菜单，选择“应用 → 安装此站点作为应用”或“安装日程计划表”。</li>
              <li>安装后先在 Windows 开始菜单搜索“日程计划表”。</li>
              <li>如果没有桌面图标：在地址栏打开 <code>edge://apps</code> 或 <code>chrome://apps</code>，进入应用详情并创建桌面快捷方式。</li>
            </ol>
          </div>
        </section>

        <section className="install-platform">
          <Smartphone size={22} />
          <div>
            <h3>Android Chrome</h3>
            <ol>
              <li>点击 Chrome 右上角三个点。</li>
              <li>选择“安装应用”或“添加到主屏幕”。</li>
              <li>确认后从手机桌面打开“日程计划表”。</li>
            </ol>
          </div>
        </section>

        <button className="button secondary" onClick={() => void copyAddress()}>
          <Clipboard size={17} />{copied ? "网址已复制" : "复制应用网址"}
        </button>
      </div>
    </Modal>
  );
}
