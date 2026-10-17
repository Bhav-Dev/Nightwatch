import Ionicons from '@expo/vector-icons/Ionicons';
import { Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, space } from './theme';

/**
 * "Snoring": on when the moment counts as snoring. Tapping it is the user's answer (on: it was
 * snoring, off: it was not), which corrects the night and teaches the detector.
 */
export function SnoringToggle({ snoring, onPress, disabled = false }: { snoring: boolean; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: snoring, disabled }}
      accessibilityLabel="Snoring"
      accessibilityHint={snoring ? 'Untick if this was not snoring' : 'Tick if this was snoring'}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      style={[styles.pill, snoring && styles.on, disabled && { opacity: 0.5 }]}
    >
      <Ionicons name={snoring ? 'checkmark' : 'add'} size={15} color={snoring ? colors.accentText : colors.text} />
      <Text style={[styles.label, snoring && styles.labelOn]}>Snoring</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(1),
    paddingHorizontal: space(3),
    paddingVertical: space(1.5),
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  on: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { color: colors.text, fontSize: 14, fontWeight: '700' },
  labelOn: { color: colors.accentText },
});
