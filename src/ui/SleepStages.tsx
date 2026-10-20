import { useState } from 'react';
import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import type { AlignedSample, SleepStage } from '../domain/health';
import { colors, momentColor, space } from './theme';

/** Stages from deep (darkest) to awake (the timeline's possibly-awake colour), so the strip reads like the night's depth. */
const STAGE_COLOUR: Record<SleepStage, string> = {
  deep: '#3B45A6',
  light: '#7480D6',
  asleep: '#5A64C0',
  rem: '#BFC8FF',
  awake: momentColor.awake,
  inbed: 'rgba(191, 200, 255, 0.18)',
};
const STAGE_LEGEND: { stage: SleepStage; label: string }[] = [
  { stage: 'deep', label: 'Deep' },
  { stage: 'light', label: 'Light' },
  { stage: 'rem', label: 'REM' },
  { stage: 'awake', label: 'Awake' },
];
const STRIP_H = 12;

/**
 * Sleep stages from a watch, on the timeline's time scale, under it. Tapping the strip plays the
 * night from that moment. Nothing is drawn when the watch gave no stages.
 */
export function SleepStages({ totalS, stages, onSeek }: { totalS: number; stages: readonly AlignedSample[]; onSeek?: (atS: number) => void }) {
  const [width, setWidth] = useState(0);
  const staged = stages.filter((s) => s.stage !== null && s.stage !== 'inbed');
  if (staged.length === 0) return null;
  const x = (s: number) => (Math.max(0, Math.min(totalS, s)) / Math.max(1, totalS)) * width;
  const seek = (e: GestureResponderEvent) => onSeek?.(Math.round((e.nativeEvent.locationX / Math.max(1, width)) * totalS));
  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.wrap}>
      {width > 0 ? (
        <Pressable onPress={seek} disabled={!onSeek} accessibilityRole="button" accessibilityLabel="Sleep stages from your watch. Tap to listen from that time">
          <Svg width={width} height={STRIP_H}>
            <Rect x={0} y={0} width={width} height={STRIP_H} rx={4} fill="rgba(191, 200, 255, 0.08)" />
            {staged.map((s) => (
              <Rect key={`s${s.startS}`} x={x(s.startS)} y={0} width={Math.max(2, x(s.endS) - x(s.startS))} height={STRIP_H} fill={STAGE_COLOUR[s.stage!]} />
            ))}
          </Svg>
        </Pressable>
      ) : null}
      <View style={styles.legend}>
        <Text style={styles.meta}>Sleep stages from your watch</Text>
        {STAGE_LEGEND.map((l) => (
          <View key={l.stage} style={styles.legendItem}>
            <View style={[styles.swatch, { backgroundColor: STAGE_COLOUR[l.stage] }]} />
            <Text style={styles.meta}>{l.label}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space(3), gap: space(1.5) },
  legend: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: space(3), rowGap: space(1) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  meta: { color: colors.textMuted, fontSize: 12 },
});
