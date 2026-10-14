import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { setSetting } from '../../data/settingsRepo';
import { getHealthSource } from '../../health';
import { Body, Button, Screen } from '../../ui/kit';

export default function HealthStep() {
  const db = useSQLiteContext();
  const source = getHealthSource();
  const next = () => router.replace('/onboarding/contribute');
  const connect = async () => {
    if (source && (await source.requestPermission().catch(() => false))) await setSetting(db, 'health_enabled', '1');
    next();
  };
  return (
    <Screen
      eyebrow="Step 5 of 6"
      title="Your watch"
      footer={
        <>
          {source ? <Button label={`Connect ${source.name}`} onPress={connect} /> : null}
          <Button kind="link" label="Skip" onPress={next} />
        </>
      }
    >
      <Body>
        If you wear a watch to bed, Nightwatch can show your sleep stages, heart rate and oxygen on the same timeline as your snoring. Health data stays on this phone; only a short nightly summary syncs to your account.
      </Body>
    </Screen>
  );
}
