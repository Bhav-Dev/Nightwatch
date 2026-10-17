import { randomUUID } from 'expo-crypto';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';

import { movingAverage, nightsByDay, trendPoints, type TrendPoint } from '../../data/historyRepo';
import { deleteSnapshot, listSnapshots, saveSnapshot, type Snapshot } from '../../data/snapshotRepo';
import { scoreLabel } from '../../domain/scoring';
import { useApp } from '../../state/AppContext';
import { TrendChart } from '../../ui/charts';
import { NIGHT_LEGEND, NightsHive, type HiveDay } from '../../ui/Hive';
import { Body, Button, Card, GearLink, H2, Locked, Screen, Segmented, Small } from '../../ui/kit';
import { colors, space } from '../../ui/theme';

type Range = '7' | '30' | '90';

const dateOf = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));
/** Under the chart: the weekday and day for a week ("Sat 17"), the day and month for longer ranges ("17 Oct"). */
const shortDate = (key: string, week: boolean) =>
  dateOf(key).toLocaleDateString('en-GB', week ? { weekday: 'short', day: 'numeric' } : { day: 'numeric', month: 'short' });
const longDate = (key: string) => dateOf(key).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
type Series = 'score' | 'pct';

export default function Trends() {
  const db = useSQLiteContext();
  const { paid } = useApp();
  const [range, setRange] = useState<Range>('7');
  const [series, setSeries] = useState<Series>('score');
  const [points, setPoints] = useState<TrendPoint[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [hive, setHive] = useState<HiveDay[]>([]);

  // Free plan: 7 nights of history.
  const effectiveRange: Range = paid ? range : '7';

  const load = useCallback(async () => {
    const loaded = await trendPoints(db, Number(effectiveRange));
    setPoints(loaded);
    // The free plan keeps 7 nights of history, so its hive is one week; Insight shows four.
    const hiveDays = paid ? 28 : 7;
    setHive(nightsByDay(await trendPoints(db, hiveDays), hiveDays));
    setSnapshots(await listSnapshots(db));
    // The latest night is picked to start with, so the line under the chart always says which night it is.
    setSelected(loaded.length ? loaded.length - 1 : null);
  }, [db, effectiveRange, paid]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const values = points.map((p) => (series === 'score' ? p.score : p.pctSnoring * 100));
  const avg = movingAverage(points, 7, series === 'score' ? 'score' : 'pctSnoring').map((v) => (v === null ? null : series === 'score' ? v : v * 100));
  const counted = points.filter((p) => p.counts);
  const mean = counted.length ? counted.reduce((s, p) => s + p.score, 0) / counted.length : null;
  const sel = selected !== null ? points[selected] : null;

  const snapshot = async () => {
    if (!paid) return router.push({ pathname: '/paywall', params: { trigger: 'snapshot' } });
    if (points.length === 0) return;
    const from = points[0].date.slice(0, 10);
    const to = points[points.length - 1].date.slice(0, 10);
    const s = await saveSnapshot(db, { id: randomUUID(), name: `${effectiveRange}-night baseline to ${to}`, from, to });
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
        ]}
      />
      <Card>
        <H2 right={<Segmented<Series> value={series} onChange={setSeries} options={[{ value: 'score', label: 'Score' }, { value: 'pct', label: '% snoring' }]} />}>{''}</H2>
        {points.length === 0 ? (
          <Body muted>No nights in this range yet.</Body>
        ) : (
          <>
            <TrendChart
              values={values}
              average={avg}
              max={100}
              format={(v) => (series === 'score' ? String(Math.round(v)) : `${Math.round(v)}%`)}
              onSelect={setSelected}
              selected={selected}
              labels={points.map((p) => shortDate(p.date, effectiveRange === '7'))}
              muted={points.map((p) => !p.counts)}
            />
            <View style={styles.legend}>
              <View style={[styles.key, { backgroundColor: colors.info }]} />
              <Text style={styles.legendText}>Each night</Text>
              <View style={[styles.key, { backgroundColor: colors.accent }]} />
              <Text style={styles.legendText}>7-night average</Text>
            </View>
            {sel ? (
              <Pressable onPress={() => router.push(`/night/${sel.id}`)} accessibilityRole="button" accessibilityHint="Opens this night" style={styles.picked}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pickedDate}>Night of {longDate(sel.date)}</Text>
                  <Text style={styles.pickedLine}>
                    Score {sel.score}, {scoreLabel(sel.score).toLowerCase()} · {Math.round(sel.pctSnoring * 100)}% snoring
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
        <H2>Snapshots</H2>
        <Small>Lock a baseline, then compare later periods against it.</Small>
        {paid ? (
          <>
            {snapshots.map((s) => (
              <View key={s.id} style={styles.snapshot}>
                <View style={{ flex: 1 }}>
                  <Body>{s.name}</Body>
                  <Small>
                    {s.from_date} to {s.to_date} · average {Math.round(s.avg_score)}
                    {latestAvg !== null ? ` · now ${Math.round(latestAvg)} (${latestAvg - s.avg_score > 0 ? '+' : ''}${Math.round(latestAvg - s.avg_score)})` : ''}
                  </Small>
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
  hiveLegend: { flexDirection: 'row', flexWrap: 'wrap', gap: space(3), marginTop: space(3) },
  hiveKey: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  hexKey: { width: 10, height: 10, borderRadius: 3 },
  key: { width: 12, height: 3, borderRadius: 2 },
  legendText: { color: colors.textMuted, fontSize: 12, marginRight: space(3) },
  snapshot: { flexDirection: 'row', alignItems: 'center', paddingVertical: space(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
