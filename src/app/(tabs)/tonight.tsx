import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { requestNotificationPermissionsAsync } from 'expo-audio';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listActiveCatalogue } from '../../data/catalogueRepo';
import { runningExperiments, type Experiment } from '../../data/experimentRepo';
import { planFor } from '../../domain/experiment';
import { GearLink } from '../../ui/kit';
import { useApp } from '../../state/AppContext';
import { type LogTick, prefillPendingLog, setPendingTick } from '../../data/logRepo';
import { type CatalogueItem } from '../../domain/catalogue';
import { localDateKey } from '../../domain/nightDate';
import { getAudioCapture } from '../../native';
import { LogPicker } from '../../screens/LogPicker';
import { Chip } from '../../ui/Chip';
import { colors, radius, space } from '../../ui/theme';

const TIPS = [
  'Plug the phone in so the battery lasts the night.',
  'Turn on Do Not Disturb so calls and alerts do not stop the recording.',
  'Airplane mode is fine; recording does not need a connection.',
];

/** Free-text remedies are logged as "other:<text>" and sent to the catalogue review queue. */
const OTHER_PREFIX = 'other:';

export default function Tonight() {
  const db = useSQLiteContext();
  const { api } = useApp();
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [ticks, setTicks] = useState<Map<string, LogTick>>(new Map());
  const [picker, setPicker] = useState<'remedy' | 'factor' | null>(null);
  const [plans, setPlans] = useState<{ experiment: Experiment; plan: 'with' | 'without' }[]>([]);
  const today = useMemo(() => new Date(), []);
  const tip = TIPS[today.getDate() % TIPS.length];

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const today = localDateKey(new Date());
        const [items, pending, running] = await Promise.all([
          listActiveCatalogue(db),
          prefillPendingLog(db, today),
          runningExperiments(db),
        ]);
        // A running remedy test decides tonight's tick for that remedy.
        const todays = running
          .map((experiment) => ({ experiment, plan: planFor(experiment.started, experiment.pattern, today) }))
          .filter((p): p is { experiment: Experiment; plan: 'with' | 'without' } => p.plan !== null);
        for (const p of todays) {
          const tick = { itemId: p.experiment.remedyId, type: 'remedy' as const, value: null };
          await setPendingTick(db, tick, p.plan === 'with');
        }
        const ticksNow = todays.length ? await prefillPendingLog(db, today) : pending;
        setPlans(todays);
        setCatalogue(items);
        setTicks(new Map(ticksNow.map((t) => [t.itemId, t])));
      })();
    }, [db]),
  );

  const byId = useMemo(() => new Map(catalogue.map((c) => [c.id, c])), [catalogue]);

  /** What is ticked for tonight, in the order it was ticked, including free-text remedies. */
  const selectedFor = (type: 'remedy' | 'factor') =>
    [...ticks.values()]
      .filter((t) => t.type === type)
      .map((t): CatalogueItem | undefined =>
        t.itemId.startsWith(OTHER_PREFIX)
          ? { id: t.itemId, type: 'remedy', kind: 'habit', category: 'Other', name: t.itemId.slice(OTHER_PREFIX.length), article_md: '', link_url: null, shop: false, amazon: null, active: true, version: 0 }
          : byId.get(t.itemId),
      )
      .filter((c): c is CatalogueItem => !!c);

  const setTick = async (item: CatalogueItem, value: string | null, on: boolean) => {
    const tick: LogTick = { itemId: item.id, type: item.type, value };
    const updated = new Map(ticks);
    if (on) updated.set(item.id, tick);
    else updated.delete(item.id);
    setTicks(updated);
    await setPendingTick(db, tick, on);
  };

  const addOther = async (text: string) => {
    const name = text.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!name) return;
    const tick = { itemId: `${OTHER_PREFIX}${name}`, type: 'remedy' as const, value: null };
    await setPendingTick(db, tick, true);
    setTicks(new Map(ticks).set(tick.itemId, tick));
    if (api.configured) void api.suggest(name).catch(() => undefined);
    setPicker(null);
  };

  const chipLabel = (item: CatalogueItem) => {
    const value = ticks.get(item.id)?.value;
    return value ? `${item.name} · ${value} units` : item.name;
  };

  const start = async () => {
    if (!(await getAudioCapture().requestPermission())) {
      Alert.alert('Microphone needed', 'Nightwatch needs the microphone to hear snoring. Audio stays on this phone.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    // Android 13+: lets the "Recording your night" notification show. Recording works either way.
    if (Platform.OS === 'android') await requestNotificationPermissionsAsync().catch(() => undefined);
    router.push('/recording');
  };

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>Tonight</Text>
            <Text style={styles.date}>
              {today.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
            </Text>
          </View>
          <GearLink />
        </View>

        {plans.map(({ experiment, plan }) => (
          <View key={experiment.id} style={styles.plan}>
            <Text style={styles.planTitle}>Remedy test</Text>
            <Text style={styles.tipBody}>
              Tonight: {plan === 'with' ? 'use' : 'no'} {(byId.get(experiment.remedyId)?.name ?? experiment.remedyId).toLowerCase()}. Your test picks the order, so the comparison is fair.
            </Text>
          </View>
        ))}

        {(['remedy', 'factor'] as const).map((type) => {
          const chosen = selectedFor(type);
          const noun = type === 'remedy' ? 'remedies' : 'factors';
          return (
            <View key={type}>
              <View style={styles.sectionRow}>
                <Text style={styles.section}>{type === 'remedy' ? 'Remedies' : 'Factors'}</Text>
                {chosen.length ? (
                  <Pressable onPress={() => setPicker(type)} accessibilityRole="button" accessibilityLabel={`Change ${noun}`} hitSlop={8}>
                    <Text style={styles.change}>Change</Text>
                  </Pressable>
                ) : null}
              </View>
              {chosen.length ? (
                <View style={styles.wrap}>
                  {chosen.map((item) => (
                    <Chip key={item.id} label={chipLabel(item)} selected onPress={() => setPicker(type)} />
                  ))}
                </View>
              ) : (
                <Pressable style={styles.choose} onPress={() => setPicker(type)} accessibilityRole="button">
                  <Text style={styles.chooseLabel}>+ Choose {noun}</Text>
                  <Text style={styles.chooseHint}>
                    {type === 'remedy' ? 'What you are trying tonight, like side sleeping or nasal strips' : 'Anything that might matter, like alcohol or a late meal'}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}

        <View style={styles.tip}>
          <Text style={styles.tipTitle}>Tip</Text>
          <Text style={styles.tipBody}>{tip}</Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" style={styles.primary} onPress={start}>
          <Text style={styles.primaryLabel}>Start recording</Text>
        </Pressable>
        <Text style={styles.hint}>Place the phone on the bedside table, screen down is fine.</Text>
      </View>

      <LogPicker
        visible={picker !== null}
        title={picker === 'factor' ? 'Factors tonight' : 'Remedies tonight'}
        types={picker ? [picker] : []}
        items={catalogue}
        selected={new Map([...ticks.values()].map((t) => [t.itemId, t.value]))}
        onSet={setTick}
        onAddOther={addOther}
        onClose={() => setPicker(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(5), paddingBottom: space(8) },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space(6) },
  eyebrow: { color: colors.accent, fontSize: 14, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  date: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: space(1) },
  plan: { backgroundColor: colors.surfaceRaised, borderRadius: radius.card, padding: space(4), marginBottom: space(2) },
  planTitle: { color: colors.accent, fontWeight: '700', marginBottom: space(1) },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space(4), marginBottom: space(2) },
  section: { color: colors.textMuted, fontSize: 14, fontWeight: '700' },
  change: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', rowGap: space(2) },
  choose: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.card,
    paddingHorizontal: space(4),
    paddingVertical: space(4),
  },
  chooseLabel: { color: colors.text, fontSize: 16, fontWeight: '700' },
  chooseHint: { color: colors.textFaint, fontSize: 13, marginTop: space(1) },
  tip: {
    marginTop: space(8),
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(5),
  },
  tipTitle: { color: colors.info, fontWeight: '700', marginBottom: space(1) },
  tipBody: { color: colors.text, fontSize: 15, lineHeight: 21 },
  footer: { padding: space(5), paddingTop: space(2) },
  primary: { backgroundColor: colors.accent, borderRadius: radius.button, paddingVertical: space(4.5), alignItems: 'center' },
  primaryLabel: { color: colors.accentText, fontSize: 18, fontWeight: '800' },
  hint: { color: colors.textFaint, textAlign: 'center', marginTop: space(2), fontSize: 13 },
});
