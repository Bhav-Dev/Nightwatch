import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../ui/kit';
import { colors, space } from '../../ui/theme';

export default function Welcome() {
  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.brand}>Nightwatch</Text>
        <Text style={styles.line}>Record your snoring, see what changes it, and compare with thousands of other snorers.</Text>
      </View>
      <Button label="Get started" onPress={() => router.push('/onboarding/sign-in')} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg, padding: space(6) },
  body: { flex: 1, justifyContent: 'center' },
  brand: { color: colors.accent, fontSize: 36, fontWeight: '800', marginBottom: space(4) },
  line: { color: colors.text, fontSize: 22, lineHeight: 30 },
});
