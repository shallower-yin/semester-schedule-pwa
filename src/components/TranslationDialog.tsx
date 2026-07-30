import {
  ArrowLeftRight,
  BookOpen,
  Clipboard,
  ClipboardPaste,
  Columns2,
  Download,
  History,
  KeyRound,
  Languages,
  RotateCcw,
  Sparkles,
  Square,
  Trash2
} from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  cancelAiTask,
  getAiTaskSnapshot,
  retryAiTask,
  setAiTaskDialogOpen,
  startAiTask,
  subscribeAiTasks
} from "../lib/aiBackgroundTasks";
import { exportText } from "../lib/fileExport";
import { showToast } from "../lib/toast";
import {
  TRANSLATION_DIRECTION_LABELS,
  TRANSLATION_HISTORY_LIMIT,
  TRANSLATION_SOURCE_MAX_LENGTH,
  TRANSLATION_STYLE_LABELS,
  TRANSLATION_SUMMARY_FOCUS_LABELS,
  TRANSLATION_SUMMARY_MIN_HISTORY,
  bilingualParagraphs,
  clearTranslationLearningSummary,
  clearTranslationHistory,
  deleteTranslationHistoryItem,
  loadTranslationLearningSummary,
  loadTranslationHistory,
  prependTranslationHistory,
  saveTranslationLearningSummary,
  summarizeTranslationHistory,
  translateText,
  type TranslationDirection,
  type TranslationHistoryItem,
  type TranslationLearningSummary,
  type TranslationSummaryFocus,
  type TranslationStyle
} from "../lib/translation";
import { Modal } from "./Modal";

interface TranslationDialogProps {
  ownerId: string;
  onClose: () => void;
}

