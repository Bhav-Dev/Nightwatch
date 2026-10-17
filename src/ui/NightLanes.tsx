import { type ReactNode, useState } from 'react';
import { type GestureResponderEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Rect } from 'react-native-svg';

import type { Movement, Span } from '../domain/activity';
import type { AlignedSample, SleepStage } from '../domain/health';
import { durationWords } from '../domain/summary';
import { colors, space } from './theme';

/** Stages from deep (darkest) to awake (warm), so the band reads like the night's depth. */
const STAGE_COLOUR: Record<SleepStage, string> = {
  deep: '#3B45A6',
  light: '#7480D6',
  asleep: '#5A64C0',
  rem: '#BFC8FF',
  awake: '#FF9C8F',
  inbed: 'rgba(191, 200, 255, 0.18)',
};
const STAGE_LEGEND: { stage: SleepStage; label: string }[] = [
  { stage: 'deep', label: 'Deep' },
  { stage: 'light', label: 'Light' },
  { stage: 'rem', label: 'REM' },
  { stage: 'awake', label: 'Awake' },
];
const STRIP_H = 14;

/**
 * Lanes under the timeline, on the same time scale: movement heard in the audio (with restless
 * stretches shaded), when the person was possibly awake, and sleep stages from a watch. Tapping a
 * lane plays the night from that moment. Everything here is an estimate, and labelled as one.
 */
export function NightLanes({
  totalS,
  movements,
  restless,
  awake,
  stages,
  onSeek,
}: {
  /** The timeline's length in seconds, so the lanes line up with it. */
  totalS: number;
  movements: readonly Movement[];
  restless: readonly Span[];
  awake: readonly Span[];
  /** Sleep-stage samples from a watch; empty hides the lane. */
  stages: readonly AlignedSample[];
  onSeek?: (atS: number) => void;
}) {
  const [width, setWidth] = useState(0);
  const x = (s: number) => (Math.max(0, Math.min(totalS, s)) / Math.max(1, totalS)) * width;
  const w = (span: Span) => Math.max(2, x(span.endS) - x(span.startS));
  const seek = (e: GestureResponderEvent) => onSeek?.(Math.round((e.nativeEvent.locationX / Math.max(1, width)) * totalS));
  const hours = Math.max(1, totalS / 3600);
  const awakeS = awake.reduce((s, a) => s + (a.endS - a.startS), 0);
  const staged = stages.filter((s) => s.stage !== null && s.stage !== 'inbed');

  const strip = (label: string, children: ReactNode) => (
    <Pressable onPress={seek} accessibilityRole="button" accessibilityLabel={`${label}. Tap to listen from that time`} disabled={!onSeek}>
      <Svg width={width} height={STRIP_H}>
        <Rect x={0} y={0} width={width} height={STRIP_H} rx={4} fill="rgba(191, 200, 255, 0.06)" />
        {children}
      </Svg>
    </Pressable>
  );

  return (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.lanes}>
      {width > 0 ? (
        <>
          <View style={styles.lane}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Movement</Text>
              <Text style={styles.meta}>
                {movements.length === 0
                  ? 'none heard'
                  : `${movements.length} ${movements.length === 1 ? 'time' : 'times'}, about ${Math.round(movements.length / hours)} an hour${restless.length ? ` · restless ${restless.length === 1 ? 'once' : `${restless.length} times`}` : ''}`}
              </Text>
            </View>
            {strip(
              'Movement',
              <>
                {restless.map((r) => (
                  <Rect key={`r${r.startS}`} x={x(r.startS)} y={0} width={w(r)} height={STRIP_H} rx={3} fill="rgba(246, 200, 95, 0.22)" />
                ))}
                {movements.map((m) => (
                  <Rect key={`m${m.startS}`} x={x(m.startS)} y={2} width={Math.max(2, x(m.endS) - x(m.startS))} height={STRIP_H - 4} rx={1} fill={colors.info} />
                ))}
              </>,
            )}
          </View>

          <View style={styles.lane}>
            <View style={styles.labelRow}>
              <Text style={styles.label}>Possibly awake</Text>
              <Text style={styles.meta}>
                {awake.length === 0 ? 'not that we noticed' : `${awake.length === 1 ? 'once' : `${awake.length} times`}, ${durationWords(awakeS)}`}
              </Text>
            </View>
            {strip(
              'Possibly awake',
              awake.map((a) => <Rect key={`a${a.startS}`} x={x(a.startS)} y={2} width={w(a)} height={STRIP_H - 4} rx={2} fill={colors.worse} opacity={0.8} />),
            )}
          </View>

          {staged.length > 0 ? (
            <View style={styles.lane}>
              <View style={styles.labelRow}>
                <Text style={styles.label}>Sleep stages</Text>
                <Text style={styles.meta}>from your watch</Text>
              </View>
              {strip(
                'Sleep stages from your watch',
                staged.map((s) => <Rect key={`s${s.startS}`} x={x(s.startS)} y={0} width={w(s)} height={STRIP_H} fill={STAGE_COLOUR[s.stage!]} />),
              )}
              <View style={styles.legend}>
                {STAGE_LEGEND.map((l) => (
                  <View key={l.stage} style={styles.legendItem}>
                    <View style={[styles.swatch, { backgroundColor: STAGE_COLOUR[l.stage] }]} />
                    <Text style={styles.meta}>{l.label}</Text>
                  </View>
                ))}
              </View>
            </View>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  lanes: { marginTop: space(4), gap: space(3) },
  lane: { gap: space(1) },
  labelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space(2) },
  label: { color: colors.text, fontSize: 13, fontWeight: '700' },
  meta: { color: colors.textMuted, fontSize: 12 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3), marginTop: space(1) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  swatch: { width: 10, height: 10, borderRadius: 2 },
});
