import Ionicons from '@expo/vector-icons/Ionicons';
import { randomUUID } from 'expo-crypto';
import { File } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import type { NightSummary } from '../../shared/remedyEffect';
import { track } from '../analytics';
import { listActiveCatalogue } from '../data/catalogueRepo';
import { type ClipRow, nightClips, setClipSaved } from '../data/clipRepo';
import { runningExperiments, type Experiment } from '../data/experimentRepo';
import { healthSamples, healthSummary } from '../data/healthRepo';
import { nightSummaries } from '../data/historyRepo';
import { addLabel, clearLabels, nightLabels, type SoundLabelRow, stretchLoudness } from '../data/labelRepo';
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
import { nightSoundSegments, type SoundSegmentRow } from '../data/soundRepo';
import { allNightWeather, nightWeather, type NightWeatherRow, updateMorningWeather } from '../data/weatherRepo';
import { WEATHER_ATTRIBUTION, WEATHER_LICENSE_URL, weatherAreaKey } from '../../shared/weather';
import { conditionFor, describeWeather, weatherBands, weatherFactorIds } from '../domain/weather';
import { fetchWeatherHere } from '../weather/weatherClient';
import type { CatalogueItem } from '../domain/catalogue';
import { experimentDay } from '../domain/experiment';
import type { AlignedSample } from '../domain/health';
import { clipsForDisplay } from '../domain/clipList';
import { clockTimeAt, INTERRUPTION_COPY } from '../domain/interruption';
import { buildMoments, momentAt, neighbour } from '../domain/moments';
import { intensityFor, scoreLabel, type Bin } from '../domain/scoring';
import { isSnoringAt } from '../domain/scoring/corrections';
import { sleepSoundName } from '../domain/sleepSounds';
import { morningSummary } from '../domain/summary';
import { getHealthSource } from '../health';
import { importHealthForNight } from '../health/importNight';
import { useApp } from '../state/AppContext';
import { NightTimeline } from '../ui/charts';
import { HiveCluster, ScoreCell } from '../ui/Hive';
import { iconFor } from '../ui/remedyIcons';
import { SnoringToggle } from '../ui/SnoringToggle';
import { Body, Button, Card, H2, Loading, Locked, Screen, Small, GearLink } from '../ui/kit';
import { colors, fonts, intensityColor, morningSky, radius, space } from '../ui/theme';
import { LogPicker } from './LogPicker';
import { MomentPanel } from './MomentPanel';
import { maybeAskForReview, type Engagement } from './reviewAsk';
import { cancelRecap } from '../notifications';
import { useClipPlayer } from './useClipPlayer';

interface Loaded {
  night: NightRow;
  bins: Bin[];
  events: EventRow[];
  clips: ClipRow[];
  /** The night's recorded sound, in time order (empty when sound recording was off). */
  sounds: SoundSegmentRow[];
  /** The user's "was this snoring?" answers, in order. */
  labels: SoundLabelRow[];
  nightCount: number;
  /** The night's weather, if it was fetched, and every night's (for comparing nights by weather). */
  weather: NightWeatherRow | null;
  weatherByNight: Map<string, NightWeatherRow>;
  samples: AlignedSample[];
  hrMean: number | null;
  log: { remedies: string[]; factors: { id: string; value: string | null }[] };
  history: NightSummary[];
  avg7: number | null;
  experiments: Experiment[];
  healthOffer: boolean;
}

