import { Copy, Download, ImagePlus, KeyRound, LockKeyhole, Pencil, Plus, RefreshCw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { exportText } from "../lib/fileExport";
import { getCurrentUserId } from "../lib/identity";
import { OtpVault, type OtpAccount } from "../lib/otpVault";
import { showToast } from "../lib/toast";
import { generateTotp, parseOtpUri, validateOtpParameters, type OtpParameters } from "../lib/totp";
import { Modal } from "./Modal";

interface OtpDialogProps { ownerId: string; onClose: () => void; onSignIn: () => void }
const reason = (error: unknown) => error instanceof Error ? error.message : "操作失败，请重试。";

export function OtpDialog({ ownerId, onClose, onSignIn }: OtpDialogProps) {
  const vault = useMemo(() => new OtpVault(ownerId), [ownerId]);
  const epoch = useRef(0);
  const syncOperation = useRef<symbol | null>(null);
  const lastActivity = useRef(Date.now());
  const backupInput = useRef<HTMLInputElement>(null);
  const qrInput = useRef<HTMLInputElement>(null);
  const qrRevision = useRef(0);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [exists, setExists] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pending, setPending] = useState(false);
  const [accounts, setAccounts] = useState<OtpAccount[]>([]);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState("");
  const [syncError, setSyncError] = useState("");
  const [notice, setNotice] = useState("");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<OtpAccount | null | undefined>();
  const [backup, setBackup] = useState("");
  const [backupPassword, setBackupPassword] = useState("");
  const [now, setNow] = useState(Date.now());
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [qrFile, setQrFile] = useState<File | null>(null);
  const [qrParameters, setQrParameters] = useState<OtpParameters | null>(null);

  const refresh = useCallback(() => {
    setExists(vault.exists);
    setUnlocked(vault.unlocked);
    setPending(vault.pending);
    setAccounts(vault.accounts);
  }, [vault]);
  const lock = useCallback(() => {
    epoch.current += 1;
    vault.lock();
    syncOperation.current = null;
    setUnlocked(false); setAccounts([]); setCodes({});
    setPassword(""); setConfirmation(""); setBackupPassword(""); setBackup("");
    setDraft(undefined); setQuery(""); setBusy(false); setSyncing(false); setLoading(false); setError(ready ? "" : "读取已中断，请重新读取。"); setNotice("");
    setSyncError("");
    setQrFile(null); setQrParameters(null);
  }, [ready, vault]);
  const load = useCallback(async () => {
    if (ownerId === "local") { setLoading(false); return; }
    const current = ++epoch.current;
    setLoading(true); setError(""); setReady(false);
    try {
      const result = await vault.load();
      if (current !== epoch.current) return;
      setExists(result.exists); setPending(vault.pending); setReady(true);
      if (result.offline) setNotice("暂时无法同步，可解锁本机已保存的数据。");
    } catch (error) { if (current === epoch.current) setError(reason(error)); }
    finally { if (current === epoch.current) setLoading(false); }
  }, [ownerId, vault]);
  useEffect(() => {
    void load();
    return () => { epoch.current += 1; vault.lock(); };
  }, [load, vault]);
  useEffect(() => {
    const visibility = () => { if (document.visibilityState === "hidden") lock(); };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, [lock]);

  const sync = useCallback(async () => {
    if (!vault.unlocked || syncOperation.current) return;
    const operation = Symbol();
    const current = epoch.current;
    syncOperation.current = operation;
    setSyncing(true);
    try {
      const result = await vault.sync();
      if (current !== epoch.current) return;
      refresh(); setSyncError("");
      setNotice(result.conflicts ? "发现并发修改，已保留不同版本；请检查标记为“同步副本”的账号。" : "");
    } catch (error) { if (current === epoch.current) { refresh(); setSyncError(reason(error)); } }
    finally {
      if (syncOperation.current === operation) syncOperation.current = null;
      if (current === epoch.current) setSyncing(false);
    }
  }, [refresh, vault]);
  useEffect(() => {
    if (!unlocked) return;
    lastActivity.current = Date.now();
    const activity = () => { lastActivity.current = Date.now(); };
    const timer = window.setInterval(() => {
      if (Date.now() - lastActivity.current >= 5 * 60_000) lock();
      else setNow(Date.now());
    }, 1000);
    const syncTimer = window.setInterval(() => void sync(), 60_000);
    document.addEventListener("pointerdown", activity);
    document.addEventListener("keydown", activity);
    window.addEventListener("online", sync);
    return () => {
      window.clearInterval(timer); window.clearInterval(syncTimer);
      document.removeEventListener("pointerdown", activity);
      document.removeEventListener("keydown", activity);
      window.removeEventListener("online", sync);
    };
  }, [lock, sync, unlocked]);

  const periodKey = accounts.map(account => `${account.id}:${Math.floor(now / 1000 / account.period)}`).join("|");
  useEffect(() => {
    if (!unlocked) return;
    let active = true;
    const current = epoch.current;
    Promise.all(accounts.map(async account => [account.id, await generateTotp(account)] as const)).then(values => {
      if (active && current === epoch.current) setCodes(Object.fromEntries(values));
    }).catch(error => { if (active && current === epoch.current) { setCodes({}); setError(reason(error)); } });
    return () => { active = false; };
  }, [accounts, periodKey, unlocked]);

  // Keep the file input mounted while the native picker backgrounds the app.
  // A returned image waits for a fresh unlock before any secret is decoded.
  useEffect(() => {
    if (!qrFile || !unlocked) return;
    let active = true;
    const current = epoch.current;
    setBusy(true); setError("");
    readOtpQrImage(qrFile).then(parameters => {
      if (!active || current !== epoch.current) return;
      qrRevision.current += 1;
      setQrParameters(parameters); setDraft(previous => previous ?? null);
    }).catch(error => { if (active && current === epoch.current) setError(reason(error)); })
      .finally(() => { if (active && current === epoch.current) { setQrFile(null); setBusy(false); } });
    return () => { active = false; };
  }, [qrFile, unlocked]);

  async function perform(operation: () => Promise<void>, syncAfter = false) {
    const current = epoch.current;
    setBusy(true); setError(""); setNotice("");
    try {
      await operation();
      if (current !== epoch.current) return;
      refresh(); setPassword(""); setConfirmation("");
      if (syncAfter) void sync();
    } catch (error) { if (current === epoch.current) { refresh(); setError(reason(error)); } }
    finally { if (current === epoch.current) setBusy(false); }
  }
  function unlock(event: FormEvent) {
    event.preventDefault();
    if (!exists && password !== confirmation) { setError("两次密码不一致。"); return; }
    void perform(() => exists ? vault.unlock(password) : vault.create(password), true);
  }
  async function saveAccount(parameters: OtpParameters) {
    const current = epoch.current;
    setError("");
    await vault.save(parameters, draft?.id);
    if (current === epoch.current) { refresh(); setDraft(undefined); setQrParameters(null); void sync(); }
  }
  async function copy(account: OtpAccount, kind: "code" | "secret" = "code") {
    const current = epoch.current;
    try {
      if (!vault.unlocked || getCurrentUserId() !== ownerId) return;
      const currentAccount = vault.accounts.find(item => item.id === account.id);
      if (!currentAccount) return;
      const value = kind === "secret" ? currentAccount.secret : await generateTotp(currentAccount);
      if (!vault.unlocked || current !== epoch.current || getCurrentUserId() !== ownerId) return;
      if (!navigator.clipboard?.writeText) throw new Error("当前环境无法自动复制，请手动选择并复制内容。");
      await navigator.clipboard.writeText(value);
      if (current === epoch.current) showToast(kind === "secret" ? "密钥已复制。" : "验证码已复制。", "success");
    } catch (error) { if (current === epoch.current) setError(reason(error)); }
  }
  function remove(account: OtpAccount) {
    if (!window.confirm(`删除“${account.issuer || account.account}”的验证账号？同步后其他设备也会删除，请确认还保留其他验证方式。`)) return;
    void perform(() => vault.remove(account.id), true);
  }
  async function exportBackup() {
    try {
      const result = await exportText(vault.exportBackup(), `身份验证器-${new Date().toISOString().slice(0, 10)}.json`, "application/json;charset=utf-8");
      if (result.saved) showToast("加密备份已导出。", "success");
    } catch (error) { setError(reason(error)); }
  }
  async function readBackup(file?: File) {
    if (!file) return;
    try {
      if (file.size > 1_100_000) throw new Error("加密备份不能超过 1 MB。");
      const current = epoch.current;
      const content = await file.text();
      if (current === epoch.current) { setBackup(content); setBackupPassword(""); setError(""); }
    } catch (error) { setError(reason(error)); }
  }
  function importBackup(event: FormEvent) {
    event.preventDefault();
    void perform(async () => {
      const current = epoch.current;
      const count = await vault.importBackup(backup, backupPassword);
      if (current === epoch.current) { setBackup(""); setBackupPassword(""); showToast(`已导入 ${count} 个验证账号。`, "success"); }
    }, true);
  }
  function useCloudCopy() {
    if (!window.confirm("重新获取云端数据会替换本机尚未同步的修改。请先导出加密备份，确定继续？")) return;
    void perform(async () => { await vault.useCloudCopy(); lock(); refresh(); });
  }

  const visible = accounts.filter(account => `${account.issuer} ${account.account}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  return <Modal title="身份验证器" onClose={onClose} wide className="otp-dialog">
    <input ref={qrInput} type="file" hidden accept="image/png,image/jpeg,image/webp" aria-label="选择单个验证账号二维码" onChange={event => {
      const file = event.target.files?.[0]; event.target.value = "";
      if (file) { setQrFile(file); if (!vault.unlocked) setNotice("解锁后继续读取所选二维码。"); }
    }} />
    {ownerId === "local" ? <div className="form-stack"><p>登录后可在手机和电脑间同步验证码。</p><button className="button primary" onClick={onSignIn}>登录</button></div>
      : loading ? <p role="status">正在读取身份验证器…</p>
      : !ready ? <div className="form-stack"><p role="alert">{error}</p><button className="button secondary" onClick={() => void load()}>重新读取</button></div>
      : <div className="otp-content">
        {!unlocked ? <form className="form-stack otp-unlock" onSubmit={unlock}>
          <h3>{exists ? "解锁验证码" : "设置解锁密码"}</h3>
          <label>解锁密码<input type="password" name="otp-vault-password" autoComplete={exists ? "current-password" : "new-password"} required maxLength={1024} minLength={exists ? undefined : 12} value={password} onChange={event => setPassword(event.target.value)} /></label>
          {!exists && <label>确认解锁密码<input type="password" autoComplete="new-password" required minLength={12} maxLength={1024} value={confirmation} onChange={event => setConfirmation(event.target.value)} /></label>}
          <p className="otp-hint">{exists ? "使用身份验证器的独立密码；切到后台或闲置 5 分钟后会锁定。" : "至少 12 个字符。此密码用于解密，忘记后无法找回，请妥善保存。"}</p>
          <button className="button primary" disabled={busy}>{busy ? "正在解锁…" : exists ? "解锁" : "创建身份验证器"}</button>
        </form> : <>
          <div className="otp-toolbar">
            <input type="search" aria-label="搜索验证账号" placeholder="搜索服务或账号" value={query} onChange={event => setQuery(event.target.value)} />
            <button className="button primary compact" disabled={busy || draft !== undefined} onClick={() => setDraft(null)}><Plus size={16} />添加账号</button>
            <button className="icon-button" disabled={busy || syncing} onClick={() => void sync()} aria-label="同步验证码" title="同步验证码"><RefreshCw size={18} className={syncing ? "spinning" : ""} /></button>
            <button className="icon-button" onClick={lock} aria-label="锁定身份验证器" title="锁定"><LockKeyhole size={18} /></button>
          </div>
          <p className="otp-sync" role="status">{syncing ? "正在同步…" : pending ? "有未同步修改，联网后解锁可继续同步。" : "已同步"}</p>
          {draft !== undefined && <OtpAccountForm key={`${draft?.id ?? "new"}:${qrRevision.current}`} account={draft} initial={qrParameters} disabled={busy} onSave={saveAccount} onChooseQr={() => qrInput.current?.click()} onCancel={() => { setDraft(undefined); setQrParameters(null); setQrFile(null); setBusy(false); }} />}
          {visible.length ? <ul className="otp-list" aria-label="验证账号">{visible.map(account => {
            const remaining = account.period - Math.floor(now / 1000) % account.period;
            const code = codes[account.id];
            const label = [account.issuer, account.account].filter(Boolean).join(" · ");
            return <li key={account.id}>
              <div className="otp-account-name"><strong title={account.issuer || account.account}>{account.issuer || account.account}</strong>{account.issuer && account.account && <span title={account.account}>{account.account}</span>}</div>
              <div className="otp-code-group">
                <button type="button" className="otp-code" disabled={!code} onClick={() => void copy(account)} aria-label={`复制 ${label} 验证码`}>
                  <output aria-live="off" aria-label={`${label} 验证码`}>{code ? `${code.slice(0, code.length / 2)} ${code.slice(code.length / 2)}` : "••• •••"}</output><Copy size={16} />
                </button>
                <span className="otp-lifetime" aria-label={`${label} 剩余有效期`}>{remaining} 秒</span>
              </div>
              <div className="otp-account-actions"><button className="icon-button" disabled={busy || draft !== undefined} onClick={() => setDraft(account)} aria-label={`编辑 ${label}`}><Pencil size={16} /></button><button className="icon-button danger" disabled={busy || draft !== undefined} onClick={() => remove(account)} aria-label={`删除 ${label}`}><Trash2 size={16} /></button></div>
              <div className="otp-secret">
                <div className="otp-secret-value"><code aria-label={`${label} 原始密钥`}>{account.secret}</code></div>
                <button type="button" className="button secondary compact" onClick={() => void copy(account, "secret")} aria-label={`复制 ${label} 原始密钥`}><Copy size={16} />复制密钥</button>
              </div>
            </li>;
          })}</ul> : <p className="otp-empty">{query ? "没有匹配的账号。" : "还没有验证账号，添加密钥或单个账号的二维码。"}</p>}
          <p className="otp-hint">验证码无效时，请检查设备的日期和时间是否自动同步。</p>
        </>}
        {(error || syncError) && <p className="auth-message error" role="alert">{error || syncError}</p>}
        {notice && <p className="otp-hint" role="status">{notice}</p>}
        <details className="otp-backup"><summary>备份与恢复</summary>
          <p className="otp-hint">验证码不包含在普通日程备份中。加密备份需要原解锁密码，并且只能导入当前账号。</p>
          <div className="inline-actions"><button className="button secondary compact" disabled={!exists || busy} onClick={() => void exportBackup()}><Download size={16} />导出加密备份</button><button className="button secondary compact" disabled={busy || (exists && !unlocked)} onClick={() => backupInput.current?.click()}><Upload size={16} />导入加密备份</button>{exists && <button className="button secondary compact" disabled={busy || syncing} onClick={useCloudCopy}>重新获取云端</button>}</div>
          <input ref={backupInput} type="file" accept="application/json,.json" hidden aria-label="选择身份验证器加密备份" onChange={event => { void readBackup(event.target.files?.[0]); event.target.value = ""; }} />
          {backup && <form className="form-stack otp-import" onSubmit={importBackup}><label>备份解锁密码<input type="password" autoComplete="off" required value={backupPassword} maxLength={1024} onChange={event => setBackupPassword(event.target.value)} /></label><div className="form-actions"><button className="button secondary" type="button" onClick={() => { setBackup(""); setBackupPassword(""); }}>取消导入</button><button className="button primary" disabled={busy}>合并导入</button></div></form>}
        </details>
      </div>}
  </Modal>;
}

function OtpAccountForm({ account, initial, disabled, onSave, onCancel, onChooseQr }: { account: OtpAccount | null; initial: OtpParameters | null; disabled: boolean; onSave: (value: OtpParameters) => Promise<void>; onCancel: () => void; onChooseQr: () => void }) {
  const [issuer, setIssuer] = useState(initial?.issuer ?? account?.issuer ?? "");
  const [name, setName] = useState(initial?.account ?? account?.account ?? "");
  const [secret, setSecret] = useState(initial?.secret ?? "");
  const [algorithm, setAlgorithm] = useState<OtpParameters["algorithm"]>(initial?.algorithm ?? account?.algorithm ?? "SHA1");
  const [digits, setDigits] = useState<6 | 8>(initial?.digits ?? account?.digits ?? 6);
  const [period, setPeriod] = useState(initial?.period ?? account?.period ?? 30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const uri = /^otpauth(?:-migration)?:/i.test(secret.trim()) ? parseOtpUri(secret) : null;
      const parameters = uri ? { ...uri, issuer: issuer.trim() || uri.issuer, account: name.trim() || uri.account }
        : validateOtpParameters({ issuer, account: name, secret: secret.trim() || account?.secret || "", algorithm, digits, period });
      await onSave(parameters);
    } catch (error) { setError(reason(error)); }
    finally { setBusy(false); }
  }
  return <form className="form-stack otp-account-form" onSubmit={submit}>
    <div className="section-heading"><h3>{account ? "编辑验证账号" : "添加验证账号"}</h3><button className="button secondary compact" type="button" disabled={busy || disabled} onClick={onChooseQr}><ImagePlus size={16} />导入二维码</button></div>
    <div className="form-grid"><label>服务名称<input maxLength={80} value={issuer} onChange={event => setIssuer(event.target.value)} placeholder="例如 GitHub" /></label><label>账号<input maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="邮箱或账号名称" /></label></div>
    <label>密钥或 otpauth 链接<input type="password" autoComplete="off" spellCheck={false} maxLength={4096} required={!account} placeholder={account ? "留空保留原密钥" : "粘贴密钥或单个账号链接"} value={secret} onChange={event => setSecret(event.target.value)} /></label>
    <details><summary>验证码参数</summary><div className="otp-parameters"><label>算法<select value={algorithm} onChange={event => setAlgorithm(event.target.value as OtpParameters["algorithm"])}><option value="SHA1">SHA-1</option><option value="SHA256">SHA-256</option><option value="SHA512">SHA-512</option></select></label><label>位数<select value={digits} onChange={event => setDigits(Number(event.target.value) as 6 | 8)}><option value={6}>6 位</option><option value={8}>8 位</option></select></label><label>周期（秒）<input type="number" min={1} max={3600} required value={period} onChange={event => setPeriod(Number(event.target.value))} /></label></div></details>
    {error && <p className="auth-message error" role="alert">{error}</p>}
    <div className="form-actions"><button className="button secondary" type="button" onClick={onCancel}>取消</button><button className="button primary" disabled={busy || disabled}><KeyRound size={16} />{busy ? "正在保存…" : "保存账号"}</button></div>
  </form>;
}

async function readOtpQrImage(file: File): Promise<OtpParameters> {
  if (file.size > 8 * 1024 * 1024) throw new Error("二维码图片不能超过 8 MB。");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("当前环境无法读取图片，请手动输入密钥。");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const { default: jsQR } = await import("jsqr");
    const result = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    if (!result) throw new Error("未识别到二维码，请使用清晰的单个账号二维码。");
    return parseOtpUri(result.data);
  } finally { bitmap.close(); }
}
