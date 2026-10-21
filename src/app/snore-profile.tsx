import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import { cancelExperiment, type Experiment, listExperiments } from '../data/experimentRepo';
import { loadSnoreProfile } from '../data/snoreProfileRepo';
import { experimentDay, planFor } from '../domain/experiment';
import { localDateKey } from '../domain/nightDate';
import { MIN_PROFILE_PITCH_NIGHTS, PITCH_WORDS, pitchHzWords } from '../domain/pitch';
import { AREAS, RATING_WORDS, type SnoreProfile } from '../domain/snoreProfile';
import { TYPE_TEST_GROUP, TYPE_TESTS } from '../domain/typeTest';
import { useApp } from '../state/AppContext';
import { BackLink, Body, Button, Card, H2, Loading, Screen, Small } from '../ui/kit';
import { RatingCells } from '../ui/RatingCells';
import { colors, space } from '../ui/theme';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * The snore profile in full: how the snoring sounds, what changes it, and the guided "Find your
 * type" test that fills it in. Every line is a clue to talk about, never a finding.
 */
export default function SnoreProfileScreen() {
  const db = useSQLiteContext();
  const { paid } = useApp();
  const [profile, setProfile] = useState<SnoreProfile | null>(null);
  const [typeTests, setTypeTests] = useState<Experiment[]>([]);

  const load = useCallback(async () => {
    const [p, experiments] = await Promise.all([loadSnoreProfile(db), listExperiments(db)]);
    setProfile(p);
    setTypeTests(experiments.filter((e) => e.group === TYPE_TEST_GROUP));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!profile) {
    return (
      <Screen sky="plain" eyebrow="Trends" title="Your snore profile" left={<BackLink />}>
        <Loading />
      </Screen>
    );
  }

  const today = localDateKey(new Date());
  const running = typeTests.filter((e) => e.status === 'running');
  const finished = typeTests.filter((e) => e.status === 'complete');
  const day = running[0] ? experimentDay(running[0].started, today) : null;
  const { pitch } = profile;

  const start = () => router.push(paid ? '/find-your-type' : { pathname: '/paywall', params: { trigger: 'experiment' } });
  const stop = () =>
    Alert.alert('Stop finding your type?', 'The tests stop tonight. Nights already recorded stay in your history.', [
      { text: 'Keep going', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: async () => {
          for (const e of running) await cancelExperiment(db, e.id);
          await load();
        },
      },
    ]);

  return (
    <Screen sky="plain" eyebrow="Trends" title="Your snore profile" left={<BackLink />}>
      <Body muted style={{ marginBottom: space(3) }}>
        Clues to where your snoring may come from, from how it sounds and what changes it. Use them to choose what to try first. Only a doctor can say for sure
        where snoring comes from.
      </Body>

      <Card>
        <H2>How it sounds</H2>
        {pitch.band ? (
          <>
            <Text style={styles.big}>{PITCH_WORDS[pitch.band].title}</Text>
            <Small>
              Its pitch is {pitchHzWords(pitch.hz)}, from {plural(pitch.nights, 'night', 'nights')} with snoring
              {pitch.spread.length > 1 ? ` (${pitch.spread.map((s) => `${PITCH_WORDS[s.band].short} on ${plural(s.nights, 'night', 'nights')}`).join(', ')})` : ''}.
            </Small>
            <Body style={{ marginTop: space(3) }}>{PITCH_WORDS[pitch.band].linked}</Body>
          </>
        ) : (
          <Body muted>
            We measure the pitch of each snore from tonight on. After {MIN_PROFILE_PITCH_NIGHTS} nights with snoring, this shows how yours sounds
            {pitch.nights > 0 ? ` (${pitch.nights} so far)` : ''}.
          </Body>
        )}
        <Small style={{ marginTop: space(3) }}>
          A phone across the room hears a rough version of your snoring, so its pitch is a clue, not an answer. An ear, nose and throat specialist can see where
          snoring comes from, for example with a camera during sedated sleep.
        </Small>
      </Card>

      <Card>
        <H2>What changes it</H2>
        <Small>From your own nights with and without each thing, the same comparison as your patterns. A finished test counts for more.</Small>
        {profile.areas.map((a) => (
          <View key={a.area} style={styles.area}>
            <View style={styles.areaHead} accessible accessibilityLabel={`${a.name}: ${RATING_WORDS[a.rating]}`}>
              <Text style={styles.areaName}>{a.name}</Text>
              <View style={styles.rating}>
                <RatingCells rating={a.rating} />
                <Text style={[styles.ratingText, a.rating === 'more_nights' && styles.muted]}>{RATING_WORDS[a.rating]}</Text>
              </View>
            </View>
            {a.evidence.slice(0, 3).map((line) => (
              <Text key={line} style={styles.evidence}>
                {line}
              </Text>
            ))}
            {a.evidence.length === 0 ? <Text style={styles.evidence}>Nothing logged for this yet.</Text> : null}
            <Small style={{ marginTop: space(1) }}>{AREAS[a.area].meaning}</Small>
          </View>
        ))}
      </Card>

      <Card>
        <H2>Find your type</H2>
        {running.length > 0 && day !== null ? (
          <>
            <Text style={styles.big}>Night {day} of 14</Text>
            <Small>Tonight:</Small>
            {running.map((e) => {
              const test = TYPE_TESTS.find((t) => t.remedyId === e.remedyId);
              const plan = planFor(e.started, e.pattern, today);
              return test && plan ? (
                <Text key={e.id} style={styles.evidence}>
                  {plan === 'with' ? test.withText : test.withoutText}
                </Text>
              ) : null;
            })}
            <Small style={{ marginTop: space(2) }}>Tonight’s plan is ticked for you before you start recording. Change it if you did something else.</Small>
            <Button kind="link" label="Stop the tests" onPress={stop} style={{ marginTop: space(2) }} />
          </>
        ) : (
          <>
            <Body>
              Up to three short tests at once, for 14 nights: sleeping on your side, a nasal strip and mouth tape. Each evening the app says what to do, and each
              test gets a verdict at the end, which fills in your profile.
            </Body>
            {finished.length > 0 ? <Small style={{ marginTop: space(2) }}>Your last tests are in the areas above.</Small> : null}
            <Button
              kind="secondary"
              label={finished.length > 0 ? 'Run the tests again' : paid ? 'Find your type' : 'Find your type 🔒'}
              onPress={start}
              style={{ marginTop: space(3) }}
            />
          </>
        )}
      </Card>

      <Small style={{ marginBottom: space(6) }}>
        If you’re worried about your snoring, talk to your GP. The doctor’s report on Trends sums up your nights for them, with this profile.
      </Small>
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { color: colors.accent, fontSize: 20, fontWeight: '800', marginBottom: space(1) },
  area: { paddingVertical: space(3), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  areaHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3), marginBottom: space(1) },
  areaName: { color: colors.text, fontSize: 16, fontWeight: '700' },
  rating: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  ratingText: { color: colors.text, fontSize: 14, fontWeight: '600' },
  muted: { color: colors.textMuted },
  evidence: { color: colors.text, fontSize: 14, lineHeight: 20, marginTop: 2 },
});
