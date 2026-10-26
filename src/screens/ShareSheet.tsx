import { router } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';

import { track } from '../analytics';
import type { NightRow } from '../data/nightRepo';
import { earlierScores, loadPeriodSummary } from '../data/shareRepo';
import { intensityFor, scoreLabel, type Bin } from '../domain/scoring';
import { nightHighlight, periodHighlight, SHARE_DAYS, type PeriodSummary, type ShareKind } from '../domain/shareCard';
import { useApp } from '../state/AppContext';
import { CARD_H, CARD_W, ShareCard, type ShareCardData } from '../ui/ShareCard';
import { Button, Segmented, Small } from '../ui/kit';
import { colors, fonts, radius, space } from '../ui/theme';

export interface ShareNight {
  row: NightRow;
  bins: readonly Bin[];
  /** The 7-night average This Morning compares with. */
  average7: number | null;
  /** Names of the remedies logged for the night. */
  tried: readonly string[];
}

const KIND_LABEL: Record<ShareKind, string> = { night: 'Night', week: 'Week', month: 'Month' };
const hm = (s: number) => `${Math.floor(s / 3600)}h ${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`;
const dateOf = (key: string) => new Date(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10)));

/**
 * Share a night, a week or a month as an image: a preview of the card, then the phone's share
 * sheet (Reddit, Instagram, Messages, Save image). Everyone can share a night and a week; the
 * month is for the Hive, since a Bee keeps 7 nights.
 */
export function ShareSheet({ visible, onClose, kinds, night }: { visible: boolean; onClose: () => void; kinds: readonly ShareKind[]; night?: ShareNight }) {
  const db = useSQLiteContext();
  const { paid } = useApp();
  const { width } = useWindowDimensions();
  const [kind, setKind] = useState<ShareKind>(kinds[0]);
  const [earlier, setEarlier] = useState<number[]>([]);
  const [periods, setPeriods] = useState<Partial<Record<'week' | 'month', PeriodSummary>>>({});
  const [busy, setBusy] = useState(false);
  const card = useRef<View>(null);
  // The parent re-renders often (playback), so loading keys on what is shared, not on new props.
  const kindsKey = kinds.join(',');
  const nightStartedAt = night?.row.started_at ?? null;

  useEffect(() => {
    if (!visible) return;
    const list = kindsKey.split(',') as ShareKind[];
    void (async () => {
      if (nightStartedAt !== null) setEarlier(await earlierScores(db, nightStartedAt));
      const next: Partial<Record<'week' | 'month', PeriodSummary>> = {};
      for (const k of list) if (k !== 'night') next[k] = await loadPeriodSummary(db, SHARE_DAYS[k]);
      setPeriods(next);
    })();
    // Loaded each time the sheet opens, so a new night or answer shows.
  }, [visible, db, kindsKey, nightStartedAt]);

  const data = cardData(kind, night, earlier, periods);

  const pick = (k: ShareKind) => {
    if (k === 'month' && !paid) {
      onClose();
      router.push({ pathname: '/paywall', params: { trigger: 'share_month' } });
      return;
    }
    setKind(k);
  };

  const share = async () => {
    if (!data || !card.current) return;
    if (!(await Sharing.isAvailableAsync())) return Alert.alert('Sharing is not available on this device');
    setBusy(true);
    try {
      const uri = await captureRef(card, { format: 'png', quality: 1, width: CARD_W * 3, height: CARD_H * 3, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Share your snoring' });
      track({ name: 'card_shared', kind });
    } catch (e) {
      Alert.alert('Could not make the image', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // The card is laid out at its own size and shown smaller on narrow phones.
  const scale = Math.min(1, (width - 2 * space(6)) / CARD_W);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <Text style={styles.title}>Share</Text>
          {kinds.length > 1 ? (
            <Segmented value={kind} onChange={pick} options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k], locked: k === 'month' && !paid }))} />
          ) : null}
          <View style={{ width: CARD_W * scale, height: CARD_H * scale, alignSelf: 'center', marginTop: space(4), borderRadius: radius.button, overflow: 'hidden' }}>
            <View style={{ transform: [{ scale }], transformOrigin: 'top left' }}>
              <View ref={card} collapsable={false}>
                {data ? <ShareCard data={data} /> : <View style={{ width: CARD_W, height: CARD_H, backgroundColor: colors.bg }} />}
              </View>
            </View>
          </View>
          <Small style={{ marginTop: space(3), textAlign: 'center' }}>Snoring figures only: no recordings and no watch data.</Small>
          <Button label="Share image" onPress={share} busy={busy} disabled={!data} style={{ marginTop: space(4) }} />
          <Button kind="link" label="Close" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
}

function cardData(
  kind: ShareKind,
  night: ShareNight | undefined,
  earlier: readonly number[],
  periods: Partial<Record<'week' | 'month', PeriodSummary>>,
): ShareCardData | null {
  if (kind === 'night') {
    if (!night) return null;
    const { row } = night;
    return {
      kind,
      dateLabel: new Date(row.ended_at * 1000).toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }),
      score: row.score,
      label: scoreLabel(row.score),
      highlight: nightHighlight({
        score: row.score,
        pctSnoring: row.pct_snoring,
        counts: row.counts_toward_averages === 1,
        average7: night.average7,
        earlierScores: earlier,
        tried: night.tried,
      }),
      stats: [
        { label: 'Time snoring', value: `${Math.round(row.pct_snoring * 100)}%` },
        { label: 'Time in bed', value: hm(row.time_in_bed_s) },
        { label: 'Loudest', value: row.event_count > 0 ? intensityFor(row.max_db) : '–' },
      ],
      bins: night.bins,
    };
  }
  const summary = periods[kind];
  if (!summary) return null;
  const first = dateOf(summary.days[0].key);
  const last = dateOf(summary.days[summary.days.length - 1].key);
  const day = { day: 'numeric', month: 'short' } as const;
  return {
    kind,
    rangeLabel: `${first.toLocaleDateString(undefined, day)} – ${last.toLocaleDateString(undefined, day)}`,
    summary,
    highlight: periodHighlight(summary, kind),
  };
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(3, 4, 12, 0.7)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: space(6),
    paddingBottom: space(8),
  },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 22, marginBottom: space(3) },
});
