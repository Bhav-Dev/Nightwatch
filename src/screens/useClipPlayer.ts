import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useState } from 'react';

/** One clip plays at a time; tapping the playing clip pauses it. */
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

  return { toggle, playingUri: status.playing ? current : null };
}
