import { useEffect, useRef, useState } from "react";
import { Activity, Copy, Database, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import {
  deleteAdminAiRelay, saveAdminAiRelay, testAdminAiRelay,
  type AdminAiRelay, type AdminAiRelayProtocol, type SaveAdminAiRelayInput
} from "../lib/admin";

type AiRelayDraft = SaveAdminAiRelayInput;

/** State stays in AdminDialog even when a different section is displayed. */
export function useAdminAiRelayManager({ onMessage, onRefresh, onDeleted }: {
  onMessage: (message: string) => void;
  onRefresh: () => Promise<void>;
  onDeleted: (relayId: string) => void;
}) {
  const [relayDraft, setRelayDraft] = useState<AiRelayDraft | null>(null);
  const [savingRelay, setSavingRelay] = useState(false);
  const [testingRelay, setTestingRelay] = useState("");
  const [deletingRelay, setDeletingRelay] = useState("");
  const editorGeneration = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function closeEditor() {
    editorGeneration.current += 1;
    setRelayDraft(null);
  }

  function beginNewRelay(protocol: AdminAiRelayProtocol = "openai_compatible") {
    editorGeneration.current += 1;
    setRelayDraft(defaultRelayDraft(protocol));
  }

  function beginEditRelay(relay: AdminAiRelay) {
    editorGeneration.current += 1;
    setRelayDraft({
      id: relay.id,
      name: relay.name,
      protocol: relay.protocol,
      baseUrl: relay.baseUrl,
      apiKey: "",
      supportsText: relay.supportsText,
      textModel: relay.textModel ?? "",
      supportsAudio: relay.supportsAudio,
      audioModel: relay.audioModel ?? ""
    });
  }

  function beginCopyRelay(relay: AdminAiRelay) {
    editorGeneration.current += 1;
    setRelayDraft({
      name: `${relay.name} 副本`,
      protocol: relay.protocol,
      baseUrl: relay.baseUrl,
      apiKey: "",
      supportsText: relay.supportsText,
      textModel: relay.textModel ?? "",
      supportsAudio: relay.supportsAudio,
      audioModel: relay.audioModel ?? ""
    });
  }

  function changeRelayProtocol(protocol: AdminAiRelayProtocol) {
    setRelayDraft((current) => {
      if (!current) return current;
      const defaults = defaultRelayDraft(protocol);
      return {
        ...current,
        protocol,
        baseUrl: current.id ? current.baseUrl : defaults.baseUrl,
        textModel: current.id ? current.textModel : defaults.textModel,
        supportsAudio: protocol === "deepseek" ? false : current.supportsAudio,
        audioModel: protocol === "deepseek" ? "" : current.audioModel || defaults.audioModel
      };
    });
  }

  async function persistRelay() {
    if (!relayDraft) return;
    if (!relayDraft.id && !relayDraft.apiKey.trim()) {
      onMessage("新增或复制中转站时必须填写 API Key；系统不会读取已有中转站的明文密钥。");
      return;
    }
    const submitted = relayDraft;
    const generation = editorGeneration.current;
    setSavingRelay(true);
    onMessage("");
    try {
      const saved = await saveAdminAiRelay(submitted);
      if (!mounted.current) return;
      if (editorGeneration.current === generation) {
        setRelayDraft((current) => current === submitted ? null : current && ({
          ...current, id: saved.id, apiKey: current.apiKey === submitted.apiKey ? "" : current.apiKey
        }));
      }
      await onRefresh();
      onMessage(`中转站“${saved.name}”已保存。密钥已写入服务端保险库。`);
    } catch (error) {
      if (mounted.current) onMessage(error instanceof Error ? error.message : "保存中转站失败。");
    } finally {
      if (mounted.current) setSavingRelay(false);
    }
  }

  async function testRelay(relay: AdminAiRelay, kind: "text" | "audio") {
    setTestingRelay(`${relay.id}:${kind}`);
    onMessage("");
    try {
      const result = await testAdminAiRelay(relay.id, kind);
      if (!mounted.current) return;
      await onRefresh();
      onMessage(`${relay.name}：${result.message}，耗时 ${result.latencyMs} ms。`);
    } catch (error) {
      if (mounted.current) onMessage(error instanceof Error ? error.message : "测试中转站失败。");
    } finally {
      if (mounted.current) setTestingRelay("");
    }
  }

  async function removeRelay(relay: AdminAiRelay) {
    if (!window.confirm(`删除中转站“${relay.name}”及其服务端密钥？引用它的文本或音频路由会自动回退到内置通道。`)) return;
    setDeletingRelay(relay.id);
    onMessage("");
    try {
      await deleteAdminAiRelay(relay.id);
      if (!mounted.current) return;
      onDeleted(relay.id);
      setRelayDraft((current) => current?.id === relay.id ? null : current);
      await onRefresh();
      onMessage(`中转站“${relay.name}”已删除，密钥也已从服务端保险库移除。`);
    } catch (error) {
      if (mounted.current) onMessage(error instanceof Error ? error.message : "删除中转站失败。");
    } finally {
      if (mounted.current) setDeletingRelay("");
    }
  }

  return {
    relayDraft, setRelayDraft, savingRelay, testingRelay, deletingRelay, closeEditor,
    beginNewRelay, beginEditRelay, beginCopyRelay, changeRelayProtocol, persistRelay, testRelay, removeRelay
  };
}

export function AdminAiRelayManager({ relays, editor }: {
  relays: AdminAiRelay[];
  editor: ReturnType<typeof useAdminAiRelayManager>;
}) {
  const {
    relayDraft, setRelayDraft, savingRelay, testingRelay, deletingRelay, closeEditor,
    beginNewRelay, beginEditRelay, beginCopyRelay, changeRelayProtocol, persistRelay, testRelay, removeRelay
  } = editor;
  return (
    <section className="admin-ai-relay-manager" aria-labelledby="admin-ai-relay-heading">
      <div className="section-heading">
        <div>
          <h4 id="admin-ai-relay-heading"><Database size={17} /> 自定义中转站</h4>
          <p>支持 OpenAI 兼容、DeepSeek 和 MiMo。保存不调用上游；测试按钮会发送一次极小请求，可能产生少量费用。</p>
        </div>
        <button className="button secondary compact" type="button" onClick={() => beginNewRelay()}>
          <Plus size={15} />新增中转站
        </button>
      </div>
      {relayDraft && (
        <div className="admin-ai-relay-editor">
          <div className="admin-ai-relay-editor-heading">
            <strong>{relayDraft.id ? "编辑中转站" : "新增中转站"}</strong>
            <button className="icon-button" type="button" aria-label="关闭中转站编辑" onClick={closeEditor}><X size={17} /></button>
          </div>
          <div className="admin-ai-relay-form">
            <label>
              名称
              <input value={relayDraft.name} maxLength={80} placeholder="例如：主力 OpenAI 中转" onChange={(event) => setRelayDraft({ ...relayDraft, name: event.target.value })} />
            </label>
            <label>
              接口协议
              <select value={relayDraft.protocol} onChange={(event) => changeRelayProtocol(event.target.value as AdminAiRelayProtocol)}>
                <option value="openai_compatible">OpenAI 兼容</option>
                <option value="deepseek">DeepSeek 直连</option>
                <option value="mimo">Xiaomi MiMo 直连</option>
              </select>
            </label>
            <label className="admin-ai-relay-url">
              API 基础地址
              <input type="url" value={relayDraft.baseUrl} placeholder="https://example.com/v1" onChange={(event) => setRelayDraft({ ...relayDraft, baseUrl: event.target.value })} />
            </label>
            <label>
              API Key
              <input type="password" autoComplete="new-password" value={relayDraft.apiKey} placeholder={relayDraft.id ? "留空保留原密钥" : "新增时必填"} onChange={(event) => setRelayDraft({ ...relayDraft, apiKey: event.target.value })} />
            </label>
            <label className="admin-ai-relay-capability">
              <input type="checkbox" checked={relayDraft.supportsText} onChange={(event) => setRelayDraft({ ...relayDraft, supportsText: event.target.checked })} />
              启用文本 AI
            </label>
            <label>
              文本模型 ID
              <input value={relayDraft.textModel} disabled={!relayDraft.supportsText} placeholder="例如：deepseek-chat" onChange={(event) => setRelayDraft({ ...relayDraft, textModel: event.target.value })} />
            </label>
            <label className="admin-ai-relay-capability">
              <input type="checkbox" checked={relayDraft.supportsAudio} disabled={relayDraft.protocol === "deepseek"} onChange={(event) => setRelayDraft({ ...relayDraft, supportsAudio: event.target.checked })} />
              启用音频转写
            </label>
            <label>
              音频模型 ID
              <input value={relayDraft.audioModel} disabled={!relayDraft.supportsAudio} placeholder="例如：whisper-1" onChange={(event) => setRelayDraft({ ...relayDraft, audioModel: event.target.value })} />
            </label>
          </div>
          <p className="admin-channel-note">基础地址请包含服务商要求的版本前缀（常见为 /v1）；系统会自动追加 /chat/completions 或 /audio/transcriptions。</p>
          <button className="button primary" type="button" onClick={() => void persistRelay()} disabled={savingRelay}>
            <Save size={15} />{savingRelay ? "保存中…" : "安全保存"}
          </button>
        </div>
      )}
      <div className="admin-ai-relay-list">
        {relays.map((relay) => (
          <article className="admin-ai-relay-card" key={relay.id}>
            <div className="admin-ai-relay-card-main">
              <div>
                <strong>{relay.name}</strong>
                <span>{relayProtocolLabel(relay.protocol)} · {safeRelayHost(relay.baseUrl)}</span>
              </div>
              <span className={`admin-ai-relay-status ${relay.lastTestStatus ?? "untested"}`}>
                {relay.lastTestStatus === "success" ? "连通" : relay.lastTestStatus === "error" ? "失败" : "未测试"}
              </span>
            </div>
            <p>
              {relay.supportsText ? `文本：${relay.textModel}` : "文本：未启用"}
              {" · "}
              {relay.supportsAudio ? `音频：${relay.audioModel}` : "音频：未启用"}
              {" · 密钥已加密保存"}
            </p>
            {relay.lastTestMessage && <small>{relay.lastTestMessage}{relay.lastTestLatencyMs != null ? ` · ${relay.lastTestLatencyMs} ms` : ""}</small>}
            <div className="admin-ai-relay-actions">
              {relay.supportsText && <button className="button secondary compact" type="button" disabled={Boolean(testingRelay)} onClick={() => void testRelay(relay, "text")}><Activity size={14} />{testingRelay === `${relay.id}:text` ? "测试中…" : "测文本"}</button>}
              {relay.supportsAudio && <button className="button secondary compact" type="button" disabled={Boolean(testingRelay)} onClick={() => void testRelay(relay, "audio")}><Activity size={14} />{testingRelay === `${relay.id}:audio` ? "测试中…" : "测音频"}</button>}
              <button className="button secondary compact" type="button" onClick={() => beginEditRelay(relay)}><Pencil size={14} />编辑</button>
              <button className="button secondary compact" type="button" onClick={() => beginCopyRelay(relay)}><Copy size={14} />复制</button>
              <button className="button danger compact" type="button" disabled={deletingRelay === relay.id} onClick={() => void removeRelay(relay)}><Trash2 size={14} />删除</button>
            </div>
          </article>
        ))}
        {!relays.length && !relayDraft && <p className="admin-ai-relay-empty">还没有自定义中转站。内置服务商仍会正常工作。</p>}
      </div>
    </section>
  );
}

function defaultRelayDraft(protocol: AdminAiRelayProtocol): AiRelayDraft {
  if (protocol === "deepseek") {
    return {
      name: "",
      protocol,
      baseUrl: "https://api.deepseek.com",
      apiKey: "",
      supportsText: true,
      textModel: "deepseek-chat",
      supportsAudio: false,
      audioModel: ""
    };
  }
  if (protocol === "mimo") {
    return {
      name: "",
      protocol,
      baseUrl: "https://api.xiaomimimo.com/v1",
      apiKey: "",
      supportsText: true,
      textModel: "mimo-v2.6-flash",
      supportsAudio: true,
      audioModel: "mimo-v2.5-asr"
    };
  }
  return {
    name: "",
    protocol,
    baseUrl: "",
    apiKey: "",
    supportsText: true,
    textModel: "",
    supportsAudio: false,
    audioModel: ""
  };
}

function relayProtocolLabel(protocol: AdminAiRelayProtocol): string {
  if (protocol === "deepseek") return "DeepSeek";
  if (protocol === "mimo") return "Xiaomi MiMo";
  return "OpenAI 兼容";
}

function safeRelayHost(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return "地址无效";
  }
}
