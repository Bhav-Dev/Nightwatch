import Ionicons from '@expo/vector-icons/Ionicons';
import { DateTimePicker } from '@expo/ui/community/datetime-picker';
import { getCalendars } from 'expo-localization';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Alert, AppState, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { requestNotificationPermissionsAsync } from 'expo-audio';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ClockAlarm, NoisePlayer } from '../../../modules/nightwatch-recording-service/src';
import { listActiveCatalogue } from '../../data/catalogueRepo';
import { runningExperiments, type Experiment } from '../../data/experimentRepo';
import { getSetting, setSetting } from '../../data/settingsRepo';
import { planFor } from '../../domain/experiment';
import {
  DEFAULT_SLEEP_TIMER_MINUTES,
  SLEEP_SOUND_GAIN,
  SLEEP_SOUND_PREVIEW_S,
  SLEEP_SOUNDS,
  SLEEP_TIMER_MINUTES,
  type SleepSoundKind,
} from '../../domain/sleepSounds';
import { ALARM_LABEL, DEFAULT_WAKE_TIME, tonightsAlarm, wakeDate, type WakeTime } from '../../domain/wakeAlarm';
import { Button, GearLink, Segmented } from '../../ui/kit';
import { askForLocation, weatherConfigured } from '../../weather/weatherClient';
import { useApp } from '../../state/AppContext';
import { type LogTick, prefillPendingLog, setPendingTick } from '../../data/logRepo';
import { type CatalogueItem } from '../../domain/catalogue';
import { localDateKey } from '../../domain/nightDate';
import { getAudioCapture } from '../../native';
import { LogPicker } from '../../screens/LogPicker';
import { HiveCluster } from '../../ui/Hive';
import { Moon, NightSky } from '../../ui/NightSky';
import { iconFor } from '../../ui/remedyIcons';
import { colors, fonts, radius, space } from '../../ui/theme';

/** A calm greeting for the time of day. */
function greeting(now: Date): string {
  const h = now.getHours();
  if (h >= 5 && h < 12) return 'Good morning';
  if (h >= 12 && h < 18) return 'Good afternoon';
  if (h >= 18 && h < 22) return 'Good evening';
  return 'Time for bed';
}

const TIPS = [
  'Place the phone on the bedside table, screen down is fine.',
  'Plug the phone in so the battery lasts the night.',
  'Turn on Do Not Disturb so calls do not stop the recording. Alarms still ring.',
  'Airplane mode is fine; recording does not need a connection.',
];

/** A time of day in the phone's own 12 or 24-hour style. */
const clockTime = (time: Date, uses24h: boolean) =>
  time.toLocaleTimeString([], { hour: uses24h ? '2-digit' : 'numeric', minute: '2-digit', hour12: !uses24h });

/** Free-text remedies are logged as "other:<text>" and sent to the catalogue review queue. */
const OTHER_PREFIX = 'other:';

