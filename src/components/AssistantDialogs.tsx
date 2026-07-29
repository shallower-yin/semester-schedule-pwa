import { lazy, Suspense } from "react";
import type { ScheduleAssistantInput } from "../lib/scheduleAssistant";
import { AiToolboxDialog } from "./AiToolboxDialog";

const ScheduleAssistantDialog = lazy(() => import("./ScheduleAssistantDialog").then((module) => ({ default: module.ScheduleAssistantDialog })));
const DeepSeekAssistantDialog = lazy(() => import("./DeepSeekAssistantDialog").then((module) => ({ default: module.DeepSeekAssistantDialog })));
const TranslationDialog = lazy(() => import("./TranslationDialog").then((module) => ({ default: module.TranslationDialog })));
const MindMapDialog = lazy(() => import("./MindMapDialog").then((module) => ({ default: module.MindMapDialog })));
const AudioTranscriptionDialog = lazy(() => import("./AudioTranscriptionDialog").then((module) => ({ default: module.AudioTranscriptionDialog })));

interface AssistantDialogsProps {
  input: ScheduleAssistantInput;
  ownerId: string;
  userEmail?: string | null;
  showScheduleAssistant: boolean;
  showDeepSeekAssistant: boolean;
  showTranslation: boolean;
  showMindMap: boolean;
  showAudioTranscription: boolean;
  showAiToolbox: boolean;
  setShowScheduleAssistant: (open: boolean) => void;
  setShowDeepSeekAssistant: (open: boolean) => void;
  setShowTranslation: (open: boolean) => void;
  setShowMindMap: (open: boolean) => void;
  setShowAudioTranscription: (open: boolean) => void;
  setShowAiToolbox: (open: boolean) => void;
}

/**
 * Assistant and AI tool dialogs, grouped out of App so the shell no longer
 * orchestrates every dialog inline. The three schedule-aware dialogs (local
 * assistant, AI assistant, mind map) share one input bundle. The toolbox opens
 * the AI assistant / mind map / audio transcription via the same setters.
 */
export function AssistantDialogs({
  input,
  ownerId,
  userEmail,
  showScheduleAssistant,
  showDeepSeekAssistant,
  showTranslation,
  showMindMap,
  showAudioTranscription,
  showAiToolbox,
  setShowScheduleAssistant,
  setShowDeepSeekAssistant,
  setShowTranslation,
  setShowMindMap,
  setShowAudioTranscription,
  setShowAiToolbox
}: AssistantDialogsProps) {
  return (
    <>
      {showScheduleAssistant && (
        <Suspense fallback={null}>
          <ScheduleAssistantDialog input={input} onClose={() => setShowScheduleAssistant(false)} />
        </Suspense>
      )}
      {showDeepSeekAssistant && (
        <Suspense fallback={null}>
          <DeepSeekAssistantDialog
            input={input}
            ownerId={ownerId}
            userEmail={userEmail}
            onClose={() => setShowDeepSeekAssistant(false)}
          />
        </Suspense>
      )}
      {showTranslation && (
        <Suspense fallback={null}>
          <TranslationDialog ownerId={ownerId} onClose={() => setShowTranslation(false)} />
        </Suspense>
      )}
      {showMindMap && (
        <Suspense fallback={null}>
          <MindMapDialog input={input} ownerId={ownerId} onClose={() => setShowMindMap(false)} />
        </Suspense>
      )}
      {showAudioTranscription && (
        <Suspense fallback={null}>
          <AudioTranscriptionDialog ownerId={ownerId} onClose={() => setShowAudioTranscription(false)} />
        </Suspense>
      )}
      {showAiToolbox && (
        <AiToolboxDialog
          onOpenAssistant={() => setShowDeepSeekAssistant(true)}
          onOpenTranslation={() => setShowTranslation(true)}
          onOpenMindMap={() => setShowMindMap(true)}
          onOpenAudioTranscription={() => setShowAudioTranscription(true)}
          onClose={() => setShowAiToolbox(false)}
        />
      )}
    </>
  );
}
