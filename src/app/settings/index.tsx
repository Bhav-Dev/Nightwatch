import { File, Paths } from 'expo-file-system';
import { router, useFocusEffect } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Alert, Linking, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { allClipPaths, clipStorageBytes } from '../../data/clipRepo';
import { deleteAllLocalData, exportAll } from '../../data/exportData';
import { getSetting, setSetting } from '../../data/settingsRepo';
import { allSoundPaths, deleteAllSoundRows, soundStorageBytes } from '../../data/soundRepo';
import { config } from '../../config';
import { removeSoundFile, soundRecordingAvailable } from '../../native/soundWriter';
import { cancelBedtimeNudge, requestNotificationPermission, scheduleBedtimeNudge } from '../../notifications';
import { SOUND_KEEP_DAYS } from '../../recording/soundRecorder';
import { removeClipFile } from '../../screens/NightView';
import { useApp } from '../../state/AppContext';
import { Body, Button, Card, H2, Row, Segmented, Small, ToggleRow } from '../../ui/kit';
import { NightSky } from '../../ui/NightSky';
import { askForLocation, locationPermission, weatherConfigured } from '../../weather/weatherClient';
import { WEATHER_ATTRIBUTION } from '../../../shared/weather';
import { colors, space } from '../../ui/theme';

const BEDTIMES = ['21:30', '22:00', '22:30', '23:00', '23:30'];
const STOP_HOURS = ['9', '10', '11', '12'];