export function TranslationDialog({ ownerId, onClose }: TranslationDialogProps) {
  const task = useSyncExternalStore(subscribeAiTasks, () => getAiTaskSnapshot("translation"), () => getAiTaskSnapshot("translation"));
  const [sourceText, setSourceText] = useState("");
  const [translation, setTranslation] = useState("");
  const [direction, setDirection] = useState<TranslationDirection>("zh-en");
  const [style, setStyle] = useState<TranslationStyle>("natural");
  const [requiredTerms, setRequiredTerms] = useState("");
  const [preservedTerms, setPreservedTerms] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [comparison, setComparison] = useState(false);
  const [history, setHistory] = useState<TranslationHistoryItem[]>(() => loadTranslationHistory(ownerId));
  const [summaryFocus, setSummaryFocus] = useState<TranslationSummaryFocus>("comprehensive");
  const [summaryTheme, setSummaryTheme] = useState("");
  const [learningSummary, setLearningSummary] = useState<TranslationLearningSummary | null>(() => loadTranslationLearningSummary(ownerId));
  const running = task.status === "running";
  const summarizing = running && task.label.includes("学习总结");
  const translating = running && !summarizing;
  const paragraphs = useMemo(() => bilingualParagraphs(sourceText, translation), [sourceText, translation]);

  useEffect(() => {
    setHistory(loadTranslationHistory(ownerId));
    setLearningSummary(loadTranslationLearningSummary(ownerId));
  }, [ownerId]);

  useEffect(() => {
    setAiTaskDialogOpen("translation", true);
    return () => setAiTaskDialogOpen("translation", false);
  }, []);

  function startTranslation() {
    const request = {
      sourceText: sourceText.trim(),
      direction,
      style,
      requiredTerms: requiredTerms.trim(),
      preservedTerms: preservedTerms.trim(),
      accessCode: accessCode.trim()
    };
    if (!request.sourceText) {
      showToast("请输入需要翻译的内容。", "error");
      return;
    }
    if (request.sourceText.length > TRANSLATION_SOURCE_MAX_LENGTH) {
      showToast(`首版单次最多翻译 ${TRANSLATION_SOURCE_MAX_LENGTH.toLocaleString("zh-CN")} 个字符。`, "error");
      return;
    }
    const started = startAiTask({
      feature: "translation",
      label: `正在${TRANSLATION_DIRECTION_LABELS[request.direction]}`,
      successMessage: "翻译已完成，点击可查看译文。",
      run: (signal) => translateText({ ...request, signal }),
      onSuccess: (result) => {
        const item: TranslationHistoryItem = {
          id: globalThis.crypto?.randomUUID?.() ?? `translation-${Date.now()}`,
          sourceText: request.sourceText,
          translation: result.translation,
          direction: request.direction,
          style: request.style,
          requiredTerms: request.requiredTerms,
          preservedTerms: request.preservedTerms,
          createdAt: new Date().toISOString()
        };
        const next = prependTranslationHistory(ownerId, item);
        setHistory(next);
        setSourceText(item.sourceText);
        setTranslation(item.translation);
        if (result.access === "access-code") setAccessCode("");
      }
    });
    if (!started) showToast("已有翻译任务正在处理。", "error");
  }

  function startLearningSummary() {
    if (history.length < TRANSLATION_SUMMARY_MIN_HISTORY) {
      showToast(`至少积累 ${TRANSLATION_SUMMARY_MIN_HISTORY} 条翻译记录后才能生成学习总结。`, "error");
      return;
    }
    const request = {
      history: [...history],
      focus: summaryFocus,
      theme: summaryTheme.trim(),
      accessCode: accessCode.trim()
    };
    const started = startAiTask({
      feature: "translation",
      label: "正在生成翻译学习总结",
      successMessage: "翻译学习总结已完成，点击可查看。",
      run: (signal) => summarizeTranslationHistory({ ...request, signal }),
      onSuccess: (summary) => {
        saveTranslationLearningSummary(ownerId, summary);
        setLearningSummary(summary);
        if (request.accessCode) setAccessCode("");
      }
    });
    if (!started) showToast("已有翻译或总结任务正在处理。", "error");
  }

  function swapDirection() {
    setDirection((current) => current === "zh-en" ? "en-zh" : "zh-en");
    if (translation) {
      const previousSource = sourceText;
      setSourceText(translation);
      setTranslation(previousSource);
    }
  }

  function useTranslationAsSource() {
    if (!translation) return;
    setSourceText(translation);
    setTranslation("");
    setDirection((current) => current === "zh-en" ? "en-zh" : "zh-en");
  }

  function openHistoryItem(item: TranslationHistoryItem) {
    setSourceText(item.sourceText);
    setTranslation(item.translation);
    setDirection(item.direction);
    setStyle(item.style);
    setRequiredTerms(item.requiredTerms);
    setPreservedTerms(item.preservedTerms);
  }

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("剪贴板里没有文字。");
      setSourceText(text.slice(0, TRANSLATION_SOURCE_MAX_LENGTH));
      if (text.length > TRANSLATION_SOURCE_MAX_LENGTH) showToast("剪贴板内容过长，已保留前 20,000 个字符。", "error");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "无法读取剪贴板，请直接粘贴到原文框。", "error");
    }
  }

  async function copyTranslation() {
    if (!translation) return;
    try {
      await navigator.clipboard.writeText(translation);
      showToast("译文已复制。", "success");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = translation;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      showToast("译文已复制。", "success");
    }
  }

  async function downloadTranslation() {
    if (!translation) return;
    await exportText(translation, `翻译-${new Date().toISOString().slice(0, 10)}.txt`);
    showToast("译文 TXT 已保存。", "success");
  }

  async function copyLearningSummary() {
    if (!learningSummary) return;
    const content = [
      learningSummary.title,
      learningSummary.overview,
      learningSummary.themes.length
        ? `\n主题\n${learningSummary.themes.map((item) => `- ${item.name}：${item.summary}`).join("\n")}`
        : "",
      learningSummary.sentencePatterns.length
        ? `\n常用句式\n${learningSummary.sentencePatterns.map((item) => `- ${item.pattern}\n  ${item.meaning}\n  ${item.example}`).join("\n")}`
        : "",
      learningSummary.vocabulary.length
        ? `\n词汇搭配\n${learningSummary.vocabulary.map((item) => `- ${item.term}：${item.meaning}\n  ${item.usage}\n  ${item.example}`).join("\n")}`
        : "",
      learningSummary.practice.length
        ? `\n练习建议\n${learningSummary.practice.map((item) => `- ${item}`).join("\n")}`
        : ""
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard.writeText(content);
      showToast("学习总结已复制。", "success");
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
      showToast("学习总结已复制。", "success");
    }
  }

  return (
    <Modal
      title="翻译助手"
      onClose={onClose}
      wide
      className="translation-modal"
      headerExtra={(
        <label className="ai-header-access-code">
          <KeyRound size={14} />
          <input value={accessCode} placeholder="访问口令" aria-label="翻译访问口令" onChange={(event) => setAccessCode(event.target.value)} />
        </label>
      )}
    >
      <div className="translation-workbench">
        <header className="translation-toolbar">
          <div className="translation-direction" aria-label="翻译方向">
            <strong>{TRANSLATION_DIRECTION_LABELS[direction]}</strong>
            <button type="button" className="icon-button" aria-label="交换翻译方向" onClick={swapDirection}><ArrowLeftRight size={18} /></button>
          </div>
          <label>
            翻译风格
            <select value={style} onChange={(event) => setStyle(event.target.value as TranslationStyle)}>
              {Object.entries(TRANSLATION_STYLE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <button type="button" className={`button secondary compact ${comparison ? "active" : ""}`} disabled={!translation} onClick={() => setComparison((value) => !value)}>
            <Columns2 size={15} />{comparison ? "编辑视图" : "中英对照"}
          </button>
        </header>

        <details className="translation-terms">
          <summary>术语要求（可选）</summary>
          <div>
            <label>必须这样翻译<textarea rows={2} value={requiredTerms} placeholder="例如：日程计划表 = Schedule Planner" onChange={(event) => setRequiredTerms(event.target.value)} /></label>
            <label>不翻译词语<textarea rows={2} value={preservedTerms} placeholder="例如：MiMo、DeepSeek、OpenAI" onChange={(event) => setPreservedTerms(event.target.value)} /></label>
          </div>
        </details>

        {comparison && translation ? (
          <section className="translation-comparison" aria-label="中英对照">
            {paragraphs.map((item, index) => (
              <article key={`${index}-${item.source.slice(0, 12)}`}>
                <p>{item.source}</p>
                <p>{item.translation}</p>
              </article>
            ))}
          </section>
        ) : (
          <section className="translation-editors">
            <article>
              <header><strong>原文</strong><span>{sourceText.length.toLocaleString("zh-CN")} / {TRANSLATION_SOURCE_MAX_LENGTH.toLocaleString("zh-CN")}</span></header>
              <textarea
                aria-label="翻译原文"
                value={sourceText}
                maxLength={TRANSLATION_SOURCE_MAX_LENGTH}
                placeholder={direction === "zh-en" ? "输入或粘贴中文内容" : "Enter or paste English text"}
                onChange={(event) => setSourceText(event.target.value)}
              />
              <div className="translation-editor-actions">
                <button type="button" className="button secondary compact" disabled={running} onClick={() => void pasteFromClipboard()}><ClipboardPaste size={15} />粘贴</button>
                <button type="button" className="button secondary compact" disabled={!sourceText || running} onClick={() => { setSourceText(""); setTranslation(""); }}><Trash2 size={15} />清空</button>
                {translating ? (
                  <button type="button" className="button secondary compact translation-mobile-submit" onClick={() => { cancelAiTask("translation"); showToast("已停止翻译。", "success"); }}><Square size={14} />停止</button>
                ) : (
                  <button type="button" className="button primary compact translation-mobile-submit" disabled={running || !sourceText.trim()} onClick={startTranslation}><Languages size={15} />{translation ? "重新翻译" : "开始翻译"}</button>
                )}
              </div>
            </article>
            <article>
              <header><strong>译文</strong><span>{TRANSLATION_STYLE_LABELS[style]}</span></header>
              <textarea aria-label="翻译译文" value={translation} readOnly placeholder={translating ? "正在翻译…" : "译文会显示在这里"} />
              <div className="translation-editor-actions">
                <button type="button" className="button secondary compact" disabled={!translation} onClick={() => void copyTranslation()}><Clipboard size={15} />复制</button>
                <button type="button" className="button secondary compact" disabled={!translation} onClick={() => void downloadTranslation()}><Download size={15} />TXT</button>
                <button type="button" className="button secondary compact" disabled={!translation || running} onClick={useTranslationAsSource}><ArrowLeftRight size={15} />译文转原文</button>
              </div>
            </article>
          </section>
        )}

        <div className="translation-primary-actions">
          {task.status === "error" && <p role="alert">{task.message}</p>}
          <span>语义、语气、数字、专名和段落结构会尽量忠实保留；当前版本不复刻文档版式。</span>
          {task.status === "error" && <button type="button" className="button secondary" onClick={() => retryAiTask("translation")}><RotateCcw size={16} />失败重试</button>}
          {translating ? (
            <button type="button" className="button secondary" onClick={() => { cancelAiTask("translation"); showToast("已停止翻译。", "success"); }}><Square size={15} />停止</button>
          ) : (
            <button type="button" className="button primary" disabled={running || !sourceText.trim()} onClick={startTranslation}><Languages size={17} />{translation ? "重新翻译" : "开始翻译"}</button>
          )}
        </div>

        <section className="translation-learning" aria-label="翻译学习总结">
          <header>
            <div>
              <BookOpen size={18} />
              <span>
                <strong>学习总结</strong>
                <small>把翻译历史变成可复用的口语句式和词汇</small>
              </span>
            </div>
            {learningSummary && (
              <div className="translation-summary-header-actions">
                <button type="button" className="button secondary compact" onClick={() => void copyLearningSummary()}><Clipboard size={14} />复制</button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="删除学习总结"
                  disabled={running}
                  onClick={() => {
                    clearTranslationLearningSummary(ownerId);
                    setLearningSummary(null);
                  }}
                >
                  <Trash2 size={15} />
                </button>
              </div>
            )}
          </header>
          <div className="translation-summary-controls">
            <label>
              复盘重点
              <select aria-label="学习总结重点" value={summaryFocus} disabled={running} onChange={(event) => setSummaryFocus(event.target.value as TranslationSummaryFocus)}>
                {Object.entries(TRANSLATION_SUMMARY_FOCUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="translation-summary-theme">
              限定主题（可选）
              <input
                value={summaryTheme}
                maxLength={40}
                disabled={running}
                placeholder="例如：旅行、课堂、日常寒暄"
                onChange={(event) => setSummaryTheme(event.target.value)}
              />
            </label>
            {summarizing ? (
              <button type="button" className="button secondary" onClick={() => { cancelAiTask("translation"); showToast("已停止生成学习总结。", "success"); }}><Square size={15} />停止总结</button>
            ) : (
              <button type="button" className="button primary" disabled={running || history.length < TRANSLATION_SUMMARY_MIN_HISTORY} onClick={startLearningSummary}><Sparkles size={16} />生成总结</button>
            )}
          </div>
          <p className="translation-summary-note">
            {history.length < TRANSLATION_SUMMARY_MIN_HISTORY
              ? `再完成 ${TRANSLATION_SUMMARY_MIN_HISTORY - history.length} 条翻译即可总结。`
              : `将分析最近 ${history.length} 条记录；点击后仅发送每条中英文本的精简片段，并计入翻译助手额度。`}
          </p>
          {learningSummary && (
            <div className="translation-summary-result">
              <header>
                <div>
                  <strong>{learningSummary.title}</strong>
                  <small>
                    {learningSummary.sampleCount} 条记录 · {TRANSLATION_SUMMARY_FOCUS_LABELS[learningSummary.focus]}
                    {learningSummary.theme ? ` · ${learningSummary.theme}` : ""}
                    {" · "}{new Date(learningSummary.createdAt).toLocaleString("zh-CN", { hour12: false })}
                  </small>
                </div>
              </header>
              <p className="translation-summary-overview">{learningSummary.overview}</p>
              {learningSummary.themes.length > 0 && (
                <section>
                  <h4>高频主题</h4>
                  <div className="translation-summary-themes">
                    {learningSummary.themes.map((item) => (
                      <button type="button" key={item.name} title="设为下一次总结主题" onClick={() => setSummaryTheme(item.name)}>
                        <strong>{item.name}</strong>
                        <span>{item.summary}</span>
                      </button>
                    ))}
                  </div>
                </section>
              )}
              {learningSummary.sentencePatterns.length > 0 && (
                <section>
                  <h4>常用句式</h4>
                  <div className="translation-summary-grid">
                    {learningSummary.sentencePatterns.map((item, index) => (
                      <article key={`${item.pattern}-${index}`}>
                        <strong>{item.pattern}</strong>
                        <p>{item.meaning}</p>
                        <small>{item.example}</small>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              {learningSummary.vocabulary.length > 0 && (
                <section>
                  <h4>词汇与搭配</h4>
                  <div className="translation-summary-grid">
                    {learningSummary.vocabulary.map((item, index) => (
                      <article key={`${item.term}-${index}`}>
                        <strong>{item.term}<span>{item.meaning}</span></strong>
                        <p>{item.usage}</p>
                        <small>{item.example}</small>
                      </article>
                    ))}
                  </div>
                </section>
              )}
              {learningSummary.practice.length > 0 && (
                <section>
                  <h4>下一步练习</h4>
                  <ol>{learningSummary.practice.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol>
                </section>
              )}
            </div>
          )}
        </section>

        <section className="translation-history" aria-label="翻译历史">
          <header>
            <div><History size={17} /><strong>最近记录</strong><small>仅保存在当前设备 · {history.length}/{TRANSLATION_HISTORY_LIMIT}</small></div>
            <button type="button" className="button secondary compact" disabled={!history.length || running} onClick={() => { clearTranslationHistory(ownerId); setHistory([]); setLearningSummary(null); }}><Trash2 size={14} />全部删除</button>
          </header>
          {history.length ? history.map((item) => (
            <article key={item.id}>
              <button type="button" onClick={() => openHistoryItem(item)}>
                <strong>{TRANSLATION_DIRECTION_LABELS[item.direction]} · {TRANSLATION_STYLE_LABELS[item.style]}</strong>
                <span>{item.sourceText.replace(/\s+/g, " ").slice(0, 80)}</span>
                <small>{new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</small>
              </button>
              <button type="button" className="icon-button" aria-label={`删除翻译记录 ${item.id}`} disabled={running} onClick={() => setHistory(deleteTranslationHistoryItem(ownerId, item.id))}><Trash2 size={15} /></button>
            </article>
          )) : <p className="muted-note">完成翻译后，最近 {TRANSLATION_HISTORY_LIMIT} 条记录会保存在这台设备。</p>}
        </section>
      </div>
    </Modal>
  );
}
