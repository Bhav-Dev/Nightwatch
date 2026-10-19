import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Listening back plays whether or not the phone is on silent, as the recording did. A mode that
 * leaves this out can make play() do nothing on a silenced phone (Android ignores the call), so
 * the mode is always set in full.
 */
const PLAYBACK_MODE = { playsInSilentMode: true, shouldPlayInBackground: false, allowsRecording: false } as const;
/** How long a play request may take to start before the mode is set again and it is retried. */
const RETRY_AFTER_MS = 1200;

/**
 * One sound plays at a time: a clip (tapping the playing clip pauses it) or a stretch of the
 * night's recorded sound, from any point in it. stop() ends whatever is playing.
 */
export function useClipPlayer(opts: { onFinished?: (uri: string) => void } = {}) {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);
  /** A position asked for before the file had loaded; applied once it has. */
  const pendingSeek = useRef<number | null>(null);
  const currentRef = useRef<string | null>(null);
  const playingRef = useRef(false);
  /** What the user last asked for: playing this file, or nothing (paused or stopped). */
  const wanted = useRef<string | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinished = useRef(opts.onFinished);

  // Set when the screen opens, so a mode left over from the night's recording cannot block play().
  useEffect(() => {
    setAudioModeAsync(PLAYBACK_MODE).catch(() => undefined);
    return () => {
      if (retry.current) clearTimeout(retry.current);
    };
  }, []);

  useEffect(() => {
    onFinished.current = opts.onFinished;
    currentRef.current = current;
    playingRef.current = status.playing;
  });

  // Told when a file plays to its end, from the player's own events.
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish && currentRef.current) {
        wanted.current = null;
        onFinished.current?.(currentRef.current);
      }
    });
    return () => sub.remove();
  }, [player]);

  useEffect(() => {
    if (status.isLoaded && pendingSeek.current !== null) {
      const at = pendingSeek.current;
      pendingSeek.current = null;
      void player.seekTo(at);
    }
  }, [status.isLoaded, player]);

  /**
   * Starts playback, and if it has not started a moment later (the call was ignored), sets the
   * playback mode again and tries once more, unless the user has paused or moved on since.
   */
  const start = useCallback(
    (uri: string) => {
      wanted.current = uri;
      player.play();
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => {
        if (wanted.current !== uri || currentRef.current !== uri || playingRef.current) return;
        setAudioModeAsync(PLAYBACK_MODE)
          .then(() => {
            if (wanted.current === uri && !playingRef.current) player.play();
          })
          .catch(() => undefined);
      }, RETRY_AFTER_MS);
    },
    [player],
  );

  const toggle = useCallback(
    (uri: string) => {
      if (current === uri && status.playing) {
        wanted.current = null;
        player.pause();
        return;
      }
      if (current !== uri) {
        player.replace({ uri });
        setCurrent(uri);
      } else if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05)) {
        void player.seekTo(0);
      }
      start(uri);
    },
    [current, player, status, start],
  );

  /** Plays `uri` from `fromS` seconds in. */
  const play = useCallback(
    (uri: string, fromS = 0) => {
      if (current !== uri) {
        player.replace({ uri });
        setCurrent(uri);
        pendingSeek.current = fromS > 0 ? fromS : null;
      } else {
        void player.seekTo(fromS);
      }
      start(uri);
    },
    [current, player, start],
  );

  /** Jumps back or forward within what is playing. */
  const seekBy = useCallback(
    (deltaS: number) => {
      const max = status.duration > 0 ? status.duration : Number.MAX_SAFE_INTEGER;
      void player.seekTo(Math.min(max, Math.max(0, status.currentTime + deltaS)));
    },
    [player, status.currentTime, status.duration],
  );

  const stop = useCallback(() => {
    wanted.current = null;
    player.pause();
    void player.seekTo(0);
    pendingSeek.current = null;
    setCurrent(null);
  }, [player]);

  return {
    toggle,
    play,
    seekBy,
    stop,
    playingUri: status.playing ? current : null,
    /** Seconds into what is playing, and its length (0 until loaded). */
    positionS: status.currentTime,
    durationS: status.duration,
  };
}
