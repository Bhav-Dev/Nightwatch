import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Alert, Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { track } from '../analytics';
import { billingAvailable, loadPlans, type Plans, purchase, restore } from '../billing/billing';
import { config } from '../config';
import { setSetting } from '../data/settingsRepo';
import { useApp } from '../state/AppContext';
import { Body, Button, Loading, Screen, Small } from '../ui/kit';
import { colors, radius, space } from '../ui/theme';

/** The line under the title: what the lock that opened the paywall was about. */
const WHY: Record<string, string> = {
  remedies: 'See what worked for people like you.',
  people_like_you: 'See what worked for people like you.',
  your_result: 'See how your result compares with everyone who tested it.',
  verdict: 'Your test is done. Join the Hive to see its verdict.',
  playback: 'Play back the whole night from any second.',
  history: 'Keep every night, with 30 and 90-night trends.',
  snapshot: 'Save any stretch of nights to compare later.',
  report: 'Make a report to share with your doctor.',
  summary: 'See the full morning summary with your watch data.',
  overlay: 'See your watch data on the same timeline as your snoring.',
};

const BULLETS = [
  'What worked for people like you: every remedy, ranked by real nights',
  'The verdict at the end of each 14-night test',
  'The whole night to play back, your watch data on the timeline and the full morning summary',
  'Every night kept, 30 and 90-night trends, and a report to share with your doctor',
];

/** Opened from any lock. Dismissable; nothing is lost by closing it. */
export default function Paywall() {
  const { trigger } = useLocalSearchParams<{ trigger?: string }>();
  const db = useSQLiteContext();
  const { refreshEntitlement } = useApp();
  const [plans, setPlans] = useState<Plans | null>(null);
  const [choice, setChoice] = useState<'yearly' | 'monthly'>('yearly');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void setSetting(db, 'paywall_seen_for', trigger ?? 'lock');
    track({ name: 'paywall_shown', trigger: trigger ?? 'lock' });
    void loadPlans()
      .then(setPlans)
      .catch(() => setPlans({ yearly: null, monthly: null }));
  }, [db, trigger]);

  const done = async () => {
    await refreshEntitlement();
    router.back();
  };

  const buy = async () => {
    const pkg = choice === 'yearly' ? plans?.yearly?.pkg : plans?.monthly?.pkg;
    if (!pkg) return;
    setBusy(true);
    try {
      if (await purchase(pkg)) {
        // The yearly plan carries the free trial; monthly converts straight away.
        track(choice === 'yearly' ? { name: 'trial_started', plan: 'yearly' } : { name: 'subscription_converted', plan: 'monthly' });
        await done();
      }
    } catch (e) {
      Alert.alert('Purchase did not go through', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doRestore = async () => {
    setBusy(true);
    try {
      if (await restore()) await done();
      else Alert.alert('No subscription found', 'There is no active subscription on this account.');
    } finally {
      setBusy(false);
    }
  };

  const yearlyPrice = plans?.yearly?.price ?? '£29.99';
  const perMonth = plans?.yearly?.perMonth ?? '£2.50';
  const monthlyPrice = plans?.monthly?.price ?? '£4.99';

  return (
    <Screen
      eyebrow="SnoreHive"
      title="Join the Hive"
      subtitle={WHY[trigger ?? ''] ?? 'See what actually helps, for people like you and for you.'}
      right={
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Close" hitSlop={12}>
          <Text style={{ color: colors.textMuted, fontSize: 22 }}>✕</Text>
        </Pressable>
      }
      footer={
        <>
          {billingAvailable() ? (
            <Button label={choice === 'yearly' ? 'Start 7 days free' : 'Join the Hive'} onPress={buy} busy={busy} disabled={!plans || !(choice === 'yearly' ? plans.yearly : plans.monthly)} />
          ) : (
            <>
              <Small>Subscriptions are not set up in this build.</Small>
              {config.internalTools ? (
                <Button
                  kind="secondary"
                  label="Unlock for development"
                  onPress={async () => {
                    await setSetting(db, 'dev_paid', '1');
                    await done();
                  }}
                />
              ) : null}
            </>
          )}
          <View style={styles.links}>
            <Button kind="link" label="Restore purchases" onPress={doRestore} />
            <Button kind="link" label="Terms" onPress={() => Linking.openURL(`${config.siteUrl}/terms`)} />
            <Button kind="link" label="Privacy" onPress={() => Linking.openURL(`${config.siteUrl}/privacy`)} />
          </View>
        </>
      }
    >
      {BULLETS.map((b) => (
        <View key={b} style={styles.bullet}>
          <Text style={styles.tick}>✓</Text>
          <Body style={{ flex: 1 }}>{b}</Body>
        </View>
      ))}
      <Small>Recording stays free every night as a Bee, with your score, clips and the last 7 nights.</Small>
      {plans === null ? (
        <Loading />
      ) : (
        <View style={{ marginTop: space(5), gap: space(3) }}>
          <Plan selected={choice === 'yearly'} onPress={() => setChoice('yearly')} title={`Yearly ${yearlyPrice}`} badge={`7 days free, then ${perMonth} a month`} />
          <Plan selected={choice === 'monthly'} onPress={() => setChoice('monthly')} title={`Monthly ${monthlyPrice}`} />
        </View>
      )}
    </Screen>
  );
}

function Plan({ selected, onPress, title, badge }: { selected: boolean; onPress: () => void; title: string; badge?: string }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="radio" accessibilityState={{ selected }} style={[styles.plan, selected && styles.planOn]}>
      <Text style={styles.planTitle}>{title}</Text>
      {badge ? <Text style={styles.badge}>{badge}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bullet: { flexDirection: 'row', gap: space(3), marginBottom: space(3) },
  tick: { color: colors.accent, fontSize: 17, fontWeight: '800' },
  plan: { borderWidth: 1, borderColor: colors.borderStrong, borderRadius: radius.card, padding: space(4) },
  planOn: { borderColor: colors.accent, backgroundColor: colors.surface },
  planTitle: { color: colors.text, fontSize: 17, fontWeight: '700' },
  badge: { color: colors.accent, marginTop: space(1) },
  links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space(2) },
});
