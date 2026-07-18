import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { focusAudioPublicUrl, listFocusAudioTracks, type FocusAudioKind, type FocusAudioTrack } from "../lib/focusAudio";
import {
  FOCUS_PICTURE_IN_PICTURE_MUTE_EVENT,
  setFocusPictureInPictureAudioMuted
} from "../lib/focusPictureInPicture";

export type FocusAudioPlaybackMode = "list" | "shuffle" | "single";

interface FocusAudioPreferences {
  currentTrackId: string;
  playlistIds: string[];
  playbackMode: FocusAudioPlaybackMode;
  volume: number;
  muted: boolean;
}

interface FocusAudioContextValue {
  tracks: FocusAudioTrack[];
  kind: FocusAudioKind;
  visibleTracks: FocusAudioTrack[];
  currentTrack: FocusAudioTrack | null;
  playlistIds: Set<string>;
  playbackMode: FocusAudioPlaybackMode;
  playing: boolean;
  volume: number;
  muted: boolean;
  currentTime: number;
  duration: number;
  message: string;
  setKind: (kind: FocusAudioKind) => void;
  selectTrack: (trackId: string) => void;
  togglePlayback: () => Promise<void>;
  playPrevious: () => void;
  playNext: () => void;
  setPlaybackMode: (mode: FocusAudioPlaybackMode) => void;
  togglePlaylistTrack: (trackId: string) => void;
  setVolume: (volume: number) => void;
  toggleMuted: () => void;
  seek: (seconds: number) => void;
}

const STORAGE_KEY = "focus-audio-preferences-v1";
const FocusAudioContext = createContext<FocusAudioContextValue | null>(null);

