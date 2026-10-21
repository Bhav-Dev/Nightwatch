import Ionicons from '@expo/vector-icons/Ionicons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { ClipRow } from '../data/clipRepo';
import { clockTimeAt } from '../domain/interruption';
import { answerable as canAnswer, type Moment, momentTimes } from '../domain/moments';
import type { PitchBand } from '../domain/pitch';
import { durationWords } from '../domain/summary';
import { hexPath } from '../ui/Hive';
import { Button, Small } from '../ui/kit';
import { SnoringToggle } from '../ui/SnoringToggle';
import { colors, momentColor, space } from '../ui/theme';
import { describeMoment, momentLength, pitchSuffix } from './MomentPanel';

/** Rows shown before "Show all". */
const FIRST = 6;
const CELL = 44;
const CELL_H = (CELL * 2) / Math.sqrt(3);

/** A moment's key, for what is playing and an answer being saved. */
export const momentKey = (m: Moment) => `${m.kind}:${m.startS}`;

function detail(m: Moment, startedAtS: number, pitch: PitchBand | null): string {
  const length = momentLength(m.endS - m.startS);
  switch (m.kind) {
    case 'snore':
      return `${length}${pitchSuffix(pitch)}`;
    case 'move':
      return `${length} · rustling, probably turning over`;
    case 'breathing':
      return `${length} · loud breathing we didn’t count as snoring`;
    case 'awake':
      return `Until ${clockTimeAt(startedAtS, m.endS)} · ${durationWords(m.endS - m.startS)}`;
    case 'other':
      return m.answered ? length : `${length} · have a listen to check`;
    default:
      return length;
  }
}

/**
 * The night's moments of the kinds shown, in the order they happened: play any of them, answer
 * whether snoring, other sounds and heavy breathing were snoring, and save or share the ones with
 * a clip.
 */
export function MomentList({
  startedAtS,
  moments,
  clipFor,
  pitchOf,
  playable,
  playingKey,
  pending,
  busy,
  onPlay,
  onAnswer,
  onSave,
  onShare,
}: {
  startedAtS: number;
  moments: readonly Moment[];
  /** The clip kept for a moment, if any (only snoring and other sounds have clips). */
  clipFor: (m: Moment) => ClipRow | null;
  /** A snoring moment's pitch, when it was measured. */
  pitchOf?: (m: Moment) => PitchBand | null;
  /** Whether there is sound to play for a moment. */
  playable: (m: Moment) => boolean;
  playingKey: string | null;
  /** The answer being saved, by moment key, shown on its pill at once. */
  pending: { key: string; snoring: boolean } | null;
  busy: boolean;
  onPlay: (m: Moment) => void;
  onAnswer: (m: Moment, clip: ClipRow | null) => void;
  onSave: (clip: ClipRow) => void;
  onShare: (clip: ClipRow) => void;
}) {
  const [all, setAll] = useState(false);
  const times = momentTimes(moments, startedAtS);
  const rows = all ? moments : moments.slice(0, FIRST);
  return (
    <View>
      {rows.map((m, i) => {
        const key = momentKey(m);
        const playing = playingKey === key;
        const clip = clipFor(m);
        const answerable = canAnswer(m.kind);
        const colour = m.kind === 'sound' ? colors.info : momentColor[m.kind];
        const canPlay = playable(m);
        return (
          <View key={key} style={styles.row}>
            <Pressable
              onPress={() => onPlay(m)}
              disabled={!canPlay}
              accessibilityRole="button"
              accessibilityLabel={canPlay ? `${playing ? 'Pause' : 'Play'} ${describeMoment(m).toLowerCase()} at ${times[i]}` : `${describeMoment(m)} at ${times[i]}, no sound recorded`}
              style={styles.cell}
            >
              <Svg width={CELL} height={CELL_H} style={StyleSheet.absoluteFill}>
                <Path d={hexPath(CELL / 2, CELL_H / 2, CELL_H / 2 - 1, CELL_H * 0.1)} fill={colour} />
              </Svg>
              {canPlay ? <Ionicons name={playing ? 'pause' : 'play'} size={17} color={colors.accentText} /> : null}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>
                {times[i]} · {describeMoment(m)}
              </Text>
              <Small>{detail(m, startedAtS, m.kind === 'snore' ? (pitchOf?.(m) ?? null) : null)}</Small>
              {answerable || clip ? (
                <View style={styles.actions}>
                  {answerable ? (
                    <SnoringToggle snoring={pending?.key === key ? pending.snoring : m.kind === 'snore'} disabled={busy} onPress={() => onAnswer(m, clip)} />
                  ) : null}
                  {clip ? <Button kind="link" label={clip.saved ? 'Saved' : 'Save'} onPress={() => onSave(clip)} /> : null}
                  {clip ? <Button kind="link" label="Share" onPress={() => onShare(clip)} /> : null}
                </View>
              ) : null}
            </View>
          </View>
        );
      })}
      {moments.length > FIRST ? (
        <Button kind="link" label={all ? 'Show fewer' : `Show all ${moments.length}`} onPress={() => setAll((v) => !v)} style={{ marginTop: space(1) }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space(3),
    paddingVertical: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  cell: { width: CELL, height: CELL_H, alignItems: 'center', justifyContent: 'center' },
  title: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 2 },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: space(3), marginTop: space(2) },
});
