import { useMemo, useState } from 'react';
import { Modal, Pressable, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { type CatalogueItem, DEFAULT_FACTOR_CHIPS, DEFAULT_REMEDY_CHIPS } from '../domain/catalogue';
import { colors, radius, space } from '../ui/theme';

type LogType = 'remedy' | 'factor';

/** What is logged: item id → band value for banded factors (alcohol), null for a plain tick. */
export type LogSelection = Map<string, string | null>;

const COMMON = new Set<string>([...DEFAULT_REMEDY_CHIPS, ...DEFAULT_FACTOR_CHIPS]);
const TYPE_NAME: Record<LogType, string> = { remedy: 'Remedies', factor: 'Factors' };

/**
 * Full-screen list for choosing tonight's (or last night's) remedies and factors: the most common
 * first, then the rest by category, with search. Banded factors show their bands as buttons.
 * Changes apply as they are made; Done closes.
 */
export function LogPicker(props: {
  visible: boolean;
  title: string;
  types: readonly LogType[];
  items: readonly CatalogueItem[];
  selected: LogSelection;
  onSet: (item: CatalogueItem, value: string | null, on: boolean) => void;
  /** Free-text remedies ("other"), offered when a search matches nothing useful. */
  onAddOther?: (text: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const sections = useMemo(() => {
    const items = props.items.filter((i) => props.types.includes(i.type as LogType));
    const prefix = (type: LogType) => (props.types.length > 1 ? `${TYPE_NAME[type]} · ` : '');
    if (q) {
      const hits = items.filter((i) => i.name.toLowerCase().includes(q) || i.category.toLowerCase().includes(q));
      return hits.length ? [{ title: 'Results', data: hits }] : [];
    }
    const out: { title: string; data: CatalogueItem[] }[] = [];
    for (const type of props.types) {
      const ofType = items.filter((i) => i.type === type);
      const common = ofType.filter((i) => COMMON.has(i.id));
      if (common.length) out.push({ title: `${prefix(type)}Most common`, data: common });
      const byCategory = new Map<string, CatalogueItem[]>();
      for (const i of ofType) {
        if (COMMON.has(i.id)) continue;
        byCategory.set(i.category, [...(byCategory.get(i.category) ?? []), i]);
      }
      for (const [category, data] of byCategory) out.push({ title: `${prefix(type)}${category}`, data });
    }
    return out;
  }, [props.items, props.types, q]);

  const count = props.items.filter((i) => props.types.includes(i.type as LogType) && props.selected.has(i.id)).length;

  const close = () => {
    setQuery('');
    props.onClose();
  };

  return (
    <Modal visible={props.visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={close}>
      <SafeAreaView style={styles.sheet} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{props.title}</Text>
            <Text style={styles.count}>{count === 0 ? 'Nothing selected' : `${count} selected`}</Text>
          </View>
          <Pressable onPress={close} accessibilityRole="button" hitSlop={12}>
            <Text style={styles.done}>Done</Text>
          </Pressable>
        </View>
        <TextInput
          placeholder="Search"
          placeholderTextColor={colors.textFaint}
          value={query}
          onChangeText={setQuery}
          style={styles.search}
          accessibilityLabel="Search"
        />
        <SectionList
          sections={sections}
          keyExtractor={(i) => i.id}
          keyboardShouldPersistTaps="handled"
          stickySectionHeadersEnabled={false}
          // The whole catalogue is about 40 rows: render it at once so fast scrolling never shows gaps.
          initialNumToRender={60}
          renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
          renderItem={({ item }) => <PickerRow item={item} value={props.selected.get(item.id)} on={props.selected.has(item.id)} onSet={props.onSet} />}
          ListEmptyComponent={q ? <Text style={styles.empty}>Nothing matches “{query.trim()}”.</Text> : null}
          ListFooterComponent={
            props.onAddOther && q && props.types.includes('remedy') ? (
              <Pressable style={styles.row} onPress={() => props.onAddOther?.(query)} accessibilityRole="button">
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>Add “{query.trim()}” as other</Text>
                  <Text style={styles.category}>We review new suggestions and add common ones to the list.</Text>
                </View>
              </Pressable>
            ) : null
          }
        />
      </SafeAreaView>
    </Modal>
  );
}

function PickerRow({
  item,
  value,
  on,
  onSet,
}: {
  item: CatalogueItem;
  value: string | null | undefined;
  on: boolean;
  onSet: (item: CatalogueItem, value: string | null, on: boolean) => void;
}) {
  if (item.value_options) {
    // Banded factor: pick a band; tapping the chosen band again clears it.
    return (
      <View style={styles.row}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{item.name}</Text>
          <View style={styles.bands}>
            {item.value_options.map((band) => {
              const chosen = on && value === band;
              return (
                <Pressable
                  key={band}
                  accessibilityRole="button"
                  accessibilityState={{ selected: chosen }}
                  accessibilityLabel={`${item.name}, ${band} units`}
                  onPress={() => onSet(item, chosen ? null : band, !chosen)}
                  style={[styles.band, chosen && styles.bandOn]}
                >
                  <Text style={[styles.bandLabel, chosen && styles.bandLabelOn]}>{band} units</Text>
                </Pressable>
              );
            })}
          </View>
        </View>
      </View>
    );
  }
  return (
    <Pressable
      style={styles.row}
      onPress={() => onSet(item, null, !on)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: on }}
    >
      <Text style={[styles.name, { flex: 1 }]}>{item.name}</Text>
      <View style={[styles.check, on && styles.checkOn]}>{on ? <Text style={styles.checkMark}>✓</Text> : null}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: space(5) },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: space(5), marginBottom: space(4) },
  title: { color: colors.text, fontSize: 22, fontWeight: '700' },
  count: { color: colors.textFaint, fontSize: 14, marginTop: 2 },
  done: { color: colors.accent, fontSize: 17, fontWeight: '700' },
  search: {
    backgroundColor: colors.surface,
    color: colors.text,
    borderRadius: radius.button,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
    marginBottom: space(2),
    fontSize: 16,
  },
  section: { color: colors.textMuted, fontSize: 13, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: space(5), marginBottom: space(1) },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: space(3),
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  name: { color: colors.text, fontSize: 16 },
  category: { color: colors.textFaint, fontSize: 13, marginTop: 2 },
  empty: { color: colors.textMuted, marginTop: space(4) },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  checkMark: { color: colors.accentText, fontSize: 15, fontWeight: '800' },
  bands: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginTop: space(2) },
  band: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.button, paddingHorizontal: space(3), paddingVertical: space(2) },
  bandOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  bandLabel: { color: colors.text, fontSize: 14 },
  bandLabelOn: { color: colors.accentText, fontWeight: '700' },
});
