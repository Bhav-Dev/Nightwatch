import * as Notifications from 'expo-notifications';

/** Bedtime nudge, "your night is ready" and the night recap. All optional; recording works without them. */

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

const RECAP_ID = 'night-recap';
/** Where tapping the recap goes. */
export const RECAP_URL = '/morning?from=recap';

/** The night recap later in the day; a newer night's recap replaces it. Never asks for permission. */
export async function scheduleRecap(at: Date, content: { title: string; body: string }): Promise<void> {
  await cancelRecap();
  if (!(await Notifications.getPermissionsAsync()).granted) return;
  await Notifications.scheduleNotificationAsync({
    identifier: RECAP_ID,
    content: { ...content, data: { url: RECAP_URL } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at },
  });
}

export async function cancelRecap(): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(RECAP_ID).catch(() => undefined);
}

/** Opens the screen a tapped notification points at (the recap), including when it launched the app. */
export function watchNotificationLinks(open: (url: string) => void): () => void {
  const go = (r: Notifications.NotificationResponse | null) => {
    const url = r?.notification.request.content.data?.url;
    if (typeof url === 'string') open(url);
  };
  go(Notifications.getLastNotificationResponse());
  const sub = Notifications.addNotificationResponseReceivedListener(go);
  return () => sub.remove();
}

/** After an automatic stop in the morning. */
export async function notifyNightReady(score: number): Promise<void> {
  await Notifications.scheduleNotificationAsync({
    content: { title: 'Your night is ready', body: `Snore score ${score}. Open Nightwatch to see what happened.` },
    trigger: null,
  });
}