export function FocusAudioProvider({ children }: { children: ReactNode }) {
  const initial = useMemo(loadPreferences, []);
  const audioRef = useRef<HTMLAudioElement>(null);
  const resumeAfterTrackChangeRef = useRef(false);
  const [tracks, setTracks] = useState<FocusAudioTrack[]>([]);
  const [kind, setKindState] = useState<FocusAudioKind>("white_noise");
  const [currentTrackId, setCurrentTrackId] = useState(initial.currentTrackId);
  const [playlistIds, setPlaylistIds] = useState<Set<string>>(() => new Set(initial.playlistIds));
  const [playbackMode, setPlaybackMode] = useState<FocusAudioPlaybackMode>(initial.playbackMode);
  const [playing, setPlaying] = useState(false);
  const [volume, setVolumeState] = useState(initial.volume);
  const [muted, setMuted] = useState(initial.muted);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [message, setMessage] = useState("");
  const visibleTracks = useMemo(() => tracks.filter((track) => track.kind === kind), [kind, tracks]);
  const currentTrack = tracks.find((track) => track.id === currentTrackId) ?? null;
  const queue = useMemo(() => tracks.filter((track) => playlistIds.has(track.id)), [playlistIds, tracks]);

  useEffect(() => {
    let active = true;
    void listFocusAudioTracks()
      .then((items) => {
        if (!active) return;
        setTracks(items);
        setPlaylistIds((current) => {
          const valid = new Set(items.filter((track) => current.has(track.id)).map((track) => track.id));
          return valid.size ? valid : new Set(items.map((track) => track.id));
        });
        setCurrentTrackId((current) => items.some((track) => track.id === current) ? current : items[0]?.id ?? "");
      })
      .catch((error) => active && setMessage(error instanceof Error ? error.message : "音频读取失败。"));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.volume = volume / 100;
    audio.muted = muted;
    setFocusPictureInPictureAudioMuted(muted);
  }, [muted, volume]);

  useEffect(() => {
    const handlePictureInPictureMute = (event: Event) => {
      setMuted(Boolean((event as CustomEvent<boolean>).detail));
    };
    window.addEventListener(FOCUS_PICTURE_IN_PICTURE_MUTE_EVENT, handlePictureInPictureMute);
    return () => window.removeEventListener(FOCUS_PICTURE_IN_PICTURE_MUTE_EVENT, handlePictureInPictureMute);
  }, []);

  useLayoutEffect(() => {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    setCurrentTime(0);
    setDuration(0);
    audio.load();
    if (!resumeAfterTrackChangeRef.current) return;
    resumeAfterTrackChangeRef.current = false;
    void audio.play().catch(() => setMessage("浏览器阻止了连续播放，请再次点击播放。"));
  }, [currentTrack?.id]);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      currentTrackId,
      playlistIds: Array.from(playlistIds),
      playbackMode,
      volume,
      muted
    } satisfies FocusAudioPreferences));
  }, [currentTrackId, muted, playbackMode, playlistIds, volume]);

  function changeTrack(trackId: string, forcePlay = false) {
    if (!tracks.some((track) => track.id === trackId)) return;
    const audio = audioRef.current;
    resumeAfterTrackChangeRef.current = forcePlay || Boolean(audio && !audio.paused);
    setCurrentTrackId(trackId);
    setPlaylistIds((current) => current.has(trackId) ? current : new Set([...current, trackId]));
    const track = tracks.find((item) => item.id === trackId);
    if (track) setKindState(track.kind);
  }

  function moveTrack(direction: -1 | 1, forcePlay = false) {
    const activeQueue = queue.length ? queue : tracks;
    if (!activeQueue.length) return;
    if (playbackMode === "shuffle" && activeQueue.length > 1) {
      const candidates = activeQueue.filter((track) => track.id !== currentTrackId);
      changeTrack(candidates[Math.floor(Math.random() * candidates.length)].id, forcePlay);
      return;
    }
    const index = Math.max(0, activeQueue.findIndex((track) => track.id === currentTrackId));
    const nextIndex = (index + direction + activeQueue.length) % activeQueue.length;
    if (activeQueue[nextIndex].id === currentTrackId) {
      const audio = audioRef.current;
      if (audio) audio.currentTime = 0;
      if (forcePlay && audio) void audio.play();
      return;
    }
    changeTrack(activeQueue[nextIndex].id, forcePlay);
  }

  async function togglePlayback() {
    const audio = audioRef.current;
    if (!audio || !currentTrack) return;
    if (!audio.paused) {
      audio.pause();
      return;
    }
    try {
      await audio.play();
      setMessage("");
    } catch {
      setMessage("浏览器阻止了播放，请再次点击播放。");
    }
  }

  function changeKind(nextKind: FocusAudioKind) {
    setKindState(nextKind);
    if (currentTrack?.kind === nextKind) return;
    const nextTrack = tracks.find((track) => track.kind === nextKind && playlistIds.has(track.id))
      ?? tracks.find((track) => track.kind === nextKind);
    if (nextTrack) changeTrack(nextTrack.id);
  }

  function togglePlaylistTrack(trackId: string) {
    setPlaylistIds((current) => {
      const next = new Set(current);
      if (next.has(trackId)) {
        if (next.size === 1) return current;
        next.delete(trackId);
      } else {
        next.add(trackId);
      }
      return next;
    });
  }

  function seek(seconds: number) {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(seconds)) return;
    audio.currentTime = Math.max(0, Math.min(seconds, duration || 0));
    setCurrentTime(audio.currentTime);
  }

  const value: FocusAudioContextValue = {
    tracks,
    kind,
    visibleTracks,
    currentTrack,
    playlistIds,
    playbackMode,
    playing,
    volume,
    muted,
    currentTime,
    duration,
    message,
    setKind: changeKind,
    selectTrack: (trackId) => changeTrack(trackId),
    togglePlayback,
    playPrevious: () => moveTrack(-1),
    playNext: () => moveTrack(1),
    setPlaybackMode,
    togglePlaylistTrack,
    setVolume: (nextVolume) => setVolumeState(Math.max(0, Math.min(100, nextVolume))),
    toggleMuted: () => setMuted((current) => !current),
    seek
  };

  return (
    <FocusAudioContext.Provider value={value}>
      {children}
      <audio
        ref={audioRef}
        className="focus-audio-engine"
        src={currentTrack ? focusAudioPublicUrl(currentTrack.storage_path) : undefined}
        preload="metadata"
        loop={playbackMode === "single"}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onEnded={() => moveTrack(1, true)}
        onError={() => setMessage("音频加载失败，请切换曲目后重试。")}
      />
    </FocusAudioContext.Provider>
  );
}

export function useFocusAudio(): FocusAudioContextValue {
  const context = useContext(FocusAudioContext);
  if (!context) throw new Error("useFocusAudio must be used inside FocusAudioProvider.");
  return context;
}

function loadPreferences(): FocusAudioPreferences {
  const fallback: FocusAudioPreferences = {
    currentTrackId: "",
    playlistIds: [],
    playbackMode: "list",
    volume: 45,
    muted: false
  };
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<FocusAudioPreferences>;
    return {
      currentTrackId: typeof stored.currentTrackId === "string" ? stored.currentTrackId : "",
      playlistIds: Array.isArray(stored.playlistIds) ? stored.playlistIds.filter((id): id is string => typeof id === "string") : [],
      playbackMode: stored.playbackMode === "shuffle" || stored.playbackMode === "single" ? stored.playbackMode : "list",
      volume: Number.isFinite(stored.volume) ? Math.max(0, Math.min(100, Number(stored.volume))) : 45,
      muted: Boolean(stored.muted)
    };
  } catch {
    return fallback;
  }
}
