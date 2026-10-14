import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';

import { getSetting } from '../data/settingsRepo';
import type { Sensitivity } from '../domain/scoring';
import { getAudioCapture } from '../native';
import { RecordingSession } from '../recording/recordingSession';
import { colors, radius, space } from '../ui/theme';

const formatElapsed = (s: number) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function Recording() {
  const db = useSQLiteContext();
  const session = useRef<RecordingSession | null>(null);
  const finishing = useRef(false);
  const [elapsedS, setElapsedS] = useState(0);
  const [levelDb, setLevelDb] = useState<number | null>(null);
  const [analysing, setAnalysing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const sensitivity = ((await getSetting(db, 'sensitivity')) ?? 'normal') as Sensitivity;
        const s = await RecordingSession.begin({ db, capture: getAudioCapture(), sensitivity, newId: randomUUID });
        if (cancelled) {
          await s.discard();
          return;
        }
        session.current = s;
      } catch (e) {
        Alert.alert('Recording could not start', e instanceof Error ? e.message : String(e));
        router.back();
      }
    })();

    const tick = setInterval(() => {
      if (!session.current) return;
      setElapsedS(session.current.elapsedS);
      setLevelDb(session.current.lastLevelDb);
    }, 1000);
    // The tab bar is hidden and Back does nothing while recording; only Stop ends it.
    const back = BackHandler.addEventListener('hardwareBackPress', () => true);

    return () => {
      cancelled = true;
      clearInterval(tick);
      back.remove();
      // Unmounted without Stop: keep what was recorded rather than lose the night.
      if (session.current && !finishing.current) void session.current.finish();
    };
  }, [db]);

  const stop = async () => {
    if (!session.current || finishing.current) return;
    finishing.current = true;
    setAnalysing(true);
    try {
      const night = await session.current.finish();
      if (night) router.replace('/morning');
      else router.back();
    } catch (e) {
      Alert.alert('Could not save the night', e instanceof Error ? e.message : String(e));
      finishing.current = false;
      setAnalysing(false);
    }
  };

  if (analysing) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.caption}>Analysing</Text>
      </View>
    );
  }

  // Quiet live meter over roughly -70 to -20 dBFS.
  const meter = levelDb === null ? 0 : Math.min(1, Math.max(0, (levelDb + 70) / 50));

  return (
    <View style={styles.screen}>
      <Text style={styles.caption}>Recording</Text>
      <Text style={styles.elapsed}>{formatElapsed(elapsedS)}</Text>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${meter * 100}%` }]} />
      </View>
      <Text style={styles.note}>You can lock the phone. Recording carries on with the screen off.</Text>
      {process.env.EXPO_PUBLIC_SIMULATE_CAPTURE === '1' && (
        <Text style={styles.note}>Simulated capture: 30 seconds of night per second</Text>
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Hold for one second to stop"
        delayLongPress={1000}
        onLongPress={stop}
        style={styles.stop}
      >
        <Text style={styles.stopLabel}>Hold to stop</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#0A0F1E', alignItems: 'center', justifyContent: 'center', padding: space(6) },
  caption: { color: colors.textMuted, fontSize: 15, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase', marginTop: space(3) },
  elapsed: { color: colors.text, fontSize: 64, fontWeight: '300', fontVariant: ['tabular-nums'], marginVertical: space(6) },
  meterTrack: { width: '70%', height: 6, borderRadius: 3, backgroundColor: colors.surfaceRaised, overflow: 'hidden' },
  meterFill: { height: 6, backgroundColor: colors.accent },
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
  stopLabel: { color: colors.text, fontSize: 17, fontWeight: '700' },
});
