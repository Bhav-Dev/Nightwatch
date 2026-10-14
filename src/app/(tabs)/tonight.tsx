import { Link, router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { requestNotificationPermissionsAsync } from 'expo-audio';
import { SafeAreaView } from 'react-native-safe-area-context';

import { listActiveCatalogue } from '../../data/catalogueRepo';
import { type LogTick, prefillPendingLog, setPendingTick } from '../../data/logRepo';
import { type CatalogueItem, DEFAULT_FACTOR_CHIPS, DEFAULT_REMEDY_CHIPS } from '../../domain/catalogue';
import { localDateKey } from '../../domain/nightDate';
import { getAudioCapture } from '../../native';
import { Chip } from '../../ui/Chip';
import { colors, radius, space } from '../../ui/theme';

const TIPS = [
  'Plug the phone in so the battery lasts the night.',
  'Turn on Do Not Disturb so calls and alerts do not stop the recording.',
  'Airplane mode is fine; recording does not need a connection.',
];

export default function Tonight() {
  const db = useSQLiteContext();
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [ticks, setTicks] = useState<Map<string, LogTick>>(new Map());
  const [sheet, setSheet] = useState<'remedy' | 'factor' | null>(null);
  const today = useMemo(() => new Date(), []);
  const tip = TIPS[today.getDate() % TIPS.length];

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const [items, pending] = await Promise.all([
          listActiveCatalogue(db),
          prefillPendingLog(db, localDateKey(new Date())),
        ]);
        setCatalogue(items);
        setTicks(new Map(pending.map((t) => [t.itemId, t])));
      })();
    }, [db]),
  );

  const byId = useMemo(() => new Map(catalogue.map((c) => [c.id, c])), [catalogue]);

  const chipsFor = (type: 'remedy' | 'factor') => {
    const defaults = type === 'remedy' ? DEFAULT_REMEDY_CHIPS : DEFAULT_FACTOR_CHIPS;
    const ticked = [...ticks.values()].filter((t) => t.type === type).map((t) => t.itemId);
    const ids = [...new Set([...ticked, ...defaults])];
    return ids.map((id) => byId.get(id)).filter((c): c is CatalogueItem => !!c);
  };

  const toggle = async (item: CatalogueItem) => {
    const current = ticks.get(item.id);
    let next: LogTick | null;
    if (item.value_options) {
      // Banded factors (alcohol) cycle off → each band → off.
      const i = current ? item.value_options.indexOf(current.value ?? '') : -1;
      const value = item.value_options[i + 1];
      next = value ? { itemId: item.id, type: item.type, value } : null;
    } else {
      next = current ? null : { itemId: item.id, type: item.type, value: null };
    }
    const updated = new Map(ticks);
    if (next) updated.set(item.id, next);
    else updated.delete(item.id);
    setTicks(updated);
    await setPendingTick(db, next ?? { itemId: item.id, type: item.type, value: null }, next !== null);
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
          <Link href="/settings" accessibilityLabel="Settings" style={styles.gear}>
            ⚙︎
          </Link>
        </View>

        <Text style={styles.section}>Remedies</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
          {chipsFor('remedy').map((item) => (
            <Chip key={item.id} label={chipLabel(item)} selected={ticks.has(item.id)} onPress={() => toggle(item)} />
          ))}
          <Chip label="+ Add" dashed onPress={() => setSheet('remedy')} />
        </ScrollView>

        <Text style={styles.section}>Factors</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip}>
          {chipsFor('factor').map((item) => (
            <Chip key={item.id} label={chipLabel(item)} selected={ticks.has(item.id)} onPress={() => toggle(item)} />
          ))}
          <Chip label="+ Add" dashed onPress={() => setSheet('factor')} />
        </ScrollView>

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

      <CatalogueSheet
        type={sheet}
        items={catalogue}
        ticks={ticks}
        onToggle={toggle}
        onClose={() => setSheet(null)}
      />
    </SafeAreaView>
  );
}

function CatalogueSheet(props: {
  type: 'remedy' | 'factor' | null;
  items: CatalogueItem[];
  ticks: Map<string, LogTick>;
  onToggle: (item: CatalogueItem) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const rows = props.items.filter(
    (i) => i.type === props.type && (!q || i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q)),
  );
  return (
    <Modal visible={props.type !== null} animationType="slide" presentationStyle="pageSheet" onRequestClose={props.onClose}>
      <View style={styles.sheet}>
        <View style={styles.sheetHeader}>
          <Text style={styles.sheetTitle}>{props.type === 'factor' ? 'Add a factor' : 'Add a remedy'}</Text>
          <Pressable onPress={props.onClose} accessibilityRole="button">
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <TextInput
          placeholder="Search"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          style={styles.search}
        />
        <FlatList
          data={rows}
          keyExtractor={(i) => i.id}
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => props.onToggle(item)}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowName}>{item.name}</Text>
                <Text style={styles.rowCategory}>{item.category}</Text>
              </View>
              <Text style={styles.check}>
                {props.ticks.get(item.id)?.value ?? (props.ticks.has(item.id) ? '✓' : '')}
              </Text>
            </Pressable>
          )}
          ListFooterComponent={
            props.type === 'remedy' ? (
              // Free-text "Other" goes to the review queue once accounts and sync exist (Phase 3).
              <Text style={styles.rowCategory}>{"Can't find it? An \"Other\" option arrives with sync."}</Text>
            ) : null
          }
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(5), paddingBottom: space(8) },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: space(6) },
  eyebrow: { color: colors.accent, fontSize: 14, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase' },
  date: { color: colors.text, fontSize: 26, fontWeight: '700', marginTop: space(1) },
  gear: { color: colors.textMuted, fontSize: 24, padding: space(1) },
  section: { color: colors.textMuted, fontSize: 14, fontWeight: '700', marginBottom: space(2), marginTop: space(4) },
  strip: { flexGrow: 0, marginHorizontal: -space(5), paddingHorizontal: space(5) },
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
  sheet: { flex: 1, backgroundColor: colors.bg, padding: space(5) },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space(4) },
  sheetTitle: { color: colors.text, fontSize: 20, fontWeight: '700' },
  done: { color: colors.accent, fontSize: 17, fontWeight: '700' },
  search: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.button,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    marginBottom: space(3),
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowName: { color: colors.text, fontSize: 16 },
  rowCategory: { color: colors.textFaint, fontSize: 13, marginTop: 2 },
  check: { color: colors.accent, fontSize: 16, fontWeight: '700', minWidth: 40, textAlign: 'right' },
});
