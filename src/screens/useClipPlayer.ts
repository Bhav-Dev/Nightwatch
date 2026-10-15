import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useState } from 'react';

/** One clip plays at a time; tapping the playing clip pauses it, and stop() ends it. */
export function useClipPlayer() {
  const player = useAudioPlayer(null);
  const status = useAudioPlayerStatus(player);
  const [current, setCurrent] = useState<string | null>(null);

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

  const stop = useCallback(() => {
    player.pause();
    void player.seekTo(0);
    setCurrent(null);
  }, [player]);

  return {
    toggle,
    stop,
    playingUri: status.playing ? current : null,
    /** Seconds into the playing clip, and its length (0 until loaded). */
    positionS: status.currentTime,
    durationS: status.duration,
  };
}
