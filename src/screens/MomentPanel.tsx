import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { clockTimeAt } from '../domain/interruption';
import type { Moment } from '../domain/moments';
import { intensityFor } from '../domain/scoring';
import { Button, Small } from '../ui/kit';
import { MomentSwatch } from '../ui/MomentFilter';
import { SnoringToggle } from '../ui/SnoringToggle';
import { colors, radius, space } from '../ui/theme';

/** What a moment was, in a few words. */
export function describeMoment(m: Moment): string {
  switch (m.kind) {
    case 'snore':
      return m.answered ? 'Snoring, as you said' : `Snoring${m.peakDb !== null ? `, ${intensityFor(m.peakDb)}` : ''}`;
    case 'other':
      return m.answered ? 'Not snoring, as you said' : 'Loud, not counted as snoring';
    case 'move':
      return 'Movement';
    case 'awake':
      return 'Possibly awake';
    default:
      return 'Sound';
  }
}

export const momentLength = (s: number) => (s < 90 ? `${Math.round(s)} s` : `${Math.round(s / 60)} min`);

/**
 * The picked moment under the timeline: previous and next through the kinds shown, play, and the
 * Snoring answer for snoring and other sounds.
 */
export function MomentPanel({
  startedAtS,
  moments,
  moment,
  focusS,
  heard,
  playing,
  busy,
  pendingSnoring = null,
  onStep,
  onPlay,
  onAnswer,
  onUndo,
}: {
  startedAtS: number;
  /** The moments of the kinds shown, in order. */
  moments: readonly Moment[];
  /** The shown moment at the playhead or the picked second, if there is one. */
  moment: Moment | null;
  focusS: number | null;
  /** The picked second has recorded sound, though no shown moment. */
  heard: boolean;
  playing: boolean;
  busy: boolean;
  /** The answer being saved for this moment, shown at once. */
  pendingSnoring?: boolean | null;
  onStep: (direction: 1 | -1) => void;
  onPlay: () => void;
  onAnswer: (snoring: boolean) => void;
  onUndo: () => void;
}) {
  if (moments.length === 0) return null;
  const index = moment ? moments.indexOf(moment) : -1;
  const hasPrev = focusS === null ? false : moments.some((m) => m.startS < (moment ? moment.startS : focusS));
  const hasNext = focusS === null ? true : moments.some((m) => m.startS > focusS);
  const answerable = moment !== null && (moment.kind === 'snore' || moment.kind === 'other');
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
              <Small>
                Moment {index + 1} of {moments.length}
              </Small>
              <View style={styles.titleRow}>
                {moment.kind !== 'sound' ? <MomentSwatch kind={moment.kind} /> : null}
                <Text style={styles.title}>{describeMoment(moment)}</Text>
              </View>
              <Small>
                {clockTimeAt(startedAtS, moment.startS)} · {momentLength(moment.endS - moment.startS)}
              </Small>
            </>
          ) : focusS !== null ? (
            <>
              <Text style={styles.title}>
                {clockTimeAt(startedAtS, focusS)} · {heard ? 'recorded sound' : 'quiet'}
              </Text>
              <Small>Use the arrows to go to the next moment.</Small>
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
      {moment && answerable ? (
        <View style={[styles.row, { marginTop: space(3) }]}>
          <SnoringToggle snoring={pendingSnoring ?? moment.kind === 'snore'} onPress={() => onAnswer(moment.kind !== 'snore')} disabled={busy} />
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
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space(1.5), marginVertical: 1 },
  arrow: { width: 36, height: 44, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.3 },
  title: { color: colors.text, fontSize: 15, fontWeight: '700', flexShrink: 1 },
  play: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
});
