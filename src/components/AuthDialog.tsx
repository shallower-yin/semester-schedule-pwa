import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { Modal } from "./Modal";

type AuthMode = "login" | "otp" | "register" | "forgot" | "recovery";

const OTP_RESEND_SECONDS = 60;

interface AuthDialogProps {
  initialMode?: AuthMode;
  onClose: () => void;
}

export function AuthDialog({ initialMode = "login", onClose }: AuthDialogProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [resendSeconds, setResendSeconds] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const appUrl = new URL(import.meta.env.BASE_URL, window.location.origin).toString();

  useEffect(() => {
    if (resendSeconds <= 0) return;
    const timeout = window.setTimeout(() => {
      setResendSeconds((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearTimeout(timeout);
  }, [resendSeconds]);

  function showMessage(text: string, error = false) {
    setMessage(text);
    setIsError(error);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return showMessage("云端服务尚未配置。", true);
    if ((mode === "register" || mode === "recovery") && password !== confirmPassword) {
      return showMessage("两次输入的密码不一致。", true);
    }
    setBusy(true);
    showMessage("");
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        onClose();
      } else if (mode === "otp") {
        const { error } = await supabase.auth.verifyOtp({
          email: email.trim(),
          token: otp.trim(),
          type: "email"
        });
        if (error) throw error;
        onClose();
      } else if (mode === "register") {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: appUrl }
        });
        if (error) throw error;
        if (data.session) {
          onClose();
        } else {
          showMessage("注册成功。请打开验证邮件完成邮箱确认，然后返回应用登录。");
        }
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${appUrl}?password-recovery=1`
        });
        if (error) throw error;
        showMessage("重置密码邮件已发送，请检查收件箱。");
      } else {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        showMessage("密码已更新，可以继续使用。");
        window.setTimeout(onClose, 800);
      }
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "操作失败，请稍后重试。", true);
    } finally {
      setBusy(false);
    }
  }

  async function sendEmailOtp() {
    if (!supabase || !email.trim()) return showMessage("请先填写邮箱地址。", true);
    setBusy(true);
    showMessage("");
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: false }
      });
      if (error) throw error;
      setOtp("");
      setMode("otp");
      setResendSeconds(OTP_RESEND_SECONDS);
      showMessage("登录验证码已发送，请在当前应用中输入邮件里的验证码。");
    } catch (error) {
      showMessage(error instanceof Error ? error.message : "发送失败。", true);
    } finally {
      setBusy(false);
    }
  }

  const title =
    mode === "otp" ? "邮箱验证码登录" :
    mode === "register" ? "注册账号" :
    mode === "forgot" ? "找回密码" :
    mode === "recovery" ? "设置新密码" :
    "登录";

  return (
    <Modal title={title} onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        {mode !== "recovery" && (
          <label>
            邮箱
            <input
              required
              type="email"
              autoComplete="email"
              readOnly={mode === "otp"}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        )}
        {(mode === "login" || mode === "register" || mode === "recovery") && (
          <label>
            {mode === "recovery" ? "新密码" : "密码"}
            <input required minLength={6} type="password" autoComplete={mode === "login" ? "current-password" : "new-password"} value={password} onChange={(event) => setPassword(event.target.value)} />
          </label>
        )}
        {mode === "otp" && (
          <label>
            邮箱验证码
            <input
              required
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label="邮箱验证码"
              aria-describedby="email-otp-help"
              value={otp}
              onChange={(event) => setOtp(event.target.value.replace(/\s/g, ""))}
            />
            <small id="email-otp-help">请回到这里输入邮件中的验证码，不需要打开登录网页。</small>
          </label>
        )}
        {(mode === "register" || mode === "recovery") && (
          <label>
            确认密码
            <input required minLength={6} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />
          </label>
        )}
        {message && <p className={`auth-message ${isError ? "error" : ""}`}>{message}</p>}
        <button className="button primary" disabled={busy}>{busy ? "处理中…" : mode === "otp" ? "验证并登录" : title}</button>

        {mode === "login" && (
          <>
            <button type="button" className="button secondary" disabled={busy} onClick={sendEmailOtp}>邮箱验证码登录</button>
            <div className="auth-links">
              <button type="button" onClick={() => { setMode("register"); showMessage(""); }}>注册账号</button>
              <button type="button" onClick={() => { setMode("forgot"); showMessage(""); }}>忘记密码</button>
            </div>
          </>
        )}
        {mode === "otp" && (
          <>
            <button type="button" className="button secondary" disabled={busy || resendSeconds > 0} onClick={sendEmailOtp}>
              {resendSeconds > 0 ? `重新发送验证码（${resendSeconds} 秒）` : "重新发送验证码"}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => {
                setMode("login");
                setOtp("");
                setResendSeconds(0);
                showMessage("");
              }}
            >
              更换邮箱或使用密码登录
            </button>
          </>
        )}
        {(mode === "register" || mode === "forgot") && (
          <button type="button" className="text-button" onClick={() => { setMode("login"); showMessage(""); }}>返回登录</button>
        )}
      </form>
    </Modal>
  );
}
