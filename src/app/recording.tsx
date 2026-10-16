import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';

import { ExpoClipFiles } from '../clips/expoClipFiles';
import { getNight } from '../data/nightRepo';
import { getSetting } from '../data/settingsRepo';
import { durationBand, track } from '../analytics';
import { notifyNightReady } from '../notifications';
import { useApp } from '../state/AppContext';
import type { Sensitivity } from '../domain/scoring';
import { NoisePlayer } from '../../modules/nightwatch-recording-service/src';
import { DEFAULT_SLEEP_TIMER_MINUTES, SLEEP_SOUND_FADE_S, SLEEP_SOUND_GAIN, SLEEP_SOUNDS, sleepSoundName, type SleepSoundKind } from '../domain/sleepSounds';
import { getAudioCapture } from '../native';
import { NativeSegmentWriter, soundRecordingAvailable } from '../native/soundWriter';
import { RecordingSession } from '../recording/recordingSession';
import { BreathingMoon, NightSky } from '../ui/NightSky';
import { fetchWeatherHere } from '../weather/weatherClient';
import { colors, fonts, radius, space } from '../ui/theme';

const formatElapsed = (s: number) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/** Recording stops by itself at this hour (local) the next morning, or after 12 hours. */
export const DEFAULT_AUTO_STOP_HOUR = 11;
const MAX_RECORDING_MS = 12 * 3600_000;

function autoStopAt(start: Date, hour: number): number {
  const t = new Date(start);
  t.setHours(hour, 0, 0, 0);
  if (t.getTime() <= start.getTime() + 3600_000) t.setDate(t.getDate() + 1);
  return Math.min(t.getTime(), start.getTime() + MAX_RECORDING_MS);
}

