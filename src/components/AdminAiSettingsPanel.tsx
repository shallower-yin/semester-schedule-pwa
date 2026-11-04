import type { ReactNode } from "react";
import { KeyRound, Save } from "lucide-react";
import type { AdminAiRelay } from "../lib/admin";
import { AI_MODEL_OPTIONS, AUDIO_MODEL_OPTIONS, defaultAiModel, defaultAudioModel, type AiProvider, type AudioProvider } from "../lib/aiModels";
import { AI_FEATURE_KEYS, AI_FEATURE_LABELS } from "../lib/aiFeatures";
import type { AdminAiSettingsEditor } from "./useAdminAiSettingsDraft";

export function AdminAiSettingsPanel({ editor, relays, children }: {
  editor: AdminAiSettingsEditor;
  relays: AdminAiRelay[];
  children: ReactNode;
}) {
  const { updateDraft, updateFeatureQuota, saveGlobalSettings, savingSettings } = editor;
  const { featureQuotas, aiProvider, aiModel, mimoChannel, audioProvider, audioModel, textRelayId, audioRelayId } = editor.draft;
  return (
    <section className="admin-access-editor admin-global-settings">
    <div className="section-heading">
      <div><h3><KeyRound size={18} /> AI 模型、权限与分项额度</h3><p>各功能独立计次；额度填 0 表示该角色不可用，管理员不限额。</p></div>
    </div>
    <div className="admin-ai-route-grid">
      <article className="admin-ai-route-card">
        <h4>普通 AI / 翻译 / 思维导图</h4>
        <label>
          文本路由
          <select value={textRelayId} onChange={(event) => updateDraft({ textRelayId: event.target.value })}>
            <option value="">内置服务商</option>
            {relays.filter((relay) => relay.supportsText).map((relay) => (
              <option value={relay.id} key={relay.id}>{relay.name} · {relay.textModel}</option>
            ))}
          </select>
        </label>
        {!textRelayId && <>
          <label>
            内置提供商
            <select value={aiProvider} onChange={(event) => {
              const value = event.target.value;
              const provider: AiProvider = value === "mimo" || value === "siliconflow" || value === "tju" ? value : "deepseek";
              updateDraft({ aiProvider: provider, aiModel: defaultAiModel(provider) });
            }}>
              <option value="deepseek">DeepSeek</option>
              <option value="mimo">Xiaomi MiMo</option>
              <option value="siliconflow">硅基流动</option>
              <option value="tju">学校 API</option>
            </select>
          </label>
          <label>
            模型
            <select value={aiModel} onChange={(event) => updateDraft({ aiModel: event.target.value })}>
              {AI_MODEL_OPTIONS[aiProvider].map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </label>
          {aiProvider === "mimo" && <label>
            MiMo 通道
            <select value={mimoChannel} onChange={(event) => updateDraft({ mimoChannel: event.target.value === "token_plan" ? "token_plan" : "payg" })}>
              <option value="payg">按量 API（sk）</option>
              <option value="token_plan">Token Plan（tp，仅获授权后）</option>
            </select>
          </label>}
        </>}
      </article>
      <article className="admin-ai-route-card">
        <h4>音频助手 / 转写</h4>
        <label>
          音频路由
          <select value={audioRelayId} onChange={(event) => updateDraft({ audioRelayId: event.target.value })}>
            <option value="">内置服务商</option>
            {relays.filter((relay) => relay.supportsAudio).map((relay) => (
              <option value={relay.id} key={relay.id}>{relay.name} · {relay.audioModel}</option>
            ))}
          </select>
        </label>
        {!audioRelayId && <>
          <label>
            内置转写通道
            <select value={audioProvider} onChange={(event) => {
              const provider: AudioProvider = event.target.value === "siliconflow" ? "siliconflow" : "mimo";
              updateDraft({ audioProvider: provider, audioModel: defaultAudioModel(provider) });
            }}>
              <option value="mimo">Xiaomi MiMo</option>
              <option value="siliconflow">硅基流动</option>
            </select>
          </label>
          <label>
            转写模型
            <select value={audioModel} onChange={(event) => updateDraft({ audioModel: event.target.value })}>
              {AUDIO_MODEL_OPTIONS[audioProvider].map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}
            </select>
          </label>
        </>}
      </article>
    </div>
    <div className="admin-ai-settings-actions">
      <p>路由配置保存在服务端；网页和 APK 会同时生效，客户端不会获得 API Key。</p>
      <button className="button primary" onClick={() => void saveGlobalSettings()} disabled={savingSettings}>
        <Save size={16} />保存 AI 设置
      </button>
    </div>
    {!textRelayId && aiProvider === "mimo" && (
      <p className="admin-channel-note">
        音频转写固定使用按量 API；此处通道只控制主模型。MiMo Token Plan 官方仅授权 AI 编程工具，普通应用调用请选按量 API。
      </p>
    )}
    {children}
    <div className="admin-feature-quota-table">
      <div className="admin-feature-quota-header" aria-hidden="true">
        <span>功能</span><span>全员开放</span><span>普通 / 日</span><span>普通 / 周</span><span>会员 / 日</span><span>会员 / 周</span><span>管理员</span>
      </div>
      {AI_FEATURE_KEYS.map((feature) => {
        const quota = featureQuotas[feature];
        return (
          <div className="admin-feature-quota-row" key={feature}>
            <strong>{AI_FEATURE_LABELS[feature]}</strong>
            <label data-label="全员开放">
              <select aria-label={`${AI_FEATURE_LABELS[feature]}全员开放`} value={quota.enabled_for_all ? "1" : "0"} onChange={(event) => updateFeatureQuota(feature, { enabled_for_all: event.target.value === "1" })}>
                <option value="1">开放</option>
                <option value="0">关闭</option>
              </select>
            </label>
            <label data-label="普通 / 日"><input aria-label={`${AI_FEATURE_LABELS[feature]}普通用户每日额度`} type="number" min={0} max={100000} value={quota.ordinary_daily_limit} onChange={(event) => updateFeatureQuota(feature, { ordinary_daily_limit: Math.max(0, Number(event.target.value)) })} /></label>
            <label data-label="普通 / 周"><input aria-label={`${AI_FEATURE_LABELS[feature]}普通用户每周额度`} type="number" min={quota.ordinary_daily_limit} max={1000000} value={quota.ordinary_weekly_limit} onChange={(event) => updateFeatureQuota(feature, { ordinary_weekly_limit: Math.max(0, Number(event.target.value)) })} /></label>
            <label data-label="会员 / 日"><input aria-label={`${AI_FEATURE_LABELS[feature]}会员每日额度`} type="number" min={0} max={100000} value={quota.member_daily_limit} onChange={(event) => updateFeatureQuota(feature, { member_daily_limit: Math.max(0, Number(event.target.value)) })} /></label>
            <label data-label="会员 / 周"><input aria-label={`${AI_FEATURE_LABELS[feature]}会员每周额度`} type="number" min={quota.member_daily_limit} max={1000000} value={quota.member_weekly_limit} onChange={(event) => updateFeatureQuota(feature, { member_weekly_limit: Math.max(0, Number(event.target.value)) })} /></label>
            <span className="admin-unlimited-note">不限额</span>
          </div>
        );
      })}
    </div>
    </section>
  );
}
