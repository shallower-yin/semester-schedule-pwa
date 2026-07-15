import { Music2, Pause, Play, Volume2, Waves } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { focusAudioPublicUrl, listFocusAudioTracks, type FocusAudioKind, type FocusAudioTrack } from "../lib/focusAudio";

export function FocusAudioPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [tracks, setTracks] = useState<FocusAudioTrack[]>([]);
  const [kind, setKind] = useState<FocusAudioKind>("white_noise");
  const [selectedId, setSelectedId] = useState("");
  const [playing, setPlaying] = useState(false);
  const [volume, setVolume] = useState(45);
  const [message, setMessage] = useState("");
  const visibleTracks = useMemo(() => tracks.filter((track) => track.kind === kind), [kind, tracks]);
  const selected = visibleTracks.find((track) => track.id === selectedId) ?? visibleTracks[0];

  useEffect(() => {
    let active = true;
    void listFocusAudioTracks()
      .then((items) => {
        if (!active) return;
        setTracks(items);
      })
      .catch((error) => active && setMessage(error instanceof Error ? error.message : "音频读取失败。"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (selected && selected.id !== selectedId) setSelectedId(selected.id);
  }, [selected?.id, selectedId]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
  }, [volume]);

  useEffect(() => {
    setPlaying(false);
    audioRef.current?.pause();
  }, [kind, selectedId]);

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !selected) return;
    if (!audio.paused) {
      audio.pause();
      setPlaying(false);
      return;
    }
    try {
      await audio.play();
      setPlaying(true);
      setMessage("");
    } catch {
      setMessage("浏览器阻止了播放，请再次点击播放。");
    }
  }

  return (
    <section className="focus-audio-panel">
      <div className="focus-section-heading">
        <div><h2><Waves size={18} />专注声音</h2><p>管理员提供的音频将在线播放，不占用数据库文件空间。</p></div>
        <div className="segmented-control" aria-label="音频分类">
          <button className={kind === "white_noise" ? "active" : ""} onClick={() => setKind("white_noise")}><Waves size={15} />白噪音</button>
          <button className={kind === "music" ? "active" : ""} onClick={() => setKind("music")}><Music2 size={15} />音乐</button>
        </div>
      </div>
      {selected ? (
        <div className="focus-audio-controls">
          <button className="icon-button focus-audio-play" aria-label={playing ? "暂停音频" : "播放音频"} onClick={() => void togglePlayback()}>
            {playing ? <Pause size={20} /> : <Play size={20} />}
          </button>
          <label>音频<select aria-label="选择专注音频" value={selected.id} onChange={(event) => setSelectedId(event.target.value)}>{visibleTracks.map((track) => <option key={track.id} value={track.id}>{track.title}</option>)}</select></label>
          <label className="focus-volume"><Volume2 size={17} /><input aria-label="音量" type="range" min={0} max={100} value={volume} onChange={(event) => setVolume(Number(event.target.value))} /><span>{volume}%</span></label>
          <audio ref={audioRef} src={focusAudioPublicUrl(selected.storage_path)} loop preload="none" onPause={() => setPlaying(false)} onPlay={() => setPlaying(true)} />
        </div>
      ) : <p className="muted-note">管理员暂未发布{kind === "white_noise" ? "白噪音" : "音乐"}。</p>}
      {message && <p className="auth-message error">{message}</p>}
    </section>
  );
}
