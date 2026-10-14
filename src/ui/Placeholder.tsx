import { StyleSheet, Text, View } from 'react-native';

import { colors, space } from './theme';

/** Stand-in for screens that arrive in a later phase. */
export function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg, padding: space(6), justifyContent: 'center' },
  title: { color: colors.text, fontSize: 24, fontWeight: '700', marginBottom: space(2) },
  body: { color: colors.textMuted, fontSize: 16, lineHeight: 22 },
});