const hm = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** This Morning for the latest night, or any past night by id. */
export function NightView({ nightId, fromRecap = false }: { nightId?: string; fromRecap?: boolean }) {
  const db = useSQLiteContext();
  const { paid, sync } = useApp();
  const [data, setData] = useState<Loaded | null | undefined>(undefined);
  const [catalogue, setCatalogue] = useState<Map<string, CatalogueItem>>(new Map());
  /** The second of the night picked on the timeline or with previous and next. */
  const [cursorS, setCursorS] = useState<number | null>(null);
  const [answering, setAnswering] = useState(false);
  /** What the user did on this visit, for choosing a good moment to ask for a review. */
  const engagement = useRef<Engagement>({ plays: 0, answers: 0, corrections: 0 });
  const [overlay, setOverlay] = useState(false);
  const [showPrevent, setShowPrevent] = useState(false);
  const [editing, setEditing] = useState(false);
  const advance = useRef<(uri: string) => void>(() => undefined);
  /** The morning weather refresh runs at most once per visit. */
  const weatherRefreshed = useRef(false);
  const { toggle, play, seekBy, stop, playingUri, positionS, durationS } = useClipPlayer({ onFinished: (uri) => advance.current(uri) });
  /** The recorded-sound segment playing (null when a clip, or nothing, is playing). */
  const [playingSegId, setPlayingSegId] = useState<string | null>(null);

  // When a stretch of sound ends, carry on with the next one, so the night plays through.
  useEffect(() => {
    advance.current = (uri) => {
      const sounds = data?.sounds ?? [];
      const i = sounds.findIndex((s) => s.path === uri);
      if (i < 0) {
        // A clip finished: nothing to carry on to, and a calm moment to maybe ask for a review.
        if (data) void maybeAskForReview(db, { night: data.night, nightCount: data.nightCount, fromRecap, engagement: engagement.current });
        return;
      }
      const next = sounds[i + 1];
      if (next) {
        setPlayingSegId(next.id);
        play(next.path, 0);
      } else {
        setPlayingSegId(null);
      }
    };
  });

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
    const [bins, events, clips, sounds, labels, weatherRows, samples, summary, log, history, avg7, experiments] = await Promise.all([
      nightBins(db, night.id),
      nightEvents(db, night.id),
      nightClips(db, night.id),
      nightSoundSegments(db, night.id),
      nightLabels(db, night.id),
      allNightWeather(db),
      healthSamples(db, night.id),
      healthSummary(db, night.id),
      nightLog(db, night.id),
      nightSummaries(db),
      averageScore(db, 7),
      runningExperiments(db),
    ]);
    const weatherByNight = new Map(weatherRows.map((w) => [w.night_id, w]));
    const weather = weatherByNight.get(night.id) ?? null;
    setData({
      night,
      bins,
      events,
      clips,
      sounds,
      labels,
      nightCount,
      weather,
      weatherByNight,
      samples,
      hrMean: summary?.hr_mean ?? null,
      log,
      history,
      avg7,
      experiments,
      // Spec: re-offer Health after the third night if it was skipped.
      healthOffer: !!source && !healthOn && nightCount >= 3 && prompted !== 'done',
    });

    // This morning, once: a fresher look at the weather than the bedtime forecast, if it is old or missing.
    const nowS = Date.now() / 1000;
    if (!nightId && !weatherRefreshed.current && nowS - night.ended_at < 12 * 3600 && (!weather || nowS - weather.fetched_at > 3 * 3600)) {
      // Only count it as tried once weather is on, so turning weather on later still fills this morning in.
      if ((await getSetting(db, 'weather')) !== 'on') return;
      weatherRefreshed.current = true;
      const forecast = await fetchWeatherHere();
      const hour = forecast?.hours.find((h) => {
        const t = Date.parse(h.time) / 1000;
        return t <= nowS && t + 3600 > nowS;
      });
      if (!forecast || !hour) return;
      const at = Math.floor(Date.now() / 1000);
      await updateMorningWeather(db, night.id, hour.symbol, hour.tempC, weatherAreaKey(forecast.area), at);
      const fresh = await nightWeather(db, night.id);
      setData((d) => (d && d.night.id === night.id && fresh ? { ...d, weather: fresh, weatherByNight: new Map(d.weatherByNight).set(night.id, fresh) } : d));
    }
  }, [db, nightId]);

  useFocusEffect(
    useCallback(() => {
      void load();
      if (!nightId) track({ name: 'morning_viewed' });
      // The night changes with the user's answers, so a new visit starts afresh.
      engagement.current = { plays: 0, answers: 0, corrections: 0 };
    }, [load, nightId]),
  );

  const summary = useMemo(() => {
    if (!data) return [];
    const { night, events, samples, hrMean, log, history, experiments, weather, weatherByNight } = data;
    const exp = experiments.find((e) => log.remedies.includes(e.remedyId));
    const day = exp ? experimentDay(exp.started, night.date) : null;
    // Weather is compared like a factor: each night's bands join its history entry (on this phone only).
    const withWeather = history.map((h) => {
      const w = weatherByNight.get(h.id);
      const ids = weatherFactorIds(w ? { tempMeanC: w.temp_mean_c, humidityMean: w.humidity_mean } : null);
      return ids.length ? { ...h, factors: [...h.factors, ...ids.map((id) => ({ id, value: null }))] } : h;
    });
    return morningSummary({
      startedAtEpochS: night.started_at,
      pctSnoring: night.pct_snoring,
      events: events.map((e) => ({ startS: e.start_s, endS: e.end_s, intensity: e.intensity })),
      health: samples.length ? { samples, hrMean } : null,
      factorsLogged: log.factors.map((f) => ({ id: f.id, name: catalogue.get(f.id)?.name ?? f.id })),
      remediesLogged: log.remedies.map((r) => ({ id: r, name: catalogue.get(r)?.name ?? r })),
      history: withWeather,
      experiment: exp && day ? { remedyId: exp.remedyId, day } : null,
      weatherBands: weather ? weatherBands({ tempMeanC: weather.temp_mean_c, humidityMean: weather.humidity_mean }) : [],
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

  const { night, bins, clips, samples, log, avg7, weather } = data;
  // "Light rain, 9°C · overnight 11°C, 82% humidity"
  const morningWords = weather ? describeWeather(weather.morning_symbol, weather.morning_temp_c) : null;
  const overnight =
    weather && weather.temp_mean_c !== null
      ? `overnight ${Math.round(weather.temp_mean_c)}°C${weather.humidity_mean !== null ? `, ${Math.round(weather.humidity_mean)}% humidity` : ''}`
      : null;
  const weatherLine = [morningWords, overnight].filter(Boolean).join(' · ') || null;
  const delta = avg7 === null ? null : Math.round(night.score - avg7);
  const editable = logEditable(night.date);
  const timelineBins = bins.map((b) => ({ index: b.index, snoreS: b.snoreS, levelDb: b.meanDb, intensity: b.snoreS > 0 ? intensityFor(b.maxDb) : null }));
  const binClip = (i: number) => clips.filter((c) => c.peak_s >= i * 300 && c.peak_s < (i + 1) * 300).sort((a, b) => b.peak_db - a.peak_db)[0] ?? null;
  const hasHealth = samples.length > 0;
  const overlayLines = overlay && hasHealth
    ? [
        { label: 'SpO2', color: colors.info, points: samples.filter((s) => s.kind === 'spo2' && s.value !== null).map((s) => ({ x: s.startS, y: s.value! })) },
        { label: 'Heart rate', color: colors.textMuted, points: samples.filter((s) => s.kind === 'hr' && s.value !== null).map((s) => ({ x: s.startS, y: s.value! })) },
      ].filter((l) => l.points.length > 1)
    : undefined;

  const { sounds, events, labels } = data;
  const snoring = events.map((e) => ({ startS: e.start_s, endS: e.end_s, peakDb: e.peak_db }));
  const snoreClips = clips.filter((c) => c.kind !== 'other');
  const otherClips = clips.filter((c) => c.kind === 'other');
  const moments = buildMoments({
    snoring,
    other: [
      ...otherClips.map((c) => ({ startS: c.start_s, endS: c.end_s, peakDb: Math.max(0, c.peak_db - night.floor_db) })),
      ...labels.filter((l) => l.label === 'not_snore').map((l) => ({ startS: l.start_s, endS: l.end_s, peakDb: l.peak_db })),
    ],
    recorded: sounds.map((s) => ({ startS: s.start_s, endS: s.end_s })),
    answered: labels.map((l) => ({ startS: l.start_s, endS: l.end_s })),
  });

  /** The recorded sound at a second of the night, or the next one starting in the same 5 minutes. */
  const soundAt = (atS: number) =>
    sounds.find((s) => atS >= s.start_s && atS < s.end_s) ?? sounds.find((s) => s.start_s >= atS && s.start_s < atS + 300) ?? null;
  /** On nights without recorded sound: the clip for a moment, else the loudest in that 5 minutes. */
  const clipAt = (atS: number) => {
    const m = momentAt(moments, atS);
    const inMoment = m ? clips.filter((c) => c.start_s < m.endS && c.end_s > m.startS).sort((a, b) => b.peak_db - a.peak_db)[0] : undefined;
    return inMoment ?? binClip(Math.floor(atS / 300));
  };

  /** Picks a second of the night and plays from it. */
  const playAt = (atS: number) => {
    setCursorS(atS);
    engagement.current.plays++;
    if (sounds.length > 0) {
      // Nights with recorded sound: play the night from that moment.
      const seg = soundAt(atS);
      if (seg) {
        setPlayingSegId(seg.id);
        play(seg.path, Math.max(0, atS - seg.start_s));
      } else {
        setPlayingSegId(null);
        stop();
      }
      return;
    }
    // Older nights: the clip there; a stretch with no clip stops playback.
    setPlayingSegId(null);
    const c = clipAt(atS);
    if (c) play(c.path, Math.max(0, atS - c.start_s));
    else stop();
  };
  const onSelectTime = (_i: number, atS: number) => playAt(atS);
  const playClip = (path: string) => {
    setPlayingSegId(null);
    engagement.current.plays++;
    toggle(path);
  };
  const playingSeg = playingUri && playingSegId ? (sounds.find((s) => s.id === playingSegId && s.path === playingUri) ?? null) : null;
  const playingClip = playingUri && !playingSeg ? (clips.find((c) => c.path === playingUri) ?? null) : null;
  const playheadS = playingSeg ? playingSeg.start_s + positionS : playingClip ? playingClip.start_s + positionS : null;
  // Just after a jump the player may not have caught up yet, so the picked second wins for a moment.
  const focusS = playheadS !== null && (cursorS === null || Math.abs(playheadS - cursorS) >= 1.5) ? playheadS : cursorS;
  const moment = focusS !== null ? momentAt(moments, focusS) : null;
  const selectedBin = focusS !== null ? Math.min(bins.length - 1, Math.floor(focusS / 300)) : null;

  const step = (direction: 1 | -1) => {
    const m = neighbour(moments, focusS ?? -1, direction);
    if (m) playAt(m.startS);
  };

  /** The user's answer for a stretch: corrects the night, and is kept as a labelled example. */
  const answer = async (range: { startS: number; endS: number }, itWas: boolean, source: 'clip' | 'moment', clipPeakDb?: number) => {
    setAnswering(true);
    try {
      const wasSnoring = isSnoringAt(snoring, range.startS, range.endS);
      const loudness = await stretchLoudness(db, night.id, range.startS, range.endS, clipPeakDb);
      await addLabel(db, { id: randomUUID(), nightId: night.id, startS: range.startS, endS: range.endS, label: itWas ? 'snore' : 'not_snore', ...loudness, source });
      engagement.current.answers++;
      if (wasSnoring !== itWas) engagement.current.corrections++;
      track({ name: 'snoring_answered', snoring: itWas, source });
      // They have looked back at the night already, so the recap is not needed.
      void cancelRecap();
      await load();
      void sync();
      void maybeAskForReview(db, { night, nightCount: data.nightCount, fromRecap, engagement: engagement.current });
    } finally {
      setAnswering(false);
    }
  };
  const undo = async (range: { startS: number; endS: number }) => {
    await clearLabels(db, night.id, range.startS, range.endS);
    await load();
    void sync();
  };
  /** "Not snoring" on a clip covers the whole stretch of snoring it is part of. */
  const clipRange = (c: ClipRow) =>
    events
      .filter((e) => e.start_s < c.end_s && e.end_s > c.start_s)
      .reduce((r, e) => ({ startS: Math.min(r.startS, e.start_s), endS: Math.max(r.endS, e.end_s) }), { startS: c.start_s, endS: c.end_s });

  const clipRows = (list: ClipRow[]) =>
    clipsForDisplay(list, night.started_at).map(({ clip: c, time }) => {
      const isSnoring = isSnoringAt(snoring, c.start_s, c.end_s);
      return (
      <View key={c.id} style={styles.clipRow}>
        <Pressable accessibilityRole="button" accessibilityLabel={playingUri === c.path ? 'Pause' : 'Play'} onPress={() => playClip(c.path)} style={styles.play}>
          <Ionicons name={playingUri === c.path ? 'pause' : 'play'} size={18} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.clipTime}>{time}</Text>
          <Small>{intensityFor(Math.max(0, c.peak_db - night.floor_db))} · {c.end_s - c.start_s} s</Small>
          <View style={styles.clipActions}>
            <SnoringToggle
              snoring={isSnoring}
              disabled={answering}
              onPress={() => answer(isSnoring ? clipRange(c) : { startS: c.start_s, endS: c.end_s }, !isSnoring, 'clip', c.peak_db - night.floor_db)}
            />
            <Button kind="link" label={c.saved ? 'Saved' : 'Save'} onPress={() => toggleSaved(c)} />
            <Button kind="link" label="Share" onPress={() => share(c)} />
          </View>
        </View>
      </View>
      );
    });

  const share = async (c: ClipRow) => {
    if (!(await Sharing.isAvailableAsync())) return Alert.alert('Sharing is not available on this device');
    await Sharing.shareAsync(c.path, { mimeType: c.codec === 'wav' ? 'audio/wav' : 'audio/ogg', dialogTitle: 'Share this clip' });
  };

  const toggleSaved = async (c: ClipRow) => {
    await setClipSaved(db, c.id, c.saved !== 1);
    await load();
  };

  const setLogTick = async (item: CatalogueItem, value: string | null, on: boolean) => {
    await setNightTick(db, night.id, { itemId: item.id, type: item.type, value }, on);
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

  // Free-text remedies are stored as "other:<text>" and are not in the catalogue.
  const loggedItems = [
    ...log.remedies
      .map((id): CatalogueItem | undefined =>
        id.startsWith('other:')
          ? { id, type: 'remedy', kind: 'habit', category: 'Other', name: id.slice('other:'.length), article_md: '', link_url: null, shop: false, amazon: null, active: true, version: 0 }
          : catalogue.get(id),
      )
      .filter((c): c is CatalogueItem => !!c),
    ...log.factors.map((f) => catalogue.get(f.id)).filter((c): c is CatalogueItem => !!c),
  ];
  const factorValue = (id: string) => log.factors.find((f) => f.id === id)?.value;
  /** "Alcohol, 2 units" for a factor with a value, else the name. */
  const logName = (item: CatalogueItem) => {
    const v = factorValue(item.id);
    return v ? `${item.name}, ${v} units` : item.name;
  };
  const logSelection = new Map<string, string | null>([
    ...log.remedies.map((id): [string, string | null] => [id, null]),
    ...log.factors.map((f): [string, string | null] => [f.id, f.value ?? null]),
  ]);

  return (
    <Screen
      sky={morningSky(conditionFor(weather?.morning_symbol ?? null))}
      subtitle={weatherLine}
      eyebrow={nightId ? 'Night' : 'This morning'}
      title={new Date(night.started_at * 1000).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}
      right={nightId ? undefined : <GearLink />}
      footer={
        playingSeg ? (
          <View style={styles.nowPlaying} accessibilityLiveRegion="polite">
            <View style={{ flex: 1 }}>
              <Text style={styles.nowPlayingTitle}>Playing {clockTimeAt(night.started_at, playingSeg.start_s + Math.floor(positionS), { seconds: true })}</Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(100, (positionS / Math.max(1, durationS || playingSeg.end_s - playingSeg.start_s)) * 100)}%` }]} />
              </View>
              <Small>The night plays on through each stretch of sound.</Small>
            </View>
            <Pressable onPress={() => seekBy(-15)} accessibilityRole="button" accessibilityLabel="Back 15 seconds" style={styles.skipButton} hitSlop={6}>
              <Text style={styles.skipLabel}>−15</Text>
            </Pressable>
            <Pressable onPress={stop} accessibilityRole="button" accessibilityLabel="Stop playing" style={styles.stopButton}>
              <Text style={styles.stopLabel}>Stop</Text>
            </Pressable>
            <Pressable onPress={() => seekBy(15)} accessibilityRole="button" accessibilityLabel="Forward 15 seconds" style={styles.skipButton} hitSlop={6}>
              <Text style={styles.skipLabel}>+15</Text>
            </Pressable>
          </View>
        ) : playingClip ? (
          <View style={styles.nowPlaying} accessibilityLiveRegion="polite">
            <View style={{ flex: 1 }}>
              <Text style={styles.nowPlayingTitle}>
                Playing {clockTimeAt(night.started_at, playingClip.peak_s)} · {intensityFor(Math.max(0, playingClip.peak_db - night.floor_db))}
              </Text>
              <View style={styles.progressTrack}>
                <View style={[styles.progressFill, { width: `${Math.min(100, (positionS / Math.max(1, durationS || playingClip.end_s - playingClip.start_s)) * 100)}%` }]} />
              </View>
              <Small>
                {mmss(positionS)} / {mmss(durationS || playingClip.end_s - playingClip.start_s)}
              </Small>
            </View>
            <Pressable onPress={stop} accessibilityRole="button" accessibilityLabel="Stop playing" style={styles.stopButton}>
              <Text style={styles.stopLabel}>Stop</Text>
            </Pressable>
          </View>
        ) : undefined
      }
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
        <View style={styles.scoreRow}>
          <ScoreCell score={night.score} />
          <View style={styles.scoreText}>
            <Text style={styles.label}>{scoreLabel(night.score)}</Text>
            {delta !== null && delta !== 0 ? (
              <Text style={styles.delta}>
                {delta > 0 ? '↑' : '↓'} {Math.abs(delta)} vs your 7-night average
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.stats}>
          <Stat label="Time snoring" value={`${Math.round(night.pct_snoring * 100)}%`} />
          <Stat label="Time in bed" value={hm(night.time_in_bed_s)} />
          <Stat label="Loudest" value={night.event_count > 0 ? intensityFor(night.max_db) : '–'} />
        </View>
        {night.detector_score !== null && labels.length > 0 && night.detector_score !== night.score ? (
          <Small style={{ marginTop: space(3) }}>Was {night.detector_score} before your answers about what was snoring.</Small>
        ) : null}
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
          <NightTimeline
            bins={timelineBins}
            startedAtS={night.started_at}
            onSelect={onSelectTime}
            selected={selectedBin}
            recorded={sounds.map((s) => ({ startS: s.start_s, endS: s.end_s }))}
            playheadS={playheadS}
            cursorS={cursorS}
            highlight={moment}
            moments={moments}
            onStep={step}
            soundUntilS={night.sleep_sound ? night.sleep_sound_until_s : null}
            overlay={overlayLines}
          />
          <View style={styles.legend}>
            {(['quiet', 'light', 'loud', 'epic'] as const).map((k) => (
              <View key={k} style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: intensityColor[k] }]} />
                <Text style={styles.legendText}>{k}</Text>
              </View>
            ))}
            {sounds.length > 0 ? (
              <View style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: colors.info, height: 3 }]} />
                <Text style={styles.legendText}>recorded</Text>
              </View>
            ) : null}
            {night.sleep_sound ? (
              <View style={styles.legendItem}>
                <View style={[styles.swatch, { backgroundColor: colors.info, opacity: 0.25 }]} />
                <Text style={styles.legendText}>sleep sounds</Text>
              </View>
            ) : null}
          </View>
          {night.sleep_sound && night.sleep_sound_until_s ? (
            <Small style={{ marginTop: space(2) }}>
              {sleepSoundName(night.sleep_sound)} played until {clockTimeAt(night.started_at, night.sleep_sound_until_s)}. Snoring then is measured against the sound.
            </Small>
          ) : null}
          <MomentPanel
            startedAtS={night.started_at}
            moments={moments}
            moment={moment}
            focusS={focusS}
            playing={playingSeg !== null || playingClip !== null}
            busy={answering}
            onStep={step}
            onPlay={() => (playingSeg || playingClip ? stop() : moment && playAt(moment.startS))}
            onAnswer={(snoring) => moment && answer(moment, snoring, 'moment')}
            onUndo={() => moment && undo(moment)}
          />
          {moments.length === 0 ? (
            <Small style={{ marginTop: space(2) }}>
              {selectedBin !== null
                ? `${clockTimeAt(night.started_at, selectedBin * 300)}: quiet, nothing recorded here`
                : 'A quiet night: nothing loud enough to keep.'}
            </Small>
          ) : null}
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

      {snoreClips.length > 0 && (
        <Card>
          <H2>Loudest moments</H2>
          {clipRows(snoreClips)}
        </Card>
      )}

      {otherClips.length > 0 && (
        <Card>
          <H2>Other sounds</H2>
          <Small>The loudest moments that were not counted as snoring. Have a listen to check.</Small>
          {clipRows(otherClips)}
        </Card>
      )}

      <Card>
        <H2 right={editable ? <Button kind="link" label="Edit" onPress={() => setEditing(true)} /> : undefined}>Last night’s log</H2>
        {loggedItems.length === 0 ? <Small>Nothing logged, so this night counts as a “nothing tried” baseline.</Small> : null}
        {loggedItems.length > 0 ? (
          <Pressable
            onPress={editable ? () => setEditing(true) : undefined}
            disabled={!editable}
            accessibilityRole={editable ? 'button' : undefined}
            accessibilityLabel={loggedItems.map(logName).join(', ')}
            style={styles.hive}
          >
            <HiveCluster
              items={loggedItems.map((item) => ({ key: item.id, icon: iconFor(item), kind: item.type === 'factor' ? 'factor' : 'remedy', badge: factorValue(item.id) }))}
            />
            <Text style={styles.names}>{loggedItems.map(logName).join(' · ')}</Text>
          </Pressable>
        ) : null}
        {!editable ? <Small style={{ marginTop: space(2) }}>The log can be edited until noon the next day.</Small> : null}
      </Card>
      <LogPicker
        visible={editing}
        title="Last night’s log"
        types={['remedy', 'factor']}
        items={[...catalogue.values()]}
        selected={logSelection}
        onSet={setLogTick}
        onClose={() => setEditing(false)}
      />
      {nightId ? null : (
        <Button kind="link" label="Past nights" onPress={() => router.push('/trends')} />
      )}
      {weather ? (
        <Pressable onPress={() => Linking.openURL(WEATHER_LICENSE_URL)} accessibilityRole="link" style={{ marginTop: space(2) }}>
          <Small>{WEATHER_ATTRIBUTION}</Small>
        </Pressable>
      ) : null}
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
  // Solid enough to read on the bright sunrise sky as well as at night.
  banner: { backgroundColor: 'rgba(58, 40, 14, 0.92)', borderRadius: radius.button, padding: space(3), marginBottom: space(3) },
  bannerTitle: { color: colors.accent, fontWeight: '700', marginBottom: space(1) },
  bannerText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bannerLink: { color: colors.accent, fontSize: 14, marginTop: space(1), textDecorationLine: 'underline' },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: space(4), marginBottom: space(4) },
  scoreText: { flex: 1, gap: space(1) },
  label: { color: colors.accent, fontSize: 22, fontFamily: fonts.heading },
  delta: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  stats: { flexDirection: 'row' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '700', textTransform: 'capitalize' },
  legend: { flexDirection: 'row', gap: space(4), marginTop: space(3) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space(1.5) },
  swatch: { width: 10, height: 10, borderRadius: 2 },
  legendText: { color: colors.textMuted, fontSize: 12, textTransform: 'capitalize' },
  clipRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2) },
  clipActions: { flexDirection: 'row', alignItems: 'center', gap: space(3), marginTop: space(1.5) },
  play: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  clipTime: { color: colors.text, fontSize: 16, fontWeight: '600' },
  hive: { gap: space(2), marginTop: space(1) },
  names: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  nowPlaying: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space(4),
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.card,
    paddingHorizontal: space(4),
    paddingVertical: space(3),
  },
  nowPlayingTitle: { color: colors.text, fontSize: 16, fontWeight: '700' },
  progressTrack: { height: 3, borderRadius: 2, backgroundColor: colors.border, marginVertical: space(2), overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: colors.accent },
  stopButton: { backgroundColor: colors.accent, borderRadius: radius.button, paddingHorizontal: space(5), paddingVertical: space(3) },
  skipButton: { paddingHorizontal: space(1), paddingVertical: space(3) },
  skipLabel: { color: colors.text, fontSize: 15, fontWeight: '700' },
  stopLabel: { color: colors.accentText, fontSize: 16, fontWeight: '800' },
});

// Clip files are plain files; expose a helper for Settings to remove them all.
export function removeClipFile(path: string) {
  const f = new File(path);
  if (f.exists) f.delete();
}
