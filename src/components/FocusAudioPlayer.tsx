import {
  ChevronLeft,
  ChevronRight,
  ListMusic,
  Music2,
  Pause,
  Play,
  Repeat1,
  Shuffle,
  Volume2,
  VolumeX,
  Waves
} from "lucide-react";
import { useFocusAudio, type FocusAudioPlaybackMode } from "./FocusAudioProvider";

const PLAYBACK_MODES: Array<{ id: FocusAudioPlaybackMode; label: string; icon: typeof ListMusic }> = [
  { id: "list", label: "列表循环", icon: ListMusic },
  { id: "shuffle", label: "随机播放", icon: Shuffle },
  { id: "single", label: "单曲循环", icon: Repeat1 }
];

export function FocusAudioPlayer() {
  const audio = useFocusAudio();
  const selectedTrackId = audio.visibleTracks.some((track) => track.id === audio.currentTrack?.id)
    ? audio.currentTrack?.id ?? ""
    : audio.visibleTracks[0]?.id ?? "";

  return (
    <section className="focus-audio-panel">
      <div className="focus-section-heading">
        <div><h2><Waves size={18} />专注声音</h2><p>离开专注页后继续播放，手动暂停后才会停止。</p></div>
        <div className="segmented-control" aria-label="音频分类">
          <button className={audio.kind === "white_noise" ? "active" : ""} onClick={() => audio.setKind("white_noise")}><Waves size={15} />白噪音</button>
          <button className={audio.kind === "music" ? "active" : ""} onClick={() => audio.setKind("music")}><Music2 size={15} />音乐</button>
        </div>
      </div>

      {audio.visibleTracks.length ? (
        <>
          <div className="focus-audio-controls">
            <div className="focus-audio-transport" aria-label="播放控制">
              <button className="icon-button" aria-label="上一首" title="上一首" onClick={audio.playPrevious}><ChevronLeft size={18} /></button>
              <button className="icon-button focus-audio-play" aria-label={audio.playing ? "暂停音频" : "播放音频"} onClick={() => void audio.togglePlayback()}>
                {audio.playing ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button className="icon-button" aria-label="下一首" title="下一首" onClick={audio.playNext}><ChevronRight size={18} /></button>
            </div>

            <label className="focus-audio-track-select">当前音频
              <select aria-label="选择专注音频" value={selectedTrackId} onChange={(event) => audio.selectTrack(event.target.value)}>
                {audio.visibleTracks.map((track) => <option key={track.id} value={track.id}>{track.title}</option>)}
              </select>
            </label>

            <div className="segmented-control focus-playback-modes" aria-label="播放模式">
              {PLAYBACK_MODES.map((mode) => {
                const Icon = mode.icon;
                return <button key={mode.id} className={audio.playbackMode === mode.id ? "active" : ""} aria-pressed={audio.playbackMode === mode.id} title={mode.label} onClick={() => audio.setPlaybackMode(mode.id)}><Icon size={15} /><span>{mode.label}</span></button>;
              })}
            </div>
          </div>

          <div className="focus-audio-progress">
            <span>{formatAudioTime(audio.currentTime)}</span>
            <input aria-label="播放进度" type="range" min={0} max={Math.max(0, audio.duration)} step={0.1} value={Math.min(audio.currentTime, audio.duration || 0)} disabled={!audio.duration} onChange={(event) => audio.seek(Number(event.target.value))} />
            <span>{formatAudioTime(audio.duration)}</span>
          </div>

          <div className="focus-audio-lower-controls">
            <div className="focus-volume">
              <button className="icon-button" aria-label={audio.muted ? "恢复声音" : "静音"} title={audio.muted ? "恢复声音" : "静音"} onClick={audio.toggleMuted}>{audio.muted ? <VolumeX size={17} /> : <Volume2 size={17} />}</button>
              <input aria-label="音量" type="range" min={0} max={100} value={audio.volume} onChange={(event) => audio.setVolume(Number(event.target.value))} />
              <span>{audio.muted ? "静音" : `${audio.volume}%`}</span>
            </div>

            <details className="focus-playlist-picker">
              <summary><ListMusic size={16} />播放列表（{audio.visibleTracks.filter((track) => audio.playlistIds.has(track.id)).length}/{audio.visibleTracks.length}）</summary>
              <div>
                {audio.visibleTracks.map((track) => (
                  <label key={track.id}>
                    <input type="checkbox" checked={audio.playlistIds.has(track.id)} onChange={() => audio.togglePlaylistTrack(track.id)} />
                    <span>{track.title}</span>
                  </label>
                ))}
              </div>
            </details>
          </div>
        </>
      ) : <p className="muted-note">管理员暂未发布{audio.kind === "white_noise" ? "白噪音" : "音乐"}。</p>}

      {audio.kind === "music" && <p className="focus-music-disclaimer">音乐仅供个人专注播放，请勿传播或用于商业用途。</p>}
      {audio.message && <p className="auth-message error">{audio.message}</p>}
    </section>
  );
}

function formatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const whole = Math.floor(seconds);
  const minutes = Math.floor(whole / 60);
  return `${String(minutes).padStart(2, "0")}:${String(whole % 60).padStart(2, "0")}`;
}
