import { useEffect, useRef, useState } from "react";
import { saveAdminAiSettings, type AdminAiSettings } from "../lib/admin";
import { isSupportedAiModel, isSupportedAudioModel, type AiProvider, type AudioProvider, type MimoChannel } from "../lib/aiModels";
import { AI_FEATURE_KEYS, AI_FEATURE_LABELS, defaultAiFeatureQuotas, type AiFeatureKey, type AiFeatureQuota, type AiFeatureQuotas } from "../lib/aiFeatures";

interface AdminAiSettingsDraft {
  featureQuotas: AiFeatureQuotas;
  aiProvider: AiProvider;
  aiModel: string;
  mimoChannel: MimoChannel;
  audioProvider: AudioProvider;
  audioModel: string;
  textRelayId: string;
  audioRelayId: string;
}

function initialDraft(): AdminAiSettingsDraft {
  return {
    featureQuotas: defaultAiFeatureQuotas(), aiProvider: "deepseek", aiModel: "deepseek-v4-flash",
    mimoChannel: "payg", audioProvider: "mimo", audioModel: "mimo-v2.5-asr", textRelayId: "", audioRelayId: ""
  };
}

function settingsDraft(settings: AdminAiSettings): AdminAiSettingsDraft {
  return {
    featureQuotas: settings.feature_quotas ?? defaultAiFeatureQuotas(), aiProvider: settings.provider,
    aiModel: settings.model, mimoChannel: settings.mimo_channel, audioProvider: settings.audio_provider,
    audioModel: settings.audio_model, textRelayId: settings.text_relay_id ?? "", audioRelayId: settings.audio_relay_id ?? ""
  };
}

function sameDraft(left: AdminAiSettingsDraft, right: AdminAiSettingsDraft): boolean {
  return left.aiProvider === right.aiProvider && left.aiModel === right.aiModel
    && left.mimoChannel === right.mimoChannel && left.audioProvider === right.audioProvider
    && left.audioModel === right.audioModel && left.textRelayId === right.textRelayId && left.audioRelayId === right.audioRelayId
    && AI_FEATURE_KEYS.every((feature) => {
      const a = left.featureQuotas[feature];
      const b = right.featureQuotas[feature];
      return a.enabled_for_all === b.enabled_for_all && a.ordinary_daily_limit === b.ordinary_daily_limit
        && a.ordinary_weekly_limit === b.ordinary_weekly_limit && a.member_daily_limit === b.member_daily_limit
        && a.member_weekly_limit === b.member_weekly_limit;
    });
}

/** Lives with the dialog, so switching admin sections does not discard edits. */
export function useAdminAiSettingsDraft({ onMessage, onSaved }: {
  onMessage: (message: string) => void;
  onSaved: (settings: AdminAiSettings) => void;
}) {
  const [draft, setDraft] = useState(initialDraft);
  const [savingSettings, setSavingSettings] = useState(false);
  const draftRef = useRef(draft);
  const baselineRef = useRef<AdminAiSettingsDraft | null>(null);
  const editRevision = useRef(0);
  const snapshotVersion = useRef(0);
  const savingRef = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  function replaceDraft(next: AdminAiSettingsDraft) {
    draftRef.current = next;
    setDraft(next);
  }

  function updateDraft(patch: Partial<AdminAiSettingsDraft>) {
    editRevision.current += 1;
    replaceDraft({ ...draftRef.current, ...patch });
  }

  function updateFeatureQuota(feature: AiFeatureKey, patch: Partial<AiFeatureQuota>) {
    const current = draftRef.current.featureQuotas;
    updateDraft({ featureQuotas: { ...current, [feature]: { ...current[feature], ...patch } } });
  }

  function removeRelayReference(relayId: string) {
    const current = draftRef.current;
    if (current.textRelayId !== relayId && current.audioRelayId !== relayId) return;
    updateDraft({
      textRelayId: current.textRelayId === relayId ? "" : current.textRelayId,
      audioRelayId: current.audioRelayId === relayId ? "" : current.audioRelayId
    });
  }

  function receiveSnapshot(settings: AdminAiSettings, version: number) {
    if (!mounted.current || savingRef.current || version !== snapshotVersion.current) return false;
    const pristine = baselineRef.current
      ? sameDraft(draftRef.current, baselineRef.current)
      : editRevision.current === 0;
    const next = settingsDraft(settings);
    baselineRef.current = next;
    if (pristine) replaceDraft(next);
    return true;
  }

  async function saveGlobalSettings() {
    if (savingRef.current) return;
    const submitted = draftRef.current;
    const { featureQuotas, aiProvider, aiModel, audioProvider, audioModel, textRelayId, audioRelayId, mimoChannel } = submitted;
    if (!textRelayId && !isSupportedAiModel(aiProvider, aiModel)) {
      onMessage("请选择当前 AI 提供商支持的模型。");
      return;
    }
    if (!audioRelayId && !isSupportedAudioModel(audioProvider, audioModel)) {
      onMessage("请选择当前音频转写通道支持的模型。");
      return;
    }
    const invalidFeature = AI_FEATURE_KEYS.find((feature) => {
      const quota = featureQuotas[feature];
      return quota.ordinary_weekly_limit < quota.ordinary_daily_limit || quota.member_weekly_limit < quota.member_daily_limit;
    });
    if (invalidFeature) {
      onMessage(`${AI_FEATURE_LABELS[invalidFeature]}的每周额度不能低于每日额度。`);
      return;
    }
    const submittedRevision = editRevision.current;
    // Responses from a refresh begun before or during this save are stale.
    snapshotVersion.current += 1;
    savingRef.current = true;
    setSavingSettings(true);
    onMessage("");
    try {
      const settings = await saveAdminAiSettings({
        ...featureQuotas.assistant,
        provider: aiProvider, model: aiModel.trim(), mimo_channel: mimoChannel,
        audio_provider: audioProvider, audio_model: audioModel.trim(),
        text_relay_id: textRelayId || null, audio_relay_id: audioRelayId || null, feature_quotas: featureQuotas
      });
      if (!mounted.current) return;
      const saved = settingsDraft(settings);
      baselineRef.current = saved;
      const editedDuringSave = submittedRevision !== editRevision.current;
      if (!editedDuringSave) replaceDraft(saved);
      onSaved(settings);
      onMessage(editedDuringSave ? "AI 设置已保存，后续修改尚未保存。" : "AI 模型与分项权限额度已保存。");
    } catch (error) {
      if (mounted.current) onMessage(error instanceof Error ? error.message : "保存 AI 全局设置失败。");
    } finally {
      snapshotVersion.current += 1;
      savingRef.current = false;
      if (mounted.current) setSavingSettings(false);
    }
  }

  return {
    draft, updateDraft, updateFeatureQuota, removeRelayReference, savingSettings, saveGlobalSettings, receiveSnapshot,
    snapshotVersion: () => snapshotVersion.current
  };
}

export type AdminAiSettingsEditor = ReturnType<typeof useAdminAiSettingsDraft>;
