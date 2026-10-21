import { useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Linking, Platform } from 'react-native';

import { lastNightWithHealth } from '../data/healthRepo';
import { getSetting, setSetting } from '../data/settingsRepo';
import { getHealthSource } from '../health';
import { Button, Card, H2, Row, Small } from '../ui/kit';
import { space } from '../ui/theme';

const HEALTH_CONNECT_ON_PLAY = 'https://play.google.com/store/apps/details?id=com.google.android.apps.healthdata';

interface WatchState {
  available: boolean;
  connected: boolean;
  /** When the latest night with watch data ended, epoch seconds. */
  lastNight: number | null;
}

/**
 * Settings: connect Apple Health or Health Connect, or see what is connected. Until now the only
 * ways in were onboarding and the offer on This Morning after a few nights.
 */
export function WatchCard() {
  const db = useSQLiteContext();
  const source = useMemo(() => getHealthSource(), []);
  const [state, setState] = useState<WatchState | null>(null);

  const load = useCallback(async () => {
    if (!source) return setState({ available: false, connected: false, lastNight: null });
    const [available, connected, lastNight] = await Promise.all([
      source.isAvailable().catch(() => false),
      getSetting(db, 'health_enabled').then((v) => v === '1'),
      lastNightWithHealth(db),
    ]);
    setState({ available, connected, lastNight });
  }, [db, source]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  if (!state) return null;
  const name = source?.name ?? 'Apple Health';

  const connect = async () => {
    if (!source) return;
    const ok = await source.requestPermission().catch(() => false);
    if (ok) {
      await setSetting(db, 'health_enabled', '1');
      // Connected here, so This Morning does not offer it again.
      await setSetting(db, 'health_prompted_after', 'done');
    } else {
      Alert.alert(
        'Nothing to read yet',
        `Allow sleep or heart rate for SnoreHive in ${name} to see your watch data.`,
        source.openSettings
          ? [
              { text: 'Not now', style: 'cancel' },
              { text: `Open ${name}`, onPress: () => source.openSettings?.() },
            ]
          : undefined,
      );
    }
    await load();
  };

  const stop = () =>
    Alert.alert(`Stop reading ${name}?`, 'New nights get no watch data. Nights already read keep theirs.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop',
        style: 'destructive',
        onPress: async () => {
          await setSetting(db, 'health_enabled', '0');
          await load();
        },
      },
    ]);

  return (
    <Card>
      <H2>Your watch</H2>
      {!source || !state.available ? (
        <>
          <Small>{source ? `${name} is not available on this phone.` : 'Watch data is not available on this phone.'}</Small>
          {Platform.OS === 'android' && source ? <Row label="Get Health Connect" onPress={() => Linking.openURL(HEALTH_CONNECT_ON_PLAY)} /> : null}
        </>
      ) : state.connected ? (
        <>
          <Row label={name} value="Connected" />
          <Small>Reads sleep stages, heart rate, heart rate variability, oxygen and breathing rate the morning after each night. Health data stays on this phone; only a short nightly summary syncs.</Small>
          <Small style={{ marginTop: space(2) }}>
            {state.lastNight
              ? `Latest night with watch data: ${new Date(state.lastNight * 1000).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}.`
              : 'No watch data yet. It appears the morning after a night you wear your watch to bed.'}
          </Small>
          {source.openSettings ? (
            <Row label={`Manage in ${name}`} onPress={() => source.openSettings?.()} />
          ) : (
            <Small style={{ marginTop: space(2) }}>To change what SnoreHive can read, use the privacy settings in the Health app.</Small>
          )}
          <Button kind="link" label={`Stop reading ${name}`} onPress={stop} />
        </>
      ) : (
        <>
          <Row label={`Connect ${name}`} onPress={connect} />
          <Small>If you wear a watch to bed, see your sleep stages, heart rate and oxygen on the same timeline as your snoring. Health data stays on this phone; only a short nightly summary syncs to your account.</Small>
        </>
      )}
    </Card>
  );
}
