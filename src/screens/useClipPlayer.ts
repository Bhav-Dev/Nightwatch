import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

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
  const onFinished = useRef(opts.onFinished);

  useEffect(() => {
    onFinished.current = opts.onFinished;
    currentRef.current = current;
  });

  // Told when a file plays to its end, from the player's own events.
  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (s) => {
      if (s.didJustFinish && currentRef.current) onFinished.current?.(currentRef.current);
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

  const toggle = useCallback(
    (uri: string) => {
      if (current === uri && status.playing) {
        player.pause();
        return;
      }
      if (current !== uri) {
        player.replace({ uri });
        setCurrent(uri);
      } else if (status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.05)) {
        void player.seekTo(0);
      }
      player.play();
    },
    [current, player, status],
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
      player.play();
    },
    [current, player],
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
