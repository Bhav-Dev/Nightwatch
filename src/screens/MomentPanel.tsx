import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { clockTimeAt } from '../domain/interruption';
import type { Moment } from '../domain/moments';
import { intensityFor } from '../domain/scoring';
import { Button, Small } from '../ui/kit';
import { SnoringToggle } from '../ui/SnoringToggle';
import { colors, radius, space } from '../ui/theme';

function describe(m: Moment): string {
  if (m.kind === 'snore') return m.answered ? 'Snoring, as you said' : `Snoring${m.peakDb !== null ? `, ${intensityFor(m.peakDb)}` : ''}`;
  if (m.kind === 'other') return m.answered ? 'Not snoring, as you said' : 'Loud, not counted as snoring';
  return 'Sound';
}

const length = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/**
 * The picked moment under the timeline: previous and next, play, and the Snoring answer.
 */
export function MomentPanel({
  startedAtS,
  moments,
  moment,
  focusS,
  playing,
  busy,
  onStep,
  onPlay,
  onAnswer,
  onUndo,
}: {
  startedAtS: number;
  moments: readonly Moment[];
  /** The moment at the playhead or the picked second, if there is one. */
  moment: Moment | null;
  focusS: number | null;
  playing: boolean;
  busy: boolean;
  onStep: (direction: 1 | -1) => void;
  onPlay: () => void;
  onAnswer: (snoring: boolean) => void;
  onUndo: () => void;
}) {
  if (moments.length === 0) return null;
  const index = moment ? moments.indexOf(moment) : -1;
  const hasPrev = focusS === null ? false : moments.some((m) => m.startS < (moment ? moment.startS : focusS));
  const hasNext = focusS === null ? true : moments.some((m) => m.startS > focusS);
  return (
    <View style={styles.panel}>
      <View style={styles.row}>
        <Pressable
          onPress={() => onStep(-1)}
          disabled={!hasPrev}
          accessibilityRole="button"
          accessibilityLabel="Previous moment"
          style={[styles.arrow, !hasPrev && styles.disabled]}
          hitSlop={6}
        >
          <Ionicons name="chevron-back" size={22} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }} accessibilityLiveRegion="polite">
          {moment ? (
            <>
              <Text style={styles.title}>
                {clockTimeAt(startedAtS, moment.startS)} · {describe(moment)}
              </Text>
              <Small>
                {index + 1} of {moments.length} · {length(moment.endS - moment.startS)}
              </Small>
            </>
          ) : focusS !== null ? (
            <>
              <Text style={styles.title}>{clockTimeAt(startedAtS, focusS)} · quiet</Text>
              <Small>Use the arrows to go to the next sound.</Small>
            </>
          ) : (
            <>
              <Text style={styles.title}>{moments.length === 1 ? '1 moment' : `${moments.length} moments`} last night</Text>
              <Small>Step through them with the arrows, or drag along the timeline.</Small>
            </>
          )}
        </View>
        {moment ? (
          <Pressable onPress={onPlay} accessibilityRole="button" accessibilityLabel={playing ? 'Pause' : 'Play this moment'} style={styles.play}>
            <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.text} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => onStep(1)}
          disabled={!hasNext}
          accessibilityRole="button"
          accessibilityLabel="Next moment"
          style={[styles.arrow, !hasNext && styles.disabled]}
          hitSlop={6}
        >
          <Ionicons name="chevron-forward" size={22} color={colors.text} />
        </Pressable>
      </View>
      {moment ? (
        <View style={[styles.row, { marginTop: space(3) }]}>
          <SnoringToggle snoring={moment.kind === 'snore'} onPress={() => onAnswer(moment.kind !== 'snore')} disabled={busy} />
          <Small style={{ flex: 1 }}>{moment.answered ? 'Thanks, your night has been updated.' : 'Was this snoring? Your answer corrects the night.'}</Small>
          {moment.answered ? <Button kind="link" label="Undo" onPress={onUndo} /> : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { marginTop: space(3), padding: space(3), borderRadius: radius.button, backgroundColor: colors.surfaceRaised },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  arrow: { width: 36, height: 40, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700' },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});
