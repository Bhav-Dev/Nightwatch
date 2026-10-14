import * as Notifications from 'expo-notifications';

/** Bedtime nudge and "your night is ready". Both optional; recording works without them. */

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function requestNotificationPermission(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  return (await Notifications.requestPermissionsAsync()).granted;
}

const BEDTIME_ID = 'bedtime-nudge';

export async function scheduleBedtimeNudge(hour: number, minute: number): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(BEDTIME_ID).catch(() => undefined);
  await Notifications.scheduleNotificationAsync({
    identifier: BEDTIME_ID,
    content: { title: 'Time to start tonight’s recording', body: 'Tick what you’re trying tonight, then tap Start.' },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DAILY, hour, minute },
  });
}

export async function cancelBedtimeNudge(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(BEDTIME_ID).catch(() => undefined);
}

/** After an automatic stop in the morning. */
export async function notifyNightReady(score: number): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Your night is ready', body: `Snore score ${score}. Open Nightwatch to see what happened.` },
    trigger: null,
  });
}
