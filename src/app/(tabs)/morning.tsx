import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { averageScore, latestNight, nightBins, type NightRow } from '../../data/nightRepo';
import { clockTimeAt, INTERRUPTION_COPY } from '../../domain/interruption';
import { intensityFor, scoreLabel, type Bin } from '../../domain/scoring';
import { colors, radius, space } from '../../ui/theme';

const INTENSITY_COLOR = { quiet: '#4A5576', light: colors.info, loud: colors.accent, epic: '#FFD070' };

const hm = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;

/**
 * Phase 0 version: score card and timeline for the latest night. Clips, the summary,
 * the wearable overlay and the log editor arrive in Phases 1 and 2.
 */
export default function Morning() {
  const db = useSQLiteContext();
  const [night, setNight] = useState<NightRow | null | undefined>(undefined);
  const [bins, setBins] = useState<Bin[]>([]);
  const [avg7, setAvg7] = useState<number | null>(null);
  const [showPrevent, setShowPrevent] = useState(false);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const last = await latestNight(db);
        setNight(last);
        if (last) {
          setBins(await nightBins(db, last.id));
          setAvg7(await averageScore(db, 7));
        }
      })();
    }, [db]),
  );

  if (night === undefined) return <View style={styles.screen} />;

  if (night === null) {
    return (
      <SafeAreaView style={[styles.screen, styles.center]}>
        <Text style={styles.emptyTitle}>No nights yet</Text>
        <Text style={styles.muted}>Record tonight and your score will be here in the morning.</Text>
        <Pressable style={styles.primary} onPress={() => router.navigate('/tonight')}>
          <Text style={styles.primaryLabel}>Start tonight</Text>
        </Pressable>
      </SafeAreaView>
    );
  }

  const maxSnore = Math.max(1, ...bins.map((b) => b.snoreS));
  const delta = avg7 === null ? null : Math.round(night.score - avg7);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={{ padding: space(5) }}>
        <Text style={styles.eyebrow}>This morning</Text>
        {night.partial === 1 && (
          <Pressable style={styles.banner} onPress={() => setShowPrevent((v) => !v)} accessibilityRole="button">
            <Text style={styles.bannerTitle}>
              {night.interrupted_at_s !== null
                ? `Recording stopped at ${clockTimeAt(night.started_at, night.interrupted_at_s)}`
                : 'Recording was interrupted'}
            </Text>
            {night.interrupt_cause && (
              <Text style={styles.bannerText}>{INTERRUPTION_COPY[night.interrupt_cause].cause}</Text>
            )}
            <Text style={styles.bannerLink}>How to prevent this</Text>
            {showPrevent && night.interrupt_cause && (
              <Text style={styles.bannerText}>{INTERRUPTION_COPY[night.interrupt_cause].prevent}</Text>
            )}
          </Pressable>
        )}
        <View style={styles.card}>
          <Text style={styles.score}>{night.score}</Text>
          <Text style={styles.label}>
            {scoreLabel(night.score)}
            {delta !== null && delta !== 0 ? `  ${delta > 0 ? '↑' : '↓'} ${Math.abs(delta)} vs 7-night average` : ''}
          </Text>
          <View style={styles.stats}>
            <Stat label="Time snoring" value={`${Math.round(night.pct_snoring * 100)}%`} />
            <Stat label="Time in bed" value={hm(night.time_in_bed_s)} />
            <Stat label="Loudest" value={night.event_count > 0 ? intensityFor(night.max_db) : '—'} />
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Timeline</Text>
          <View style={styles.chart}>
            {bins.map((b) => (
              <View
                key={b.index}
                style={{
                  flex: 1,
                  marginHorizontal: 0.5,
                  height: `${Math.max(2, (b.snoreS / maxSnore) * 100)}%`,
                  backgroundColor: b.snoreS > 0 ? INTENSITY_COLOR[intensityFor(b.maxDb)] : colors.border,
                  borderRadius: 2,
                }}
              />
            ))}
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.muted}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  center: { alignItems: 'center', justifyContent: 'center', padding: space(6) },
  eyebrow: { color: colors.accent, fontSize: 14, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginBottom: space(4) },
  emptyTitle: { color: colors.text, fontSize: 22, fontWeight: '700', marginBottom: space(2) },
  muted: { color: colors.textMuted, fontSize: 13, textAlign: 'left' },
  banner: { backgroundColor: '#2A2614', borderRadius: radius.button, padding: space(3), marginBottom: space(3) },
  bannerTitle: { color: colors.accent, fontWeight: '700', marginBottom: space(1) },
  bannerText: { color: colors.text, fontSize: 14, lineHeight: 20 },
  bannerLink: { color: colors.accent, fontSize: 14, marginTop: space(1), textDecorationLine: 'underline' },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(5),
    marginBottom: space(4),
  },
  cardTitle: { color: colors.text, fontSize: 16, fontWeight: '700', marginBottom: space(3) },
  score: { color: colors.text, fontSize: 72, fontWeight: '800' },
  label: { color: colors.accent, fontSize: 18, fontWeight: '700', marginBottom: space(4) },
  stats: { flexDirection: 'row' },
  statValue: { color: colors.text, fontSize: 18, fontWeight: '700', textTransform: 'capitalize' },
  chart: { height: 120, flexDirection: 'row', alignItems: 'flex-end' },
  primary: { backgroundColor: colors.accent, borderRadius: radius.button, paddingVertical: space(4), paddingHorizontal: space(8), marginTop: space(6) },
  primaryLabel: { color: colors.accentText, fontSize: 17, fontWeight: '800' },
});
