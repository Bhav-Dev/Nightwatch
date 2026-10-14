import { randomUUID } from 'expo-crypto';
import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { commitPendingLog } from '../data/logRepo';
import { saveNight } from '../data/nightRepo';
import { getSetting } from '../data/settingsRepo';
import { FrameFeatureBuffer } from '../domain/audio/frameBuffer';
import { classifyNightHeuristic } from '../domain/detection/heuristic';
import { analyseNight, type Gap, type Sensitivity } from '../domain/scoring';
import { type AudioCapture, getAudioCapture } from '../native';
import { colors, radius, space } from '../ui/theme';

const formatElapsed = (s: number) =>
  `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

export default function Recording() {
  const db = useSQLiteContext();
  const capture = useRef<AudioCapture | null>(null);
  const buffer = useRef(new FrameFeatureBuffer());
  const gaps = useRef<Gap[]>([]);
  const startedAt = useRef(new Date());
  const [elapsedS, setElapsedS] = useState(0);
  const [lastLevelDb, setLastLevelDb] = useState<number | null>(null);
  const [analysing, setAnalysing] = useState(false);

  useEffect(() => {
    const c = getAudioCapture();
    capture.current = c;
    if (!c) return;
    c.start({
      onWindow: ({ startS, samples }) => {
        buffer.current.addWindow(startS, samples);
        const entries = buffer.current.entries();
        setElapsedS(entries.length > 0 ? entries[entries.length - 1].t + 1 : 0);
        setLastLevelDb(entries[entries.length - 1]?.features.levelDb ?? null);
      },
      onInterrupted: ({ atS, resumedAtS }) => {
        gaps.current.push({ startS: atS, endS: resumedAtS ?? atS });
      },
    });
    return () => {
      c.stop();
    };
  }, []);

  const stop = async () => {
    setAnalysing(true);
    await capture.current?.stop();
    const entries = buffer.current.entries();
    const durationS = entries.length > 0 ? entries[entries.length - 1].t + 1 : 0;
    const sensitivity = ((await getSetting(db, 'sensitivity')) ?? 'normal') as Sensitivity;
    const analysis = analyseNight({
      durationS,
      frames: classifyNightHeuristic(entries),
      gaps: gaps.current,
      partial: gaps.current.length > 0,
      sensitivity,
    });
    const id = randomUUID();
    await saveNight(db, {
      id,
      startedAt: startedAt.current,
      endedAt: new Date(startedAt.current.getTime() + durationS * 1000),
      partial: gaps.current.length > 0,
      analysis,
      newId: randomUUID,
    });
    await commitPendingLog(db, id);
    router.replace('/morning');
  };

  if (analysing) {
    return (
      <View style={styles.screen}>
        <ActivityIndicator color={colors.accent} />
        <Text style={styles.caption}>Analysing</Text>
      </View>
    );
  }

  // Quiet level meter: 0 to 40 dB above the quietest second so far.
  const meter = lastLevelDb === null ? 0 : Math.min(1, Math.max(0, (lastLevelDb + 70) / 50));

  return (
    <View style={styles.screen}>
      <Text style={styles.caption}>Recording</Text>
      <Text style={styles.elapsed}>{formatElapsed(elapsedS)}</Text>
      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${meter * 100}%` }]} />
      </View>
      {__DEV__ && <Text style={styles.dev}>Simulated capture: 30 seconds of night per second</Text>}
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
  dev: { color: colors.textFaint, fontSize: 12, marginTop: space(4) },
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