export default function Tonight() {
  const db = useSQLiteContext();
  const { api } = useApp();
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]);
  const [ticks, setTicks] = useState<Map<string, LogTick>>(new Map());
  const [picker, setPicker] = useState<'remedy' | 'factor' | null>(null);
  const [plans, setPlans] = useState<{ experiment: Experiment; plan: 'with' | 'without' }[]>([]);
  const [sleepSound, setSleepSound] = useState<SleepSoundKind | 'off'>('off');
  const [sleepMinutes, setSleepMinutes] = useState<number>(DEFAULT_SLEEP_TIMER_MINUTES);
  const [previewing, setPreviewing] = useState(false);
  /** The phone's own alarm for tomorrow morning (epoch ms), from its Clock app. */
  const [alarmAt, setAlarmAt] = useState<number | null>(null);
  const [pickingWake, setPickingWake] = useState(false);
  const uses24h = useMemo(() => getCalendars()[0]?.uses24hourClock ?? true, []);
  /** Offer weather on the morning screen until it has been answered once. */
  const [offerWeather, setOfferWeather] = useState(false);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const today = useMemo(() => new Date(), []);
  const tip = TIPS[today.getDate() % TIPS.length];

  const stopPreview = useCallback(() => {
    if (previewTimer.current) clearTimeout(previewTimer.current);
    previewTimer.current = null;
    setPreviewing(false);
    void NoisePlayer.stop();
  }, []);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const kind = (await getSetting(db, 'sleep_sound')) as SleepSoundKind | null;
        setSleepSound(kind && SLEEP_SOUNDS.some((s) => s.kind === kind) ? kind : 'off');
        setSleepMinutes(Number((await getSetting(db, 'sleep_sound_minutes')) ?? DEFAULT_SLEEP_TIMER_MINUTES));
        setOfferWeather(weatherConfigured && (await getSetting(db, 'weather')) === null);
      })();
      // Leaving the screen ends a preview.
      return () => stopPreview();
    }, [db, stopPreview]),
  );

  const chooseSleepSound = async (kind: SleepSoundKind | 'off') => {
    stopPreview();
    setSleepSound(kind);
    await setSetting(db, 'sleep_sound', kind === 'off' ? null : kind);
  };

  const chooseSleepMinutes = async (minutes: number) => {
    setSleepMinutes(minutes);
    await setSetting(db, 'sleep_sound_minutes', String(minutes));
  };

  const readAlarm = useCallback(() => {
    setAlarmAt(ClockAlarm.available ? tonightsAlarm(ClockAlarm.next(), Date.now()) : null);
  }, []);

  useFocusEffect(
    useCallback(() => {
      readAlarm();
      // Back from the Clock app, where the alarm may have changed.
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') readAlarm();
      });
      return () => sub.remove();
    }, [readAlarm]),
  );

  /** No alarm yet: one is added to the Clock app, which then rings it whatever happens here. */
  const addAlarm = (time: WakeTime) => {
    if (!ClockAlarm.set(time.hour, time.minute, ALARM_LABEL)) {
      Alert.alert('Alarm not set', 'Your phone’s Clock app did not take the alarm. Set one there instead.');
      return;
    }
    // The Clock app schedules it a moment later.
    setTimeout(readAlarm, 1000);
    setTimeout(readAlarm, 3000);
  };

  const changeAlarm = () => {
    if (!ClockAlarm.showAll()) Alert.alert('No Clock app', 'Change the alarm in the app you use for alarms.');
  };

  const answerWeather = async (yes: boolean) => {
    const granted = yes ? await askForLocation() : false;
    await setSetting(db, 'weather', granted ? 'on' : 'off');
    setOfferWeather(false);
  };

  const togglePreview = () => {
    if (previewing || sleepSound === 'off') return stopPreview();
    NoisePlayer.start(sleepSound, SLEEP_SOUND_GAIN, SLEEP_SOUND_PREVIEW_S, 2);
    setPreviewing(true);
    previewTimer.current = setTimeout(() => setPreviewing(false), SLEEP_SOUND_PREVIEW_S * 1000);
  };

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const today = localDateKey(new Date());
        const [items, pending, running] = await Promise.all([
          listActiveCatalogue(db),
          prefillPendingLog(db, today),
          runningExperiments(db),
        ]);
        // A running remedy test decides tonight's tick for that remedy.
        const todays = running
          .map((experiment) => ({ experiment, plan: planFor(experiment.started, experiment.pattern, today) }))
          .filter((p): p is { experiment: Experiment; plan: 'with' | 'without' } => p.plan !== null);
        for (const p of todays) {
          const tick = { itemId: p.experiment.remedyId, type: 'remedy' as const, value: null };
          await setPendingTick(db, tick, p.plan === 'with');
        }
        const ticksNow = todays.length ? await prefillPendingLog(db, today) : pending;
        setPlans(todays);
        setCatalogue(items);
        setTicks(new Map(ticksNow.map((t) => [t.itemId, t])));
      })();
    }, [db]),
  );

  const byId = useMemo(() => new Map(catalogue.map((c) => [c.id, c])), [catalogue]);

  /** What is ticked for tonight, in the order it was ticked, including free-text remedies. */
  const selectedFor = (type: 'remedy' | 'factor') =>
    [...ticks.values()]
      .filter((t) => t.type === type)
      .map((t): CatalogueItem | undefined =>
        t.itemId.startsWith(OTHER_PREFIX)
          ? { id: t.itemId, type: 'remedy', kind: 'habit', category: 'Other', name: t.itemId.slice(OTHER_PREFIX.length), article_md: '', link_url: null, shop: false, amazon: null, active: true, version: 0 }
          : byId.get(t.itemId),
      )
      .filter((c): c is CatalogueItem => !!c);

  const setTick = async (item: CatalogueItem, value: string | null, on: boolean) => {
    const tick: LogTick = { itemId: item.id, type: item.type, value };
    const updated = new Map(ticks);
    if (on) updated.set(item.id, tick);
    else updated.delete(item.id);
    setTicks(updated);
    await setPendingTick(db, tick, on);
  };

  const addOther = async (text: string) => {
    const name = text.trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!name) return;
    const tick = { itemId: `${OTHER_PREFIX}${name}`, type: 'remedy' as const, value: null };
    await setPendingTick(db, tick, true);
    setTicks(new Map(ticks).set(tick.itemId, tick));
    if (api.configured) void api.suggest(name).catch(() => undefined);
    setPicker(null);
  };

  /** "Alcohol, 2 units" for a factor with a value, else the name. */
  const nameWithValue = (item: CatalogueItem) => {
    const value = ticks.get(item.id)?.value;
    return value ? `${item.name}, ${value} units` : item.name;
  };

  const start = async () => {
    if (!(await getAudioCapture().requestPermission())) {
      Alert.alert('Microphone needed', 'SnoreHive needs the microphone to hear snoring. Audio stays on this phone.', [
        { text: 'Not now', style: 'cancel' },
        { text: 'Open Settings', onPress: () => Linking.openSettings() },
      ]);
      return;
    }
    // Android 13+: lets the "Recording your night" notification show. Recording works either way.
    if (Platform.OS === 'android') await requestNotificationPermissionsAsync().catch(() => undefined);
    stopPreview();
    router.push('/recording');
  };

  const chosenSound = SLEEP_SOUNDS.find((s) => s.kind === sleepSound);

  return (
    <View style={styles.screen}>
      <NightSky />
      <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <GearLink />
        </View>
        <View style={styles.hero}>
          <Moon size={128} />
          <Text style={styles.greeting}>{greeting(today)}</Text>
          <Text style={styles.date}>{today.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })}</Text>
        </View>

        {plans.map(({ experiment, plan }) => (
          <View key={experiment.id} style={styles.plan}>
            <Text style={styles.planTitle}>Remedy test</Text>
            <Text style={styles.tipBody}>
              Tonight: {plan === 'with' ? 'use' : 'no'} {(byId.get(experiment.remedyId)?.name ?? experiment.remedyId).toLowerCase()}. Your test picks the order, so the comparison is fair.
            </Text>
          </View>
        ))}

        {(['remedy', 'factor'] as const).map((type) => {
          const chosen = selectedFor(type);
          const noun = type === 'remedy' ? 'remedies' : 'factors';
          return (
            <View key={type}>
              <View style={styles.sectionRow}>
                <Text style={styles.section}>{type === 'remedy' ? 'Remedies' : 'Factors'}</Text>
                {chosen.length ? (
                  <Pressable onPress={() => setPicker(type)} accessibilityRole="button" accessibilityLabel={`Change ${noun}`} hitSlop={8}>
                    <Text style={styles.change}>Change</Text>
                  </Pressable>
                ) : null}
              </View>
              {chosen.length ? (
                <Pressable
                  onPress={() => setPicker(type)}
                  accessibilityRole="button"
                  accessibilityLabel={`${chosen.map(nameWithValue).join(', ')}. Change ${noun}`}
                  style={styles.hive}
                >
                  <HiveCluster
                    items={chosen.map((item) => ({ key: item.id, icon: iconFor(item), kind: type, badge: ticks.get(item.id)?.value ?? null }))}
                    showAdd
                  />
                  <Text style={styles.names}>{chosen.map(nameWithValue).join(' · ')}</Text>
                </Pressable>
              ) : (
                <Pressable style={styles.choose} onPress={() => setPicker(type)} accessibilityRole="button">
                  <Text style={styles.chooseLabel}>+ Choose {noun}</Text>
                  <Text style={styles.chooseHint}>
                    {type === 'remedy' ? 'What you are trying tonight, like side sleeping or nasal strips' : 'Anything that might matter, like alcohol or a late meal'}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}

        {NoisePlayer.available || ClockAlarm.available ? (
          <View style={styles.card}>
            {NoisePlayer.available ? (
              <>
                <View style={styles.sectionRow}>
                  <Text style={styles.cardTitle}>Sleep sounds</Text>
                  {chosenSound ? (
                    <Pressable onPress={togglePreview} accessibilityRole="button" hitSlop={8}>
                      <Text style={styles.change}>{previewing ? 'Stop preview' : 'Preview'}</Text>
                    </Pressable>
                  ) : null}
                </View>
                <Segmented
                  value={sleepSound}
                  onChange={chooseSleepSound}
                  options={[{ value: 'off' as const, label: 'Off' }, ...SLEEP_SOUNDS.map((s) => ({ value: s.kind, label: s.short }))]}
                />
                {chosenSound ? (
                  <>
                    <Segmented
                      value={String(sleepMinutes)}
                      onChange={(v) => chooseSleepMinutes(Number(v))}
                      options={SLEEP_TIMER_MINUTES.map((m) => ({ value: String(m), label: `${m} min` }))}
                    />
                    <Text style={styles.cardBody}>
                      {chosenSound.description}. Fades out after {sleepMinutes} minutes, so the rest of the night records cleanly.
                    </Text>
                  </>
                ) : (
                  <Text style={styles.cardBody}>Gentle, steady noise to fall asleep to. It fades out on a timer.</Text>
                )}
              </>
            ) : null}
            {ClockAlarm.available ? (
              <View style={NoisePlayer.available ? styles.divided : undefined}>
                <Pressable
                  style={styles.alarmRow}
                  onPress={alarmAt ? changeAlarm : () => setPickingWake(true)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    alarmAt ? `Wake-up alarm at ${clockTime(new Date(alarmAt), uses24h)}. Change it in the Clock app` : 'Set a wake-up alarm'
                  }
                >
                  <Text style={styles.cardTitle}>Wake-up alarm</Text>
                  <View style={styles.alarmValue}>
                    <Text style={alarmAt ? styles.alarmTime : styles.alarmSet}>{alarmAt ? clockTime(new Date(alarmAt), uses24h) : 'Set'}</Text>
                    <Ionicons name="chevron-forward" size={18} color={colors.textFaint} />
                  </View>
                </Pressable>
                <Text style={styles.cardBody}>
                  {alarmAt
                    ? 'Your alarm, from the Clock app; tap to change it there. The recording stops just before it rings.'
                    : 'No alarm is set for the morning. Set one and it goes in your Clock app; the recording stops just before it rings.'}
                </Text>
              </View>
            ) : null}
          </View>
        ) : null}
        {pickingWake ? (
          <DateTimePicker
            value={wakeDate(DEFAULT_WAKE_TIME)}
            mode="time"
            presentation="dialog"
            is24Hour={uses24h}
            onValueChange={(_, date) => {
              setPickingWake(false);
              addAlarm({ hour: date.getHours(), minute: date.getMinutes() });
            }}
            onDismiss={() => setPickingWake(false)}
          />
        ) : null}

        {offerWeather ? (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Weather on your morning screen</Text>
            <Text style={[styles.cardBody, { marginTop: space(1) }]}>
              See what the morning is like when you wake, and whether cold or humid nights change your snoring. Uses your approximate
              location, rounded to about 10 km. It is not stored.
            </Text>
            <View style={styles.offerButtons}>
              <Button kind="secondary" label="Not now" onPress={() => answerWeather(false)} style={{ flex: 1 }} />
              <Button label="Turn on" onPress={() => answerWeather(true)} style={{ flex: 1 }} />
            </View>
          </View>
        ) : null}

      </ScrollView>

      <View style={styles.footer}>
        <Pressable accessibilityRole="button" style={styles.primary} onPress={start}>
          <Text style={styles.primaryLabel}>Start recording</Text>
        </Pressable>
        <Text style={styles.hint}>{tip}</Text>
      </View>

      <LogPicker
        visible={picker !== null}
        title={picker === 'factor' ? 'Factors tonight' : 'Remedies tonight'}
        types={picker ? [picker] : []}
        items={catalogue}
        selected={new Map([...ticks.values()].map((t) => [t.itemId, t.value]))}
        onSet={setTick}
        onAddOther={addOther}
        onClose={() => setPicker(null)}
      />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space(5), paddingBottom: space(8) },
  header: { flexDirection: 'row', justifyContent: 'flex-end' },
  hero: { alignItems: 'center', marginTop: -space(4), marginBottom: space(4) },
  greeting: { color: colors.text, fontSize: 30, fontFamily: fonts.heading, marginTop: space(1) },
  date: { color: colors.textMuted, fontSize: 15, marginTop: space(1) },
  plan: { backgroundColor: colors.surfaceRaised, borderRadius: radius.card, padding: space(4), marginBottom: space(2) },
  planTitle: { color: colors.accent, fontFamily: fonts.headingSemi, marginBottom: space(1) },
  sectionRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginTop: space(4), marginBottom: space(2) },
  section: { color: colors.textMuted, fontSize: 14, fontFamily: fonts.headingSemi },
  change: { color: colors.accent, fontSize: 15, fontWeight: '700' },
  card: {
    marginTop: space(6),
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(5),
  },
  cardTitle: { color: colors.text, fontSize: 17, fontFamily: fonts.headingSemi },
  cardBody: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  offerButtons: { flexDirection: 'row', gap: space(3), marginTop: space(4) },
  hive: { gap: space(2) },
  names: { color: colors.textMuted, fontSize: 13, lineHeight: 18 },
  choose: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.borderStrong,
    borderRadius: radius.card,
    paddingHorizontal: space(4),
    paddingVertical: space(4),
  },
  chooseLabel: { color: colors.text, fontSize: 16, fontFamily: fonts.headingSemi },
  chooseHint: { color: colors.textFaint, fontSize: 13, marginTop: space(1) },
  divided: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.borderStrong, marginTop: space(5), paddingTop: space(4) },
  alarmRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: space(1), marginBottom: space(1) },
  alarmValue: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  alarmTime: { color: colors.accent, fontSize: 20, fontFamily: fonts.heading, fontVariant: ['tabular-nums'] },
  alarmSet: { color: colors.accent, fontSize: 16, fontFamily: fonts.headingSemi },
  tipBody: { color: colors.text, fontSize: 15, lineHeight: 21 },
  footer: { padding: space(5), paddingTop: space(2) },
  primary: {
    backgroundColor: colors.accent,
    borderRadius: radius.button,
    paddingVertical: space(4.5),
    alignItems: 'center',
    boxShadow: '0px 6px 28px rgba(246, 200, 95, 0.32)',
  },
  primaryLabel: { color: colors.accentText, fontSize: 18, fontFamily: fonts.heading },
  hint: { color: colors.textFaint, textAlign: 'center', marginTop: space(2), fontSize: 13 },
});
