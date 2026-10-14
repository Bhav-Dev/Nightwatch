import { router } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';

import { setSetting } from '../../data/settingsRepo';
import { requestNotificationPermission, scheduleBedtimeNudge } from '../../notifications';
import { Body, Button, Screen } from '../../ui/kit';

export default function NotificationsStep() {
  const db = useSQLiteContext();
  const next = () => router.replace('/onboarding/about-you');
  const allow = async () => {
    if (await requestNotificationPermission().catch(() => false)) {
      await scheduleBedtimeNudge(22, 30).catch(() => undefined);
      await setSetting(db, 'bedtime_reminder', '22:30');
    }
    next();
  };
  return (
    <Screen
      eyebrow="Step 3 of 6"
      title="Notifications"
      footer={
        <>
          <Button label="Allow notifications" onPress={allow} />
          <Button kind="link" label="Skip" onPress={next} />
        </>
      }
    >
      <Body>A reminder at bedtime, and a note in the morning when your night is ready. You can change the time or turn them off in Settings.</Body>
    </Screen>
  );
}
