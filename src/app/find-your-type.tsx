import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { startTestGroup } from '../data/experimentRepo';
import { localDateKey } from '../domain/nightDate';
import { TYPE_TEST_GROUP, TYPE_TESTS, typeTestPlans } from '../domain/typeTest';
import { useApp } from '../state/AppContext';
import { Chip } from '../ui/Chip';
import { Body, Button, Card, H2, Screen, Small } from '../ui/kit';
import { colors, space } from '../ui/theme';

/**
 * Explains and starts "Find your type": up to three remedy tests at once for 14 nights (side
 * sleeping, a nasal strip, mouth tape), with crossed plans so each verdict stands on its own.
 */
export default function FindYourType() {
  const db = useSQLiteContext();
  const { paid } = useApp();
  const [chosen, setChosen] = useState<Set<string>>(() => new Set(TYPE_TESTS.map((t) => t.remedyId)));
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const tests = TYPE_TESTS.filter((t) => chosen.has(t.remedyId));
  const plans = useMemo(() => (tests.length ? typeTestPlans(seed, tests.length) : []), [seed, tests.length]);

  const flip = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setChosen(next);
  };

  const start = async () => {
    if (!tests.length) return;
    await startTestGroup(
      db,
      TYPE_TEST_GROUP,
      localDateKey(new Date()),
      tests.map((t, i) => ({ id: randomUUID(), remedyId: t.remedyId, pattern: plans[i] })),
    );
    router.back();
  };

  return (
    <Screen sky="plain" footer={<Button label="Start tonight" onPress={start} disabled={tests.length === 0} />}>
      <Card>
        <H2>How it works</H2>
        <Body>
          For 14 nights the app tells you each evening what to do for each test: 7 nights with it and 7 without, in a mixed order. The tests are mixed so that they
          don’t get in each other’s way: a night with a nasal strip is as likely to be on your side as not.{' '}
          {paid
            ? 'At the end each test gets a verdict, and your snore profile shows what changed your snoring.'
            : 'At the end each test gets a verdict for your snore profile; seeing it is part of the Hive, and you can join any time before then.'}
        </Body>
      </Card>

      <Card>
        <H2>Which tests</H2>
        <Small>Leave out anything you don’t have or don’t want to try.</Small>
        <View style={styles.wrap}>
          {TYPE_TESTS.map((t) => (
            <Chip key={t.remedyId} label={t.name} selected={chosen.has(t.remedyId)} onPress={() => flip(t.remedyId)} />
          ))}
        </View>
      </Card>

      {tests.length > 0 ? (
        <Card>
          <H2>Your 14 nights</H2>
          {tests.map((t, i) => (
            <View key={t.remedyId} style={{ marginTop: space(3) }} accessible accessibilityLabel={`${t.name}: with on nights ${plans[i].flatMap((on, d) => (on ? [d + 1] : [])).join(', ')}`}>
              <Text style={styles.testName}>{t.name}</Text>
              <View style={styles.pattern}>
                {plans[i].map((on, d) => (
                  <View key={d} style={[styles.day, on && styles.dayOn]}>
                    <Text style={[styles.dayText, on && styles.dayTextOn]}>{d + 1}</Text>
                  </View>
                ))}
              </View>
            </View>
          ))}
          <Small style={{ marginTop: space(3) }}>Filled: nights with it. Keep everything else as usual, and log alcohol and colds as normal.</Small>
        </Card>
      ) : null}

      <Small style={{ marginBottom: space(4) }}>
        Skip mouth tape on any night your nose is blocked, and stop any test that feels uncomfortable. Each night counts on the side you actually did.
      </Small>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(3) },
  testName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  pattern: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5), marginTop: space(2) },
  day: { width: 30, height: 30, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayText: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  dayTextOn: { color: colors.accentText },
});
