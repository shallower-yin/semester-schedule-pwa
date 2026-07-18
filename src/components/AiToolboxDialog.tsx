import { AudioLines, BrainCircuit, Network } from "lucide-react";
import { Modal } from "./Modal";

interface AiToolboxDialogProps {
  onOpenAssistant: () => void;
  onOpenMindMap: () => void;
  onOpenAudioTranscription: () => void;
  onClose: () => void;
}

export function AiToolboxDialog({ onOpenAssistant, onOpenMindMap, onOpenAudioTranscription, onClose }: AiToolboxDialogProps) {
  function open(action: () => void) {
    onClose();
    action();
  }

  return (
    <Modal title="AI 工具箱" onClose={onClose}>
      <div className="ai-toolbox-grid">
        <button type="button" onClick={() => open(onOpenAssistant)}><BrainCircuit /><span><strong>AI 助手</strong><small>问答、查询和创建日程数据</small></span></button>
        <button type="button" onClick={() => open(onOpenMindMap)}><Network /><span><strong>AI 思维导图</strong><small>整理主题、文档和计划结构</small></span></button>
        <button type="button" onClick={() => open(onOpenAudioTranscription)}><AudioLines /><span><strong>AI 音频转写</strong><small>转写录音并继续询问内容</small></span></button>
      </div>
    </Modal>
  );
}