export default function Recording() {
  const db = useSQLiteContext();
  const { sync } = useApp();
  const stopAt = useRef<number>(Number.MAX_SAFE_INTEGER);
  const session = useRef<RecordingSession | null>(null);
  const finishing = useRef(false);
  const [elapsedS, setElapsedS] = useState(0);
  const [levelDb, setLevelDb] = useState<number | null>(null);
  const [analysing, setAnalysing] = useState(false);
  /** Sleep sounds playing now, and the clock time they fade out by. */
  const [sleep, setSleep] = useState<{ kind: SleepSoundKind; endsAt: Date } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let weatherTimer: ReturnType<typeof setTimeout> | null = null;
    (async () => {
      try {
        const sensitivity = ((await getSetting(db, 'sensitivity')) ?? 'normal') as Sensitivity;
        const hour = Number((await getSetting(db, 'auto_stop_hour')) ?? DEFAULT_AUTO_STOP_HOUR);
        stopAt.current = autoStopAt(new Date(), hour);
        // Sound recording is on unless switched off in Settings (and needs this build's encoder).
        const keepSound = soundRecordingAvailable && (await getSetting(db, 'sound_recording')) !== '0';
        const s = await RecordingSession.begin({
          db,
          capture: getAudioCapture(),
          sensitivity,
          newId: randomUUID,
          files: new ExpoClipFiles(),
          sound: keepSound ? new NativeSegmentWriter() : null,
        });
        if (cancelled) {
          await s.discard();
          return;
        }
        session.current = s;
        track({ name: 'recording_start' });
        // Sleep sounds chosen on Tonight start with the recording and fade out on their timer.
        const kind = (await getSetting(db, 'sleep_sound')) as SleepSoundKind | null;
        if (NoisePlayer.available && kind && SLEEP_SOUNDS.some((x) => x.kind === kind)) {
          const minutes = Number((await getSetting(db, 'sleep_sound_minutes')) ?? DEFAULT_SLEEP_TIMER_MINUTES);
          NoisePlayer.start(kind, SLEEP_SOUND_GAIN, minutes * 60, SLEEP_SOUND_FADE_S);
          s.setSleepSound(kind, minutes * 60);
          setSleep({ kind, endsAt: new Date(Date.now() + minutes * 60_000) });
        }
        // Tonight's forecast, once, after a random wait (MET Norway asks apps not to bunch up).
        if ((await getSetting(db, 'weather')) === 'on') {
          weatherTimer = setTimeout(() => {
            void fetchWeatherHere().then((f) => {
              if (f && session.current === s) s.setForecast(f);
            });
          }, Math.random() * 60_000);
        }
      } catch (e) {
        Alert.alert('Recording could not start', e instanceof Error ? e.message : String(e));
        router.back();
      }
    })();

    const tick = setInterval(() => {
      if (!session.current) return;
      setElapsedS(session.current.elapsedS);
      setLevelDb(session.current.lastLevelDb);
      // The timer ran out (it stops itself natively).
      setSleep((current) => (current && !NoisePlayer.isPlaying() ? null : current));
    }, 1000);
    // The tab bar is hidden and Back does nothing while recording; only Stop ends it.
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);

    return () => {
      cancelled = true;
      clearInterval(tick);
      if (weatherTimer) clearTimeout(weatherTimer);
      back.remove();
      void NoisePlayer.stop();
      // Unmounted without Stop: keep what was recorded rather than lose the night.
      if (session.current && !finishing.current) void session.current.finish();
    };
  }, [db]);

  /** Ends sleep sounds early; the analysis is told when they really stopped. */
  const stopSounds = useCallback(() => {
    if (!sleep) return;
    void NoisePlayer.stop();
    session.current?.setSleepSound(sleep.kind, session.current.elapsedS);
    setSleep(null);
  }, [sleep]);

  const stop = useCallback(async (automatic = false) => {
    if (!session.current || finishing.current) return;
    finishing.current = true;
    setAnalysing(true);
    void NoisePlayer.stop();
    try {
      const night = await session.current.finish();
      const row = night ? await getNight(db, night.nightId) : null;
      if (night) track({ name: 'log_saved', remedies: night.logged.remedies, factors: night.logged.factors });
      if (row) track({ name: 'recording_complete', duration_band: durationBand(row.time_in_bed_s), partial: row.partial === 1 });
      if (row && automatic) await notifyNightReady(row.score).catch(() => undefined);
      void sync();
      if (night) router.replace('/morning');
      else router.back();
    } catch (e) {
      Alert.alert('Could not save the night', e instanceof Error ? e.message : String(e));
      finishing.current = false;
      setAnalysing(false);
    }
  }, [db, sync]);

  // Automatic stop in the morning. Runs in the background too: the audio session keeps JS alive.
  useEffect(() => {
    const t = setInterval(() => {
      if (Date.now() >= stopAt.current) void stop(true);
    }, 5000);
    return () => clearInterval(t);
  }, [stop]);


  if (analysing) {
    return (
      <View style={styles.screen}>
        <NightSky variant="deep" />
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.caption}>Analysing</Text>
      </View>
    );
  }

  // Quiet live meter over roughly -70 to -20 dBFS.
  const meter = levelDb === null ? 0 : Math.min(1, Math.max(0, (levelDb + 70) / 50));

  return (
    <View style={styles.screen}>
      <NightSky variant="deep" />
      <BreathingMoon size={120} />
      <Text style={styles.caption}>Recording</Text>
      <Text style={styles.elapsed}>{formatElapsed(elapsedS)}</Text>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${meter * 100}%` }]} />
      </View>
      {sleep ? (
        <View style={styles.sleepRow}>
          <Text style={styles.sleepText}>
            {sleepSoundName(sleep.kind)} · fades out by {sleep.endsAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Pressable onPress={stopSounds} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.sleepStop}>Stop sounds</Text>
          </Pressable>
        </View>
      ) : null}
      <Text style={styles.note}>You can lock the phone. Recording carries on with the screen off.</Text>
      {process.env.EXPO_PUBLIC_SIMULATE_CAPTURE === '1' && (
        <Text style={styles.note}>Simulated capture: 30 seconds of night per second</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Hold for one second to stop"
        delayLongPress={1000}
        onLongPress={() => stop()}
        style={styles.stop}
      >
        <Text style={styles.stopLabel}>Hold to stop</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Kept dim: the screen should not light the bedroom.
  screen: { flex: 1, backgroundColor: '#030409', alignItems: 'center', justifyContent: 'center', padding: space(6) },
  caption: { color: colors.textFaint, fontSize: 14, fontFamily: fonts.headingSemi, letterSpacing: 1.6, textTransform: 'uppercase', marginTop: space(3) },
  elapsed: { color: colors.textMuted, fontSize: 64, fontWeight: '200', fontVariant: ['tabular-nums'], marginVertical: space(5) },
  meterTrack: { width: '60%', height: 4, borderRadius: 2, backgroundColor: 'rgba(170, 182, 255, 0.12)', overflow: 'hidden' },
  meterFill: { height: 4, backgroundColor: 'rgba(246, 215, 142, 0.6)' },
  sleepRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), marginTop: space(6) },
  sleepText: { color: colors.textFaint, fontSize: 14 },
  sleepStop: { color: colors.accent, fontSize: 14, fontWeight: '700', opacity: 0.8 },
  note: { color: colors.textFaint, fontSize: 13, marginTop: space(4), textAlign: 'center' },
  stop: {
    position: 'absolute',
    bottom: space(16),
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.button,
    paddingVertical: space(4),
    paddingHorizontal: space(10),
  },
  stopLabel: { color: colors.textMuted, fontSize: 17, fontFamily: fonts.headingSemi },
});
