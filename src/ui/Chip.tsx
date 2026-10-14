import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, space } from './theme';

interface Props {
  label: string;
  selected?: boolean;
  onPress: () => void;
  dashed?: boolean;
}

export function Chip({ label, selected = false, onPress, dashed = false }: Props) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[styles.chip, selected && styles.selected, dashed && styles.dashed]}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: space(4),
    paddingVertical: space(2.5),
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
    marginRight: space(2),
  },
  selected: { backgroundColor: colors.accent, borderColor: colors.accent },
  dashed: { borderStyle: 'dashed', backgroundColor: 'transparent' },
  label: { color: colors.text, fontSize: 15, fontWeight: '600' },
  labelSelected: { color: colors.accentText },
});
