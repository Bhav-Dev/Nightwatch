import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import type { ShownKind } from '../domain/moments';
import { hexPath } from './Hive';
import { colors, momentColor, space } from './theme';

export const MOMENT_LABEL: Record<ShownKind, string> = {
  snore: 'Snoring',
  move: 'Movement',
  awake: 'Possibly awake',
  other: 'Other',
  breathing: 'Heavy breathing',
};

/** A small honeycomb cell in a moment's colour (hollow when its kind is hidden). */
export function MomentSwatch({ kind, size = 12, on = true }: { kind: ShownKind; size?: number; on?: boolean }) {
  const h = (size * 2) / Math.sqrt(3);
  return (
    <Svg width={size} height={h}>
      <Path
        d={hexPath(size / 2, h / 2, h / 2 - 1, h * 0.12)}
        fill={on ? momentColor[kind] : 'none'}
        stroke={on ? momentColor[kind] : colors.textFaint}
        strokeWidth={1.5}
      />
    </Svg>
  );
}

/**
 * The timeline's legend, which is also its filter: All, then one chip per kind of moment with
 * how many the night had. Any mix can be on; the last one on cannot be turned off. The timeline,
 * the moment arrows and the list all follow it.
 */
export function MomentFilter({
  kinds,
  show,
  counts,
  onChange,
}: {
  /** The kinds this night was checked for (movement and awake need the night-events check). */
  kinds: readonly ShownKind[];
  show: ReadonlySet<ShownKind>;
  counts: Record<ShownKind, number>;
  onChange: (next: Set<ShownKind>) => void;
}) {
  const allOn = kinds.every((k) => show.has(k));
  const flip = (k: ShownKind) => {
    const next = new Set(show);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    if (kinds.some((x) => next.has(x))) onChange(next);
  };
  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => onChange(new Set(kinds))}
        accessibilityRole="button"
        accessibilityLabel="Show all"
        accessibilityState={{ selected: allOn }}
        hitSlop={4}
        style={[styles.chip, allOn && styles.allOn]}
      >
        <Text style={[styles.label, !allOn && styles.labelOff]}>All</Text>
      </Pressable>
      {kinds.map((k) => {
        const on = show.has(k);
        return (
          <Pressable
            key={k}
            onPress={() => flip(k)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: on }}
            accessibilityLabel={`${MOMENT_LABEL[k]}, ${counts[k]}`}
            hitSlop={4}
            style={[styles.chip, on && { borderColor: momentColor[k], backgroundColor: `${momentColor[k]}29` }]}
          >
            <MomentSwatch kind={k} size={11} on={on} />
            <Text style={[styles.label, !on && styles.labelOff]}>{MOMENT_LABEL[k]}</Text>
            <Text style={styles.count}>{counts[k]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 34,
    paddingHorizontal: space(2.5),
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
  },
  allOn: { borderColor: colors.text, backgroundColor: 'rgba(244, 241, 255, 0.14)' },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  labelOff: { color: colors.textMuted },
  count: { color: colors.textMuted, fontSize: 14, fontWeight: '600' },
});
