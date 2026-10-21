import { router } from 'expo-router';
import { StyleSheet, Text, type TextStyle, View } from 'react-native';

import { ChangeBar } from './charts';
import { colors } from './theme';

/**
 * Text that reads as a blur: clear glyphs with a soft shadow. Used for the figures a Bee
 * cannot see yet. The numbers are made up, never real results, and hidden from screen readers
 * so nothing locked is read out.
 */
export function BlurredText({ children, style, color = colors.text }: { children: string; style?: TextStyle; color?: string }) {
  return (
    <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[style, styles.blur, { textShadowColor: color }]}>
      {children}
    </Text>
  );
}

/** A faded change bar under a blur, standing in for a remedy's result. */
export function BlurredBar({ seed = 0, width }: { seed?: number; width?: number }) {
  const median = -6 - (seed % 9);
  return (
    <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={styles.bar}>
      <ChangeBar median={median} p25={median - 8} p75={median + 6} width={width} muted />
    </View>
  );
}

/** Made-up figures for the locked preview, varied a little from row to row. */
export function placeholderFigures(seed: number): { delta: string; people: string } {
  return { delta: `-${6 + ((seed * 7) % 13)} points`, people: `${120 + seed * 37} people · ${900 + seed * 211} nights` };
}

export function openHivePaywall(trigger: string): void {
  router.push({ pathname: '/paywall', params: { trigger } });
}

const styles = StyleSheet.create({
  blur: { color: 'transparent', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 9 },
  bar: { opacity: 0.35 },
});
