import { CheckCircle2, Clipboard, Download, Home, LogIn, Menu, Monitor, Search, Smartphone } from "lucide-react";
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
        <section className="install-overview">
          <div>
            <Download size={19} />
            <span>安装应用</span>
          </div>
          <div>
            <Home size={19} />
            <span>桌面打开</span>
          </div>
          <div>
            <LogIn size={19} />
            <span>登录同步</span>
          </div>
        </section>

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

        <div className="install-platform-grid">
          <section className="install-platform">
            <header>
              <Monitor size={22} />
              <div>
                <h3>Windows Edge / Chrome</h3>
                <p>适合电脑常用，安装后像普通应用一样打开。</p>
              </div>
            </header>
            <div className="install-steps">
              <article><span>1</span><Menu size={17} /><p>打开浏览器右上角菜单。</p></article>
              <article><span>2</span><Download size={17} /><p>选择“应用 / 安装此站点作为应用”。</p></article>
              <article><span>3</span><Search size={17} /><p>在开始菜单搜索“日程计划表”。</p></article>
              <article><span>4</span><Home size={17} /><p>需要桌面图标时，在 <code>edge://apps</code> 或 <code>chrome://apps</code> 创建快捷方式。</p></article>
            </div>
          </section>

          <section className="install-platform">
            <header>
              <Smartphone size={22} />
              <div>
                <h3>Android Edge / Chrome</h3>
                <p>适合手机主屏幕使用，提醒和同步更顺手。</p>
              </div>
            </header>
            <div className="install-steps">
              <article><span>1</span><Menu size={17} /><p>用 Edge 或 Chrome 普通窗口打开应用。</p></article>
              <article><span>2</span><Download size={17} /><p>点击菜单里的“安装应用”或“添加到主屏幕”。</p></article>
              <article><span>3</span><Home size={17} /><p>安装后从手机桌面打开“日程计划表”。</p></article>
              <article><span>4</span><LogIn size={17} /><p>登录同一账号，让手机和电脑同步。</p></article>
            </div>
          </section>
        </div>

        <button className="button secondary" onClick={() => void copyAddress()}>
          <Clipboard size={17} />{copied ? "网址已复制" : "复制应用网址"}
        </button>
      </div>
    </Modal>
  );
}
