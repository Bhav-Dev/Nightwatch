import { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { NightSummary } from '../../shared/remedyEffect';
import { track } from '../analytics';
import { listActiveCatalogue } from '../data/catalogueRepo';
import { type ClipRow, nightClips, setClipSaved } from '../data/clipRepo';
import { runningExperiments, type Experiment } from '../data/experimentRepo';
import { healthSamples, healthSummary } from '../data/healthRepo';
import { nightSummaries } from '../data/historyRepo';
import {
  averageScore,
  type EventRow,
  getNight,
  latestNight,
  logEditable,
  nightBins,
  nightEvents,
  nightLog,
  type NightRow,
  setNightTick,
  setTypical,
} from '../data/nightRepo';
import { getSetting, setSetting } from '../data/settingsRepo';
import type { CatalogueItem } from '../domain/catalogue';
import { experimentDay } from '../domain/experiment';
import type { AlignedSample } from '../domain/health';
import { clockTimeAt, INTERRUPTION_COPY } from '../domain/interruption';
import { intensityFor, scoreLabel, type Bin } from '../domain/scoring';
import { morningSummary } from '../domain/summary';
import { getHealthSource } from '../health';
import { importHealthForNight } from '../health/importNight';
import { useApp } from '../state/AppContext';
import { Chip } from '../ui/Chip';
import { NightTimeline } from '../ui/charts';
import { Body, Button, Card, H2, Loading, Locked, Screen, Small, GearLink } from '../ui/kit';
import { colors, intensityColor, radius, space } from '../ui/theme';
import { useClipPlayer } from './useClipPlayer';

interface Loaded {
  night: NightRow;
  bins: Bin[];
  events: EventRow[];
  clips: ClipRow[];
  samples: AlignedSample[];
  hrMean: number | null;
  log: { remedies: string[]; factors: { id: string; value: string | null }[] };
  history: NightSummary[];
  avg7: number | null;
  experiments: Experiment[];
  healthOffer: boolean;
}

const hm = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;

/** This Morning for the latest night, or any past night by id. */
export function NightView({ nightId }: { nightId?: string }) {
  const db = useSQLiteContext();
  const { paid, sync } = useApp();
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [catalogue, setCatalogue] = useState<Map<string, CatalogueItem>>(new Map());
  const [selectedBin, setSelectedBin] = useState<number | null>(null);
  const [overlay, setOverlay] = useState(false);
  const [showPrevent, setShowPrevent] = useState(false);
  const [editing, setEditing] = useState(false);
  const { toggle, playingUri } = useClipPlayer();

  const load = useCallback(async () => {
    const night = nightId ? await getNight(db, nightId) : await latestNight(db);
    setCatalogue(new Map((await listActiveCatalogue(db)).map((c) => [c.id, c])));
    if (!night) {
      setData(null);
      return;
    }
    // Health import the morning after, when the user has turned it on.
    const source = getHealthSource();
    const healthOn = (await getSetting(db, 'health_enabled')) === '1';
    if (healthOn && source && night.source === 'local' && !night.health_imported_at && Date.now() / 1000 > night.ended_at + 60) {
      await importHealthForNight(db, source, night).catch(() => undefined);
    }
    const nightCount = (await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM night', []))?.n ?? 0;
    const prompted = await getSetting(db, 'health_prompted_after');
    const [bins, events, clips, samples, summary, log, history, avg7, experiments] = await Promise.all([
      nightBins(db, night.id),
      nightEvents(db, night.id),
      nightClips(db, night.id),
      healthSamples(db, night.id),
      healthSummary(db, night.id),
      nightLog(db, night.id),
      nightSummaries(db),
      averageScore(db, 7),
      runningExperiments(db),
    ]);
    setData({
      night,
      bins,
      events,
      clips,
      samples,
      hrMean: summary?.hr_mean ?? null,
      log,
      history,
      avg7,
      experiments,
      // Spec: re-offer Health after the third night if it was skipped.
      healthOffer: !!source && !healthOn && nightCount >= 3 && prompted !== 'done',
    });
  }, [db, nightId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      if (!nightId) track({ name: 'morning_viewed' });
    }, [load, nightId]),
  );

  const summary = useMemo(() => {
    if (!data) return [];
    const { night, events, samples, hrMean, log, history, experiments } = data;
    const exp = experiments.find((e) => log.remedies.includes(e.remedyId));
    const day = exp ? experimentDay(exp.started, night.date) : null;
    return morningSummary({
      startedAtEpochS: night.started_at,
      pctSnoring: night.pct_snoring,
      events: events.map((e) => ({ startS: e.start_s, endS: e.end_s, intensity: e.intensity })),
      health: samples.length ? { samples, hrMean } : null,
      factorsLogged: log.factors.map((f) => ({ id: f.id, name: catalogue.get(f.id)?.name ?? f.id })),
      remediesLogged: log.remedies.map((r) => ({ id: r, name: catalogue.get(r)?.name ?? r })),
      history,
      experiment: exp && day ? { remedyId: exp.remedyId, day } : null,
    });
  }, [data, catalogue]);

  if (data === undefined) return <Screen eyebrow="This morning"><Loading /></Screen>;

  if (data === null) {
    return (
      <Screen eyebrow="This morning" right={<GearLink />}>
        <Card>
          <H2>No nights yet</H2>
          <Body muted>Record tonight and your score, timeline and loudest moments will be here in the morning.</Body>
          <Button label="Start tonight" onPress={() => router.navigate('/tonight')} style={{ marginTop: space(4) }} />
        </Card>
      </Screen>
    );
  }

  const { night, bins, clips, samples, log, avg7 } = data;
  const delta = avg7 === null ? null : Math.round(night.score - avg7);
  const editable = logEditable(night.date);
  const timelineBins = bins.map((b) => ({ index: b.index, snoreS: b.snoreS, intensity: b.snoreS > 0 ? intensityFor(b.maxDb) : null }));
  const binClip = (i: number) => clips.filter((c) => c.peak_s >= i * 300 && c.peak_s < (i + 1) * 300).sort((a, b) => b.peak_db - a.peak_db)[0] ?? null;
  const hasHealth = samples.length > 0;
  const overlayLines = overlay && hasHealth
    ? [
        { label: 'SpO2', color: colors.info, points: samples.filter((s) => s.kind === 'spo2' && s.value !== null).map((s) => ({ x: s.startS, y: s.value! })) },
        { label: 'Heart rate', color: colors.textMuted, points: samples.filter((s) => s.kind === 'hr' && s.value !== null).map((s) => ({ x: s.startS, y: s.value! })) },
      ].filter((l) => l.points.length > 1)
    : undefined;

  const onSelectBin = (i: number) => {
    setSelectedBin(i);
    const c = binClip(i);
    if (c) toggle(c.path);
  };

  const share = async (c: ClipRow) => {
    if (!(await Sharing.isAvailableAsync())) return Alert.alert('Sharing is not available on this device');
    await Sharing.shareAsync(c.path, { mimeType: c.codec === 'wav' ? 'audio/wav' : 'audio/ogg', dialogTitle: 'Share this clip' });
  };

  const toggleSaved = async (c: ClipRow) => {
    await setClipSaved(db, c.id, c.saved !== 1);
    await load();
  };

  const tick = async (item: CatalogueItem) => {
    const on = item.type === 'remedy' ? log.remedies.includes(item.id) : log.factors.some((f) => f.id === item.id);
    let value: string | null = null;
    let next = !on;
    if (item.value_options) {
      const cur = log.factors.find((f) => f.id === item.id)?.value ?? '';
      const nextValue = item.value_options[item.value_options.indexOf(cur) + 1];
      next = nextValue !== undefined;
      value = nextValue ?? null;
    }
    await setNightTick(db, night.id, { itemId: item.id, type: item.type, value }, next);
    await load();
    void sync();
  };

  const answerTypical = async (typical: boolean) => {
    await setTypical(db, night.id, typical);
    await load();
    void sync();
  };

  const enableHealth = async () => {
    const source = getHealthSource();
    if (!source) return;
    const ok = await source.requestPermission().catch(() => false);
    await setSetting(db, 'health_prompted_after', 'done');
    if (ok) {
      await setSetting(db, 'health_enabled', '1');
      await importHealthForNight(db, source, night).catch(() => undefined);
    }
    await load();
  };

  const loggedItems = [
    ...log.remedies.map((id) => catalogue.get(id)).filter((c): c is CatalogueItem => !!c),
    ...log.factors.map((f) => catalogue.get(f.id)).filter((c): c is CatalogueItem => !!c),
  ];
  const editItems = editing ? [...catalogue.values()] : loggedItems;
  const factorValue = (id: string) => log.factors.find((f) => f.id === id)?.value;

  return (
    <Screen
      eyebrow={nightId ? 'Night' : 'This morning'}
      title={new Date(night.started_at * 1000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      right={nightId ? undefined : <GearLink />}
    >
      {night.partial === 1 && (
        <Pressable style={styles.banner} onPress={() => setShowPrevent((v) => !v)} accessibilityRole="button">
          <Text style={styles.bannerTitle}>
            {night.interrupted_at_s !== null ? `Recording stopped at ${clockTimeAt(night.started_at, night.interrupted_at_s)}` : 'Recording was interrupted'}
          </Text>
          {night.interrupt_cause ? <Text style={styles.bannerText}>{INTERRUPTION_COPY[night.interrupt_cause].cause}</Text> : null}
          <Text style={styles.bannerLink}>How to prevent this</Text>
          {showPrevent && night.interrupt_cause ? <Text style={styles.bannerText}>{INTERRUPTION_COPY[night.interrupt_cause].prevent}</Text> : null}
        </Pressable>
      )}

      <Card>
        <Text style={styles.score} accessibilityLabel={`Snore score ${night.score}, ${scoreLabel(night.score)}`}>
          {night.score}
        </Text>
        <Text style={styles.label}>
          {scoreLabel(night.score)}
          {delta !== null && delta !== 0 ? `  ${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} vs your 7-night average` : ''}
        </Text>
        <View style={styles.stats}>
          <Stat label="Time snoring" value={`${Math.round(night.pct_snoring * 100)}%`} />
          <Stat label="Time in bed" value={hm(night.time_in_bed_s)} />
          <Stat label="Loudest" value={night.event_count > 0 ? intensityFor(night.max_db) : '–'} />
        </View>
        {night.counts_toward_averages === 0 ? <Small style={{ marginTop: space(3) }}>Under 3 hours, so this night is left out of your averages.</Small> : null}
      </Card>

      {night.typical === null && night.source === 'local' && (
        <Card>
          <H2>Was this your typical night?</H2>
          <Small>Unusual nights (ill, travelling, a party) are kept out of the community results.</Small>
          <View style={{ flexDirection: 'row', gap: space(3), marginTop: space(3) }}>
            <Button kind="secondary" label="Yes" onPress={() => answerTypical(true)} style={{ flex: 1 }} />
            <Button kind="secondary" label="No" onPress={() => answerTypical(false)} style={{ flex: 1 }} />
          </View>
        </Card>
      )}

      {summary.length > 0 && (
        <Card>
          <H2>Summary</H2>
          <Body>{paid ? summary.join(' ') : summary[0]}</Body>
          {!paid && summary.length > 1 ? <Locked label="See the full summary with your watch data and what you logged" trigger="summary" /> : null}
        </Card>
      )}

      {bins.length > 0 ? (
        <Card>
          <H2
            right={
              hasHealth ? (
                paid ? (
                  <Button kind="link" label={overlay ? 'Hide watch data' : 'Show watch data'} onPress={() => setOverlay((o) => !o)} />
                ) : null
              ) : null
            }
          >
            Timeline
          </H2>
          <NightTimeline bins={timelineBins} startedAtS={night.started_at} onSelect={onSelectBin} selected={selectedBin} overlay={overlayLines} />
          <View style={styles.legend}>
            {(['quiet', 'light', 'loud', 'epic'] as const).map((k) => (
              <View key={k} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: intensityColor[k] }]} />
                <Text style={styles.legendText}>{k}</Text>
              </View>
            ))}
          </View>
          {selectedBin !== null ? (
            <Small style={{ marginTop: space(2) }}>
              {clockTimeAt(night.started_at, selectedBin * 300)}: {Math.round(bins[selectedBin].snoreS / 60)} min snoring
              {binClip(selectedBin) ? (playingUri ? ' · playing' : '') : ' · no clip here'}
            </Small>
          ) : (
            <Small style={{ marginTop: space(2) }}>Tap a bar to hear its loudest moment.</Small>
          )}
          {hasHealth && !paid ? <Locked label="See oxygen and heart rate on the same timeline" trigger="overlay" /> : null}
        </Card>
      ) : night.source === 'remote' ? (
        <Card>
          <Small>This night was recorded on another device, so its timeline and clips are there.</Small>
        </Card>
      ) : null}

      {data.healthOffer && (
        <Card>
          <H2>Add your watch data</H2>
          <Body muted>See oxygen, heart rate and sleep stages alongside your snoring. Health data stays on this phone; only a nightly summary syncs.</Body>
          <Button kind="secondary" label="Connect" onPress={enableHealth} style={{ marginTop: space(3) }} />
          <Button kind="link" label="Not now" onPress={async () => { await setSetting(db, 'health_prompted_after', 'done'); await load(); }} />
        </Card>
      )}

      {clips.length > 0 && (
        <Card>
          <H2>Loudest moments</H2>
          {clips.slice(0, 5).map((c) => (
            <View key={c.id} style={styles.clipRow}>
              <Pressable accessibilityRole="button" accessibilityLabel={playingUri === c.path ? 'Pause' : 'Play'} onPress={() => toggle(c.path)} style={styles.play}>
                <Text style={styles.playGlyph}>{playingUri === c.path ? '❚❚' : '▶'}</Text>
              </Pressable>
              <View style={{ flex: 1 }}>
                <Text style={styles.clipTime}>{clockTimeAt(night.started_at, c.peak_s)}</Text>
                <Small>{intensityFor(Math.max(0, c.peak_db - night.floor_db))} · {c.end_s - c.start_s} s</Small>
              </View>
              <Button kind="link" label={c.saved ? 'Saved' : 'Save'} onPress={() => toggleSaved(c)} />
              <Button kind="link" label="Share" onPress={() => share(c)} />
            </View>
          ))}
        </Card>
      )}

      <Card>
        <H2 right={editable ? <Button kind="link" label={editing ? 'Done' : 'Edit'} onPress={() => setEditing((e) => !e)} /> : undefined}>Last night’s log</H2>
        {editItems.length === 0 ? <Small>Nothing logged, so this night counts as a “nothing tried” baseline.</Small> : null}
        <ScrollView horizontal={!editing} showsHorizontalScrollIndicator={false}>
          <View style={editing ? styles.wrap : styles.rowChips}>
            {editItems.map((item) => {
              const v = factorValue(item.id);
              const on = item.type === 'remedy' ? log.remedies.includes(item.id) : log.factors.some((f) => f.id === item.id);
              return <Chip key={item.id} label={v ? `${item.name} · ${v}` : item.name} selected={on} onPress={() => (editing ? tick(item) : undefined)} />;
            })}
          </View>
        </ScrollView>
        {!editable ? <Small style={{ marginTop: space(2) }}>The log can be edited until noon the next day.</Small> : null}
      </Card>
      {nightId ? null : (
        <Button kind="link" label="Past nights" onPress={() => router.push('/trends')} />
      )}
    </Screen>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statValue}>{value}</Text>
      <Small>{label}</Small>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: { backgroundColor: colors.warningSurface, borderRadius: radius.button, padding: space(3), marginBottom: space(3) },
  bannerTitle: { color: colors.accent, fontWeight: '700', marginBottom: space(1) },
  bannerText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bannerLink: { color: colors.accent, fontSize: 14, marginTop: space(1), textDecorationLine: 'underline' },
  score: { color: colors.text, fontSize: 72, fontWeight: '800' },
  label: { color: colors.accent, fontSize: 18, fontWeight: '700', marginBottom: space(4) },
  stats: { flexDirection: 'row' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '700', textTransform: 'capitalize' },
  legend: { flexDirection: 'row', gap: space(4), marginTop: space(3) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { color: colors.textMuted, fontSize: 12, textTransform: 'capitalize' },
  clipRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2) },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  playGlyph: { color: colors.text, fontSize: 14 },
  clipTime: { color: colors.text, fontSize: 16, fontWeight: '600' },
  rowChips: { flexDirection: 'row' },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
});

// Clip files are plain files; expose a helper for Settings to remove them all.
export function removeClipFile(path: string) {
  const f = new File(path);
  if (f.exists) f.delete();
}
