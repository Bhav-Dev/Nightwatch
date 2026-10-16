import { router } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Button } from '../../ui/kit';
import { Logo } from '../../ui/Logo';
import { NightSky } from '../../ui/NightSky';
import { colors, fonts, space } from '../../ui/theme';

export default function Welcome() {
  return (
    <View style={styles.screen}>
      <NightSky />
      <SafeAreaView style={styles.safe}>
        <View style={styles.body}>
          <Logo width={240} />
          <Text style={styles.brand}>Nightwatch</Text>
          <Text style={styles.line}>Record your snoring, see what changes it, and compare with thousands of other snorers.</Text>
        </View>
        <Button label="Get started" onPress={() => router.push('/onboarding/sign-in')} />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1, padding: space(6) },
  body: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  brand: { color: colors.accent, fontSize: 40, fontFamily: fonts.heading, marginTop: space(2), marginBottom: space(4) },
  line: { color: colors.text, fontSize: 21, lineHeight: 30, textAlign: 'center' },
});
