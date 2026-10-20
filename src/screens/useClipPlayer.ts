import { type AudioPlayer, type AudioStatus, createAudioPlayer, setAudioModeAsync, setIsAudioActiveAsync } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import { logPlayback } from '../native/playbackLog';

/**
 * Listening back plays whether or not the phone is on silent, as the recording did. A mode that
 * leaves this out can make play() do nothing on a silenced phone (Android ignores the call), so
 * the mode is always set in full.
 */
const PLAYBACK_MODE = { playsInSilentMode: true, shouldPlayInBackground: false, allowsRecording: false } as const;
/** How long a play request may take to start before it is tried again on a new player. */
const RETRY_AFTER_MS = 1200;

const describe = (s: AudioStatus | null | undefined) =>
  s
    ? `loaded ${s.isLoaded}, playing ${s.playing}, state ${s.playbackState || '-'}, control ${s.timeControlStatus || '-'}, waiting ${s.reasonForWaitingToPlay || '-'}${'error' in s ? `, error ${String((s as { error?: unknown }).error)}` : ''}`
    : 'no status';
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** play() can throw on iOS (the audio session would not start); that is logged, not raised. */
function tryPlay(p: AudioPlayer, what: string) {
  try {
    p.play();
  } catch (e) {
    logPlayback(`${what}: play failed: ${message(e)}`);
  }
}

/**
 * One sound plays at a time: a clip (tapping the playing clip pauses it) or a stretch of the
 * night's recorded sound, from any point in it. stop() ends whatever is playing.
 *
 * Each file gets a new player when it starts. A player that had lived through a night's recording
 * stayed silent afterwards until the app restarted (on Android and on iPhone), so none is kept
 * that long. If a play request still has not started a moment later, audio is switched back on,
 * the playback mode is set again, and a new player tries once more. What went wrong is kept for
 * Settings in test builds (playbackLog).
 */
export function useClipPlayer(opts: { onFinished?: (uri: string) => void } = {}) {
  const player = useRef<AudioPlayer | null>(null);
  const subscription = useRef<{ remove(): void } | null>(null);
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  /** The file the player has, set as soon as it changes (state catches up on the next render). */
  const currentRef = useRef<string | null>(null);
  /** A position asked for before the file had loaded; applied once it has. */
  const pendingSeek = useRef<number | null>(null);
  const playingRef = useRef(false);
  /** What the user last asked for: playing this file, or nothing (paused or stopped). */
  const wanted = useRef<string | null>(null);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onFinished = useRef(opts.onFinished);

  useEffect(() => {
    onFinished.current = opts.onFinished;
    playingRef.current = status?.playing ?? false;
  });

  const clearRetry = useCallback(() => {
    if (retry.current) clearTimeout(retry.current);
    retry.current = null;
  }, []);

  const release = useCallback(() => {
    subscription.current?.remove();
    subscription.current = null;
    player.current?.remove();
    player.current = null;
  }, []);

  // The mode is set when the screen opens, so one left over from the night's recording cannot
  // block play(); the player goes when it closes.
  useEffect(() => {
    setAudioModeAsync(PLAYBACK_MODE).catch(() => undefined);
    return () => {
      clearRetry();
      release();
    };
  }, [clearRetry, release]);

  /** A new player for `uri` in place of the last one, starting `fromS` seconds in once loaded. */
  const open = useCallback(
    (uri: string, fromS: number): AudioPlayer => {
      release();
      const p = createAudioPlayer({ uri });
      pendingSeek.current = fromS > 0 ? fromS : null;
      subscription.current = p.addListener('playbackStatusUpdate', (s) => {
        if (player.current !== p) return;
        setStatus(s);
        if (s.isLoaded && pendingSeek.current !== null) {
          const at = pendingSeek.current;
          pendingSeek.current = null;
          void p.seekTo(at);
        }
        if (s.didJustFinish) {
          wanted.current = null;
          onFinished.current?.(uri);
        }
      });
      player.current = p;
      currentRef.current = uri;
      setCurrent(uri);
      setStatus(p.currentStatus);
      return p;
    },
    [release],
  );

  /**
   * Starts playback. If it has not started a moment later (the call was ignored), and the user
   * still wants it, audio is switched back on and a new player tries from the same point.
   */
  const start = useCallback(
    (uri: string) => {
      const p = player.current;
      if (!p) return;
      wanted.current = uri;
      tryPlay(p, 'play');
      clearRetry();
      retry.current = setTimeout(() => {
        retry.current = null;
        if (wanted.current !== uri || currentRef.current !== uri || playingRef.current) return;
        logPlayback(`not playing after ${RETRY_AFTER_MS} ms (${describe(p.currentStatus)}); trying a new player`);
        const at = pendingSeek.current ?? p.currentTime;
        void (async () => {
          await setIsAudioActiveAsync(true).catch((e: unknown) => logPlayback(`audio on failed: ${message(e)}`));
          await setAudioModeAsync(PLAYBACK_MODE).catch((e: unknown) => logPlayback(`mode failed: ${message(e)}`));
          if (wanted.current !== uri || currentRef.current !== uri) return;
          const fresh = open(uri, at);
          tryPlay(fresh, 'retry');
          setTimeout(() => {
            if (player.current === fresh && wanted.current === uri && !fresh.playing) {
              logPlayback(`still not playing (${describe(fresh.currentStatus)})`);
            }
          }, RETRY_AFTER_MS);
        })();
      }, RETRY_AFTER_MS);
    },
    [clearRetry, open],
  );

  const toggle = useCallback(
    (uri: string) => {
      const p = player.current;
      if (p && currentRef.current === uri && status?.playing) {
        wanted.current = null;
        clearRetry();
        p.pause();
        return;
      }
      if (!p || currentRef.current !== uri) {
        open(uri, 0);
      } else if (status && (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05))) {
        void p.seekTo(0);
      }
      start(uri);
    },
    [clearRetry, open, start, status],
  );

  /** Plays `uri` from `fromS` seconds in. */
  const play = useCallback(
    (uri: string, fromS = 0) => {
      const p = player.current;
      if (!p || currentRef.current !== uri) open(uri, fromS);
      else void p.seekTo(fromS);
      start(uri);
    },
    [open, start],
  );

  /** Jumps back or forward within what is playing. */
  const seekBy = useCallback(
    (deltaS: number) => {
      const p = player.current;
      if (!p || !status) return;
      const max = status.duration > 0 ? status.duration : Number.MAX_SAFE_INTEGER;
      void p.seekTo(Math.min(max, Math.max(0, status.currentTime + deltaS)));
    },
    [status],
  );

  const stop = useCallback(() => {
    wanted.current = null;
    clearRetry();
    release();
    pendingSeek.current = null;
    currentRef.current = null;
    setCurrent(null);
    setStatus(null);
  }, [clearRetry, release]);

  return {
    toggle,
    play,
    seekBy,
    stop,
    playingUri: status?.playing ? current : null,
    /** Seconds into what is playing, and its length (0 until loaded). */
    positionS: status?.currentTime ?? 0,
    durationS: status?.duration ?? 0,
  };
}
