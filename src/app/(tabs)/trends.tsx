import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { enrichedHistory, movingAverage, nightsByDay, trendPoints, trendPointsBetween, type TrendPoint } from '../../data/historyRepo';
import { deleteSnapshot, listSnapshots, saveSnapshot, type Snapshot } from '../../data/snapshotRepo';
import { loadSnoreProfile } from '../../data/snoreProfileRepo';
import type { SnoreProfile } from '../../domain/snoreProfile';
import { SnoreProfileCard } from '../../screens/SnoreProfileCard';
import { finishDueExperiments } from '../../experiments/progress';
import { localDateKey } from '../../domain/nightDate';
import { AUTO_FACTOR_WORDS, type AutoFactor } from '../../domain/autoFactors';
import { restedLabel } from '../../domain/checkIn';
import { patterns, type Pattern } from '../../domain/patterns';
import { scoreLabel } from '../../domain/scoring';
import { WEATHER_KNOWN_ID } from '../../domain/weather';
import { listActiveCatalogue } from '../../data/catalogueRepo';
import { useApp } from '../../state/AppContext';
import { TrendChart } from '../../ui/charts';
import { NIGHT_LEGEND, NightsHive, type HiveDay } from '../../ui/Hive';
import { Body, Button, Card, GearLink, H2, Locked, Screen, Segmented, Small } from '../../ui/kit';
import { colors, space } from '../../ui/theme';

type Range = '7' | '30' | '90' | 'custom';

// Dates follow the phone's own language and region settings.
const dateOf = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
/** Under the chart: the weekday and day for a week ("Sat 17"), the day and month for longer ranges ("17 Oct"). */
const shortDate = (key: string, week: boolean) =>
  dateOf(key).toLocaleDateString(undefined, week ? { weekday: 'short', day: 'numeric' } : { day: 'numeric', month: 'short' });
const longDate = (key: string) => dateOf(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
/** "15 Oct – 17 Oct 2026", with both years when they differ. */
function rangeLabel(fromKey: string, toKey: string): string {
  const day = { day: 'numeric', month: 'short' } as const;
  const withYear = { ...day, year: 'numeric' } as const;
  const sameYear = fromKey.slice(0, 4) === toKey.slice(0, 4);
  return `${dateOf(fromKey).toLocaleDateString(undefined, sameYear ? day : withYear)} – ${dateOf(toKey).toLocaleDateString(undefined, withYear)}`;
}
/** How the range on screen compares with a snapshot: "4 lower", "2 higher" or "no change". */
const changeWords = (diff: number) => {
  const n = Math.round(Math.abs(diff));
  return n === 0 ? 'no change' : `${n} ${diff < 0 ? 'lower' : 'higher'}`;
};
/** "6 points higher" or "about the same" for a pattern's score difference. */
const patternWords = (diff: number) => {
  const n = Math.round(Math.abs(diff));
  return n < 2 ? 'about the same' : `${n} points ${diff > 0 ? 'higher' : 'lower'}`;
};
function patternName(id: string, names: ReadonlyMap<string, string>): string {
  if (id.startsWith('auto:')) return AUTO_FACTOR_WORDS[id.slice('auto:'.length) as AutoFactor]?.name ?? id;
  return WEATHER_NAMES[id] ?? names.get(id) ?? id;
}
const changeColour = (diff: number) => (Math.round(diff) < 0 ? colors.good : Math.round(diff) > 0 ? colors.worse : colors.textMuted);
/** The rested answers' running average over the last 7 answered nights (null until there is one). */
function restedAverage(points: readonly TrendPoint[]): (number | null)[] {
  const recent: number[] = [];
  return points.map((p) => {
    if (p.rested !== null) {
      recent.push(p.rested);
      if (recent.length > 7) recent.shift();
    }
    return recent.length ? recent.reduce((a, b) => a + b, 0) / recent.length : null;
  });
}

const WEATHER_NAMES: Record<string, string> = {
  'weather:cold': 'Cold nights (under 5°C)',
  'weather:warm': 'Warm nights (18°C or more)',
  'weather:humid': 'Humid nights (90% or more)',
  'weather:dry': 'Dry nights (60% or less)',
};

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateKey(d);
};
type Series = 'score' | 'pct' | 'rested';