export default function SettingsScreen() {
  const db = useSQLiteContext();
  const { session, signOut, api, paid, refreshEntitlement, sync, lastSyncError } = useApp();
  const [sensitivity, setSensitivity] = useState('normal');
  const [landing, setLanding] = useState('auto');
  const [bedtime, setBedtime] = useState<string | null>(null);
  const [stopHour, setStopHour] = useState('11');
  const [storage, setStorage] = useState(0);
  const [soundOn, setSoundOn] = useState(true);
  const [weatherOn, setWeatherOn] = useState(false);
  const [devPaid, setDevPaid] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setSensitivity((await getSetting(db, 'sensitivity')) ?? 'normal');
    setLanding((await getSetting(db, 'landing_tab')) ?? 'auto');
    setBedtime(await getSetting(db, 'bedtime_reminder'));
    setStopHour((await getSetting(db, 'auto_stop_hour')) ?? '11');
    setStorage((await clipStorageBytes(db)) + (await soundStorageBytes(db)));
    setSoundOn((await getSetting(db, 'sound_recording')) !== '0');
    setWeatherOn((await getSetting(db, 'weather')) === 'on' && (await locationPermission()) === 'granted');
    setDevPaid((await getSetting(db, 'dev_paid')) === '1');
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const save = async (key: 'sensitivity' | 'landing_tab' | 'auto_stop_hour' | 'sound_recording', value: string | null) => {
    await setSetting(db, key, value);
    await load();
  };

  const setReminder = async (v: string | null) => {
    if (v) {
      if (!(await requestNotificationPermission())) return Alert.alert('Notifications are off', 'Turn them on in Settings to get a bedtime reminder.');
      const [h, m] = v.split(':').map(Number);
      await scheduleBedtimeNudge(h, m);
    } else {
      await cancelBedtimeNudge();
    }
    await setSetting(db, 'bedtime_reminder', v);
    await load();
  };

  const doExport = async () => {
    setBusy('export');
    try {
      const { json, csv } = await exportAll(db);
      const stamp = new Date().toISOString().slice(0, 10);
      const jsonFile = new File(Paths.cache, `nightwatch-${stamp}.json`);
      const csvFile = new File(Paths.cache, `nightwatch-${stamp}.csv`);
      for (const [f, body] of [
        [jsonFile, json],
        [csvFile, csv],
      ] as const) {
        if (f.exists) f.delete();
        f.create();
        f.write(body);
      }
      await Sharing.shareAsync(csvFile.uri, { mimeType: 'text/csv', dialogTitle: 'Export nights (CSV)' });
      await Sharing.shareAsync(jsonFile.uri, { mimeType: 'application/json', dialogTitle: 'Export everything (JSON)' });
    } finally {
      setBusy(null);
    }
  };

  const deleteLocal = () =>
    Alert.alert('Delete all data on this phone?', 'Nights, clips and logs on this phone are removed. Nights already synced to your account stay there.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          for (const p of await allClipPaths(db)) removeClipFile(p);
          for (const p of await allSoundPaths(db)) removeSoundFile(p);
          await deleteAllLocalData(db);
          await load();
          router.replace('/onboarding/microphone');
        },
      },
    ]);

  const toggleWeather = async (on: boolean) => {
    const granted = on ? await askForLocation() : false;
    if (on && !granted) {
      Alert.alert('Location is off for Nightwatch', 'Allow approximate location for Nightwatch in your phone’s settings to see the weather.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
    }
    await setSetting(db, 'weather', granted ? 'on' : 'off');
    await load();
  };

  const deleteSound = () =>
    Alert.alert('Delete all sound recordings?', 'The recorded sound of every night is removed from this phone. Scores, timelines and saved clips stay.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          for (const p of await allSoundPaths(db)) removeSoundFile(p);
          await deleteAllSoundRows(db);
          await load();
        },
      },
    ]);

  const deleteAccount = () =>
    Alert.alert(
      'Delete your account?',
      'This deletes your account and every night synced to it. If you contribute, your nights are removed from the community figures at the next nightly update. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete account',
          style: 'destructive',
          onPress: async () => {
            setBusy('delete');
            try {
              if (api.configured) await api.deleteAccount();
              for (const p of await allClipPaths(db)) removeClipFile(p);
              for (const p of await allSoundPaths(db)) removeSoundFile(p);
              await deleteAllLocalData(db);
              await signOut();
              router.replace('/onboarding');
            } catch (e) {
              Alert.alert('Could not delete your account', e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(null);
            }
          },
        },
      ],
    );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.bg }} edges={['bottom']}>
      <NightSky />
      <ScrollView contentContainerStyle={{ padding: space(5) }}>
        <Card>
          <H2>Account</H2>
          <Row label="Signed in" value={session?.email ?? session?.provider ?? ''} />
          <Row label="Sync now" value={lastSyncError ? 'Last sync failed' : ''} onPress={() => void sync()} />
          <Button kind="secondary" label="Sign out" onPress={() => void signOut().then(() => router.replace('/onboarding'))} style={{ marginTop: space(3) }} />
          <Button kind="link" label="Delete account" onPress={deleteAccount} />
          {busy === 'delete' ? <Small>Deleting…</Small> : null}
        </Card>

        <Card>
          <H2>Subscription</H2>
          <Body muted>{paid ? 'Your paid plan is active.' : 'Free plan: recording, scores, clips, 7 nights of history and the community ranking.'}</Body>
          {!paid ? <Button kind="secondary" label="See the paid plan" onPress={() => router.push({ pathname: '/paywall', params: { trigger: 'settings' } })} style={{ marginTop: space(3) }} /> : null}
          {config.internalTools ? (
            <ToggleRow
              label="Development: unlock paid features"
              value={devPaid}
              onChange={async (v) => {
                await setSetting(db, 'dev_paid', v ? '1' : '0');
                await refreshEntitlement();
                await load();
              }}
            />
          ) : null}
        </Card>

        <Card>
          <H2>Data and sharing</H2>
          <Row label="About you" onPress={() => router.push('/settings/profile')} />
          <Row label="Contribute to community results" onPress={() => router.push('/settings/sharing')} />
          <Row label="Export my data (CSV and JSON)" onPress={doExport} />
          <Row label="Delete all data on this phone" onPress={deleteLocal} />
        </Card>

        <Card>
          <H2>Recording</H2>
          <Small>Sensitivity: how sure the detector must be before a sound counts as snoring.</Small>
          <View style={{ marginTop: space(2) }}>
            <Segmented
              value={sensitivity}
              onChange={(v) => save('sensitivity', v)}
              options={[
                { value: 'low', label: 'Low' },
                { value: 'normal', label: 'Normal' },
                { value: 'high', label: 'High' },
              ]}
            />
          </View>
          <Small>Stop automatically at, if no alarm is set</Small>
          <View style={{ marginTop: space(2) }}>
            <Segmented value={stopHour} onChange={(v) => save('auto_stop_hour', v)} options={STOP_HOURS.map((h) => ({ value: h, label: `${h}:00` }))} />
          </View>
          <ToggleRow
            label="Record sounds during the night"
            value={soundRecordingAvailable && soundOn}
            onChange={(v) => save('sound_recording', v ? '1' : '0')}
            disabled={!soundRecordingAvailable}
            hint={
              soundRecordingAvailable
                ? `Keeps the parts of each night with sound in them, compressed, so you can listen back from the timeline. Silence is not kept. Stays on this phone and is deleted after ${SOUND_KEEP_DAYS} nights.`
                : 'Not available on this phone yet.'
            }
          />
          <Row label="Storage used by recordings" value={`${(storage / 1_000_000).toFixed(1)} MB`} />
          <Button kind="link" label="Delete sound recordings" onPress={deleteSound} />
          <ToggleRow
            label="Weather on This Morning"
            value={weatherOn}
            onChange={toggleWeather}
            disabled={!weatherConfigured}
            hint={
              weatherConfigured
                ? `Uses your approximate location, rounded to about 10 km; it is not stored. ${WEATHER_ATTRIBUTION}.`
                : 'Not available in this build.'
            }
          />
        </Card>

        <Card>
          <H2>Notifications</H2>
          <ToggleRow label="Bedtime reminder" value={bedtime !== null} onChange={(v) => setReminder(v ? '22:30' : null)} />
          {bedtime ? <Segmented value={bedtime} onChange={(v) => setReminder(v)} options={BEDTIMES.map((b) => ({ value: b, label: b }))} /> : null}
        </Card>

        <Card>
          <H2>Opening screen</H2>
          <Segmented
            value={landing}
            onChange={(v) => save('landing_tab', v === 'auto' ? null : v)}
            options={[
              { value: 'auto', label: 'By time of day' },
              { value: 'tonight', label: 'Tonight' },
              { value: 'morning', label: 'Morning' },
            ]}
          />
        </Card>

        <Card>
          <H2>Household</H2>
          <Small>Partner mode, to tell whose snoring is whose, is coming in a later update.</Small>
        </Card>

        <Card>
          <H2>Help and legal</H2>
          <Row label="Contact support" onPress={() => Linking.openURL(`mailto:${config.supportEmail}`)} />
          <Row label="How the community figures are made" onPress={() => Linking.openURL(`${config.siteUrl}/methods`)} />
          <Row label="Privacy policy" onPress={() => Linking.openURL(`${config.siteUrl}/privacy`)} />
          <Row label="Terms" onPress={() => Linking.openURL(`${config.siteUrl}/terms`)} />
          <Row label="Affiliate disclosure" onPress={() => Linking.openURL(`${config.siteUrl}/affiliate-disclosure`)} />
          <Small style={{ marginTop: space(3) }}>Nightwatch measures snoring and shows patterns. It does not diagnose any condition.</Small>
        </Card>
      </ScrollView>
    </SafeAreaView>
  );
}
