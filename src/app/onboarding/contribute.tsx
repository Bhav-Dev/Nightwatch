import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useState } from 'react';
import { Alert } from 'react-native';

import { track } from '../../analytics';
import { getSetting, setSetting } from '../../data/settingsRepo';
import { CONTRIBUTION_BODY, CONTRIBUTION_TITLE } from '../../screens/contributionCopy';
import { useApp } from '../../state/AppContext';
import { Body, Button, Card, H2, Screen, ToggleRow } from '../../ui/kit';
import { space } from '../../ui/theme';

export default function Contribute() {
  const db = useSQLiteContext();
  const { api } = useApp();
  // Default off, per the spec.
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);

  const finish = async () => {
    setBusy(true);
    try {
      if (on && api.configured) await api.setContribution(true);
      await setSetting(db, 'contribution_opted_in', on ? '1' : '0');
      await setSetting(db, 'onboarding_complete', '1');
      track({
        name: 'onboarding_complete',
        mic: true,
        notifications: (await getSetting(db, 'bedtime_reminder')) !== null,
        health: (await getSetting(db, 'health_enabled')) === '1',
        contribute: on,
      });
      if (on) track({ name: 'contribution_toggled', on: true });
      router.replace('/tonight');
    } catch (e) {
      Alert.alert('Could not save your choice', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen eyebrow="Step 6 of 6" title="Contribute" footer={<Button label="Done" onPress={finish} busy={busy} />}>
      <Card>
        <H2>{CONTRIBUTION_TITLE}</H2>
        <Body>{CONTRIBUTION_BODY}</Body>
      </Card>
      <ToggleRow label="Add my nights to the shared results" value={on} onChange={setOn} hint="You can change this any time in Settings." />
      <Button kind="link" label="Exactly what we share" onPress={() => router.push('/settings/sharing')} style={{ marginTop: space(2) }} />
    </Screen>
  );
}