export default function Trends() {
  const db = useSQLiteContext();
  const { paid } = useApp();
  const [range, setRange] = useState<Range>('7');
  const [series, setSeries] = useState<Series>('score');
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [hive, setHive] = useState<HiveDay[]>([]);
  /** The custom range (local dates, inclusive); two weeks to start with. */
  const [custom, setCustom] = useState({ from: daysAgo(13), to: daysAgo(0) });
  const [picking, setPicking] = useState<'from' | 'to' | null>(null);
  const [found, setFound] = useState<Pattern[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [profile, setProfile] = useState<SnoreProfile | null>(null);

  // A Bee: 7 nights of history.
  const effectiveRange: Range = paid ? range : '7';
  /** The dates the chart covers, which a snapshot saves. */
  const shown = effectiveRange === 'custom' ? custom : { from: daysAgo(Number(effectiveRange) - 1), to: daysAgo(0) };
  const weekLabels =
    effectiveRange === '7' || (effectiveRange === 'custom' && dateOf(custom.to).getTime() - dateOf(custom.from).getTime() < 7 * 86_400_000);

  const load = useCallback(async () => {
    const loaded = effectiveRange === 'custom' ? await trendPointsBetween(db, custom.from, custom.to) : await trendPoints(db, Number(effectiveRange));
    setPoints(loaded);
    // A Bee keeps 7 nights of history, so its hive is one week; the Hive shows four.
    const hiveDays = paid ? 28 : 7;
    setHive(nightsByDay(await trendPoints(db, hiveDays), hiveDays));
    setSnapshots(await listSnapshots(db));
    setFound(patterns(await enrichedHistory(db), new Set([WEATHER_KNOWN_ID])));
    setNames(new Map((await listActiveCatalogue(db)).map((c) => [c.id, c.name])));
    await finishDueExperiments(db, localDateKey(new Date()));
    setProfile(await loadSnoreProfile(db, { verdicts: paid }));
    // The latest night is picked to start with, so the line under the chart always says which night it is.
    setSelected(loaded.length ? loaded.length - 1 : null);
  }, [db, effectiveRange, paid, custom]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const values = points.map((p) => (series === 'score' ? p.score : series === 'pct' ? p.pctSnoring * 100 : p.rested));
  const avg =
    series === 'rested'
      ? restedAverage(points)
      : movingAverage(points, 7, series === 'score' ? 'score' : 'pctSnoring').map((v) => (v === null ? null : series === 'score' ? v : v * 100));
  const counted = points.filter((p) => p.counts);
  const mean = counted.length ? counted.reduce((s, p) => s + p.score, 0) / counted.length : null;
  const sel = selected !== null ? points[selected] : null;

  const snapshot = async () => {
    if (!paid) return router.push({ pathname: '/paywall', params: { trigger: 'snapshot' } });
    if (points.length === 0) return;
    const s = await saveSnapshot(db, { id: randomUUID(), name: rangeLabel(shown.from, shown.to), from: shown.from, to: shown.to });
    if (!s) Alert.alert('Nothing to save', 'There are no full nights in this range yet.');
    await load();
  };

  const latestAvg = mean;

  return (
    <Screen sky="plain" eyebrow="Trends" title="Your nights" right={<GearLink />}>
      <Card>
        <H2>Your hive of nights</H2>
        <Small style={{ marginBottom: space(3) }}>One cell a day, a week to a row. Brighter means louder; today is outlined. Tap a night to open it.</Small>
        <NightsHive days={hive} onOpen={(id) => router.push(`/night/${id}`)} />
        <View style={styles.hiveLegend}>
          {NIGHT_LEGEND.map((l) => (
            <View key={l.label} style={styles.hiveKey}>
              <View style={[styles.hexKey, { backgroundColor: l.colour }]} />
              <Text style={styles.legendText}>{l.label}</Text>
            </View>
          ))}
        </View>
        {!paid ? <Locked label="See four weeks of nights" trigger="history" /> : null}
      </Card>
      <Segmented<Range>
        value={effectiveRange}
        onChange={(r) => (paid || r === '7' ? setRange(r) : router.push({ pathname: '/paywall', params: { trigger: 'history' } }))}
        options={[
          { value: '7', label: '7 nights' },
          { value: '30', label: '30', locked: !paid },
          { value: '90', label: '90', locked: !paid },
          { value: 'custom', label: 'Custom', locked: !paid },
        ]}
      />
      {effectiveRange === 'custom' ? (
        <View style={styles.customRow}>
          {(['from', 'to'] as const).map((end) => (
            <Pressable
              key={end}
              onPress={() => setPicking(end)}
              accessibilityRole="button"
              accessibilityLabel={`${end === 'from' ? 'From' : 'To'} ${longDate(custom[end])}. Change`}
              style={styles.dateBox}
            >
              <Text style={styles.dateLabel}>{end === 'from' ? 'From' : 'To'}</Text>
              <Text style={styles.dateValue}>{longDate(custom[end])}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {picking ? (
        <DateTimePicker
          value={dateOf(custom[picking])}
          mode="date"
          presentation="dialog"
          minimumDate={picking === 'to' ? dateOf(custom.from) : undefined}
          maximumDate={picking === 'from' ? dateOf(custom.to) : new Date()}
          onValueChange={(_, date) => {
            const end = picking;
            setPicking(null);
            setCustom((c) => ({ ...c, [end]: localDateKey(date) }));
          }}
          onDismiss={() => setPicking(null)}
        />
      ) : null}
      <Card>
        <Segmented<Series>
          value={series}
          onChange={setSeries}
          options={[
            { value: 'score', label: 'Score' },
            { value: 'pct', label: '% snoring' },
            { value: 'rested', label: 'Rested' },
          ]}
        />
        {points.length === 0 ? (
          <Body muted>No nights in this range yet.</Body>
        ) : (
          <>
            <TrendChart
              values={values}
              average={avg}
              max={series === 'rested' ? 5 : 100}
              format={(v) => (series === 'pct' ? `${Math.round(v)}%` : String(Math.round(v)))}
              onSelect={setSelected}
              selected={selected}
              labels={points.map((p) => shortDate(p.date, weekLabels))}
              muted={points.map((p) => !p.counts)}
            />
            <View style={styles.legend}>
              <View style={[styles.key, { backgroundColor: colors.info }]} />
              <Text style={styles.legendText}>Each night</Text>
              <View style={[styles.key, { backgroundColor: colors.accent }]} />
              <Text style={styles.legendText}>{series === 'rested' ? 'Average of your last 7 answers' : '7-night average'}</Text>
            </View>
            {sel ? (
              <Pressable onPress={() => router.push(`/night/${sel.id}`)} accessibilityRole="button" accessibilityHint="Opens this night" style={styles.picked}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickedDate}>
                    Night of {longDate(sel.date)} · <Text style={styles.pickedScore}>{sel.score}</Text>
                  </Text>
                  <Text style={styles.pickedLine}>
                    {Math.round(sel.pctSnoring * 100)}% snoring · {scoreLabel(sel.score)}
                    {sel.rested !== null ? ` · felt ${restedLabel(sel.rested)?.toLowerCase()}` : ''}
                    {sel.counts ? '' : ' · short, not in averages'}
                  </Text>
                </View>
                <Text style={styles.pickedOpen}>Open ›</Text>
              </Pressable>
            ) : null}
            <Small style={{ marginTop: space(2) }}>
              {mean !== null ? `Average score ${Math.round(mean)} over ${counted.length} nights. ` : ''}Tap a point to pick a night.
            </Small>
          </>
        )}
      </Card>

      <Card>
        <H2>Your patterns</H2>
        <Small>What you logged, the weather, and what we read from each night (bedtime, length, weekends, room noise), against your own nights.</Small>
        {found.length === 0 ? (
          <Body muted style={{ marginTop: space(3) }}>Patterns appear after a few nights.</Body>
        ) : (
          found.slice(0, 8).map((p) => (
            <View key={p.id} style={styles.patternRow}>
              <Text style={styles.patternName}>{patternName(p.id, names)}</Text>
              <Text style={styles.patternLine}>
                {p.nightsWith} {p.nightsWith === 1 ? 'night' : 'nights'}
                {p.scoreDiff === null ? (
                  ' so far · 5 each way to compare'
                ) : (
                  <>
                    {' · '}
                    <Text style={{ color: changeColour(p.scoreDiff) }}>{patternWords(p.scoreDiff)}</Text>
                  </>
                )}
                {p.restedDiff !== null && Math.abs(p.restedDiff) >= 0.3 ? (p.restedDiff > 0 ? ' · felt more rested' : ' · felt less rested') : ''}
              </Text>
            </View>
          ))
        )}
      </Card>

      {profile ? <SnoreProfileCard profile={profile} /> : null}

      <Card>
        <H2>Snapshots</H2>
        <Small>Lock a baseline, then compare later periods against it.</Small>
        {paid ? (
          <>
            {snapshots.map((s) => (
              <View key={s.id} style={styles.snapshot}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.snapTitle}>{rangeLabel(s.from_date, s.to_date)}</Text>
                  <Text style={styles.snapLine}>
                    Average {Math.round(s.avg_score)}
                    {latestAvg !== null ? (
                      <>
                        {' · '}this range {Math.round(latestAvg)},{' '}
                        <Text style={{ color: changeColour(latestAvg - s.avg_score) }}>{changeWords(latestAvg - s.avg_score)}</Text>
                      </>
                    ) : null}
                  </Text>
                </View>
                <Button kind="link" label="Delete" onPress={async () => { await deleteSnapshot(db, s.id); await load(); }} />
              </View>
            ))}
            <Button kind="secondary" label="Save this range as a snapshot" onPress={snapshot} style={{ marginTop: space(3) }} />
          </>
        ) : (
          <Locked label="Save snapshots" trigger="snapshot" />
        )}
      </Card>

      <Card>
        <H2>Doctor’s report</H2>
        <Small>A summary of 14 to 30 nights to take to your GP. It is a consumer app summary, not a clinical test.</Small>
        <Button kind="secondary" label={paid ? 'Create a report' : 'Create a report 🔒'} onPress={() => router.push(paid ? '/report' : { pathname: '/paywall', params: { trigger: 'report' } })} style={{ marginTop: space(3) }} />
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', alignItems: 'center', gap: space(2), marginTop: space(2) },
  picked: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(3),
    marginTop: space(3),
    padding: space(3),
    borderRadius: 14,
    backgroundColor: 'rgba(246, 200, 95, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(246, 200, 95, 0.35)',
  },
  pickedDate: { color: colors.text, fontSize: 15, fontWeight: '700' },
  pickedLine: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  pickedOpen: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  pickedScore: { color: colors.accent, fontWeight: '800' },
  patternRow: { paddingVertical: space(2.5), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  patternName: { color: colors.text, fontSize: 15, fontWeight: '700' },
  patternLine: { color: colors.textMuted, fontSize: 13, marginTop: 2 },
  snapTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  snapLine: { color: colors.textMuted, fontSize: 14, marginTop: 2 },
  customRow: { flexDirection: 'row', gap: space(3), marginTop: space(3) },
  dateBox: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: space(2.5),
    paddingHorizontal: space(3),
  },
  dateLabel: { color: colors.textFaint, fontSize: 12 },
  dateValue: { color: colors.text, fontSize: 15, fontWeight: '700', marginTop: 2 },
  hiveLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3), marginTop: space(3) },
  hiveKey: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  hexKey: { width: 10, height: 10, borderRadius: 3 },
  key: { width: 12, height: 3, borderRadius: 2 },
  legendText: { color: colors.textMuted, fontSize: 12, marginRight: space(3) },
  snapshot: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
