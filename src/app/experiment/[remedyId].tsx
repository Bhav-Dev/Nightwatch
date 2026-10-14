import { randomUUID } from 'expo-crypto';
import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { listActiveCatalogue } from '../../data/catalogueRepo';
import { startExperiment } from '../../data/experimentRepo';
import type { CatalogueItem } from '../../domain/catalogue';
import { createPattern } from '../../domain/experiment';
import { localDateKey } from '../../domain/nightDate';
import { Chip } from '../../ui/Chip';
import { Body, Button, Card, H2, Screen, Small } from '../../ui/kit';
import { colors, space } from '../../ui/theme';

/**
 * Explains and starts a 14-night test: 7 nights with, 7 without, in an order the app picks so
 * the comparison is fair. Tonight's chip is set from the plan each evening.
 */
export default function StartExperiment() {
  const { remedyId } = useLocalSearchParams<{ remedyId: string }>();
  const db = useSQLiteContext();
  const [remedies, setRemedies] = useState<CatalogueItem[]>([]);
  const [chosen, setChosen] = useState<string | null>(remedyId === 'new' ? null : remedyId);
  const [pattern] = useState(() => createPattern(Math.floor(Math.random() * 2 ** 31)));

  useEffect(() => {
    void listActiveCatalogue(db).then((items) => setRemedies(items.filter((i) => i.type === 'remedy')));
  }, [db]);

  const name = remedies.find((r) => r.id === chosen)?.name ?? '';
  const start = async () => {
    if (!chosen) return;
    await startExperiment(db, { id: randomUUID(), remedyId: chosen, started: localDateKey(new Date()), pattern });
    router.back();
  };

  return (
    <Screen footer={<Button label="Start tonight" onPress={start} disabled={!chosen} />}>
      {remedyId === 'new' ? (
        <Card>
          <H2>Which remedy?</H2>
          <View style={styles.wrap}>
            {remedies.map((r) => (
              <Chip key={r.id} label={r.name} selected={chosen === r.id} onPress={() => setChosen(r.id)} />
            ))}
          </View>
        </Card>
      ) : null}
      <Card>
        <H2>How the test works</H2>
        <Body>
          For 14 nights the app tells you each evening whether to use {name ? name.toLowerCase() : 'the remedy'} or not: 7 nights with, 7 without, in a mixed order so that a
          good or bad week doesn’t decide the result. At the end you get a verdict and how confident it is.
        </Body>
        <View style={styles.pattern} accessibilityLabel="Your 14-night plan">
          {pattern.map((on, i) => (
            <View key={i} style={[styles.day, on && styles.dayOn]}>
              <Text style={[styles.dayText, on && styles.dayTextOn]}>{i + 1}</Text>
            </View>
          ))}
        </View>
        <Small>Filled: nights with it. Keep everything else as usual, and log alcohol and colds as normal.</Small>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  pattern: { flexDirection: 'row', flexWrap: 'wrap', gap: space(1.5), marginVertical: space(4) },
  day: { width: 34, height: 34, borderRadius: 8, borderWidth: 1, borderColor: colors.borderStrong, alignItems: 'center', justifyContent: 'center' },
  dayOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  dayText: { color: colors.textMuted, fontWeight: '600' },
  dayTextOn: { color: colors.accentText },
});
