import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';

import { config } from '../../config';

import type { AggregateRowDto, AggregatesResponse } from '../../../shared/api';
import { type AmazonTags, amazonUrl } from '../../../shared/amazon';
import { segmentKey } from '../../../shared/profile';
import { loadAggregates } from '../../community/aggregates';
import { getCached } from '../../data/cacheRepo';
import { listActiveCatalogue } from '../../data/catalogueRepo';
import { AMAZON_TAGS_CACHE_KEY } from '../../data/catalogueClient';
import { listExperiments, type Experiment } from '../../data/experimentRepo';
import { nightSummaries } from '../../data/historyRepo';
import { localDateKey } from '../../domain/nightDate';
import { getProfile, profileComplete } from '../../data/profileRepo';
import type { CatalogueItem } from '../../domain/catalogue';
import { verdictText } from '../../domain/experiment';
import { type PersonalRemedy, personalRemedies } from '../../domain/personalRemedies';
import { experimentProgress, finishDueExperiments, type ExperimentProgress } from '../../experiments/progress';
import { useApp } from '../../state/AppContext';
import { ChangeBar, Sparkline } from '../../ui/charts';
import { Chip } from '../../ui/Chip';
import { HiveIcon } from '../../ui/Hive';
import { iconFor, type IconName } from '../../ui/remedyIcons';
import { BlurredBar, BlurredText, openHivePaywall, placeholderFigures } from '../../ui/Blurred';
import { Body, Button, Card, ErrorNote, GearLink, H2, Loading, Locked, Screen, Segmented, Small } from '../../ui/kit';
import { colors, space } from '../../ui/theme';

type Tab = 'mine' | 'everyone';
type Kind = 'all' | 'device' | 'habit';

export const DATA_NOTE = 'Self-reported results from app users, not medical evidence.';

export default function Remedies() {
  const { paid } = useApp();
  const [tab, setTab] = useState<Tab>('mine');
  return (
    <Screen sky="plain" eyebrow="Remedies" title={tab === 'mine' ? 'What you’ve tried' : 'What works for others'} right={<GearLink />}>
      <Segmented<Tab> value={tab} onChange={setTab} options={[{ value: 'mine', label: 'Mine' }, { value: 'everyone', label: 'Everyone', locked: !paid }]} />
      {tab === 'mine' ? <Mine /> : paid ? <Everyone /> : <HivePreview />}
    </Screen>
  );
}

/**
 * What a Bee sees on Everyone: the remedy names in honeycomb cells and the results blurred.
 * Nothing is fetched from the hive; the figures are made up and never readable.
 */
function HivePreview() {
  const db = useSQLiteContext();
  const [items, setItems] = useState<CatalogueItem[] | null>(null);

  useFocusEffect(
    useCallback(() => {
      void listActiveCatalogue(db).then((all) => setItems(all.filter((c) => c.type === 'remedy').slice(0, 8)));
    }, [db]),
  );

  const join = () => openHivePaywall('remedies');
  if (items === null) return <Loading />;
  return (
    <View>
      <Card>
        <H2>What worked for people like you</H2>
        <Body muted>Every remedy, ranked by real nights from the people who tested it. Join the hive to see what worked for people like you.</Body>
        <Button label="Join the Hive" onPress={join} style={{ marginTop: space(3) }} />
      </Card>
      {items.map((c, i) => {
        const f = placeholderFigures(i);
        return (
          <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={`${c.name}. Results are part of the Hive.`} onPress={join} style={[styles.card, styles.withIcon]}>
            <HiveIcon icon={iconFor(c)} kind="remedy" size={34} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>
                {c.name}
              </Text>
              <View style={styles.rowTop}>
                <BlurredText style={styles.delta} color={colors.good}>
                  {f.delta}
                </BlurredText>
                <BlurredBar seed={i} />
              </View>
              <BlurredText style={styles.blurredSmall} color={colors.textMuted}>
                {f.people}
              </BlurredText>
            </View>
          </Pressable>
        );
      })}
      <Small>{DATA_NOTE}</Small>
    </View>
  );
}

function Mine() {
  const db = useSQLiteContext();
  const { paid } = useApp();
  const [rows, setRows] = useState<PersonalRemedy[] | null>(null);
  const [catalogue, setCatalogue] = useState<Map<string, CatalogueItem>>(new Map());
  const [experiments, setExperiments] = useState<{ e: Experiment; p: ExperimentProgress }[]>([]);

  useFocusEffect(
    useCallback(() => {
      (async () => {
        const today = localDateKey(new Date());
        await finishDueExperiments(db, today);
        const exps = (await listExperiments(db)).filter((e) => e.status !== 'cancelled');
        setExperiments(await Promise.all(exps.map(async (e) => ({ e, p: await experimentProgress(db, e, today) }))));
        setCatalogue(new Map((await listActiveCatalogue(db)).map((c) => [c.id, c])));
        setRows(personalRemedies(await nightSummaries(db)));
      })();
    }, [db]),
  );

  if (rows === null) return <Loading />;
  const name = (id: string) => catalogue.get(id)?.name ?? id;
  const expFor = (id: string) => experiments.find((x) => x.e.remedyId === id);

  return (
    <View>
      {rows.length === 0 ? (
        <Card>
          <H2>Nothing logged yet</H2>
          <Body muted>Tick what you try on the Tonight screen before you record. After a few nights with and without, your own before and after shows here.</Body>
        </Card>
      ) : null}
      {rows.map((r) => {
        const x = expFor(r.remedyId);
        return (
          <Card key={r.remedyId} onPress={() => router.push(`/remedy/${r.remedyId}`)}>
            <View style={styles.rowTop}>
              <Text style={styles.name}>{name(r.remedyId)}</Text>
              <Sparkline values={r.recentWith} />
            </View>
            <Small>
              {r.nightsWith} nights with{r.avgWith !== null ? ` (average ${Math.round(r.avgWith)})` : ''} · {r.nightsWithout} without
              {r.avgWithout !== null ? ` (average ${Math.round(r.avgWithout)})` : ''}
            </Small>
            {r.everyNight ? <Small style={{ color: colors.accent, marginTop: space(1) }}>You’ve used this every night. Try some nights without it to see if it helps.</Small> : null}
            {x && x.p.verdict && !paid ? (
              // A Bee runs the test and logs it; the verdict is what the Hive adds.
              <Locked label="Your test is done. See its verdict" trigger="verdict" />
            ) : x ? (
              <Small style={{ marginTop: space(1), color: colors.text }}>
                {x.p.verdict ? verdictText(x.p.verdict, name(r.remedyId).toLowerCase()) : `Test running: night ${x.p.day} of 14`}
              </Small>
            ) : null}
            {!x || x.e.status !== 'running' ? <Button kind="link" label="Start a 14-night test" onPress={() => router.push(`/experiment/${r.remedyId}`)} /> : null}
          </Card>
        );
      })}
      <Button kind="secondary" label="Test a new remedy" onPress={() => router.push('/experiment/new')} />
    </View>
  );
}

function Everyone() {
  const db = useSQLiteContext();
  const { api, paid, region } = useApp();
  const [kind, setKind] = useState<Kind>('all');
  const [likeYou, setLikeYou] = useState(false);
  const [recent, setRecent] = useState(false);
  const [data, setData] = useState<AggregatesResponse | null | undefined>(undefined);
  const [fallback, setFallback] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogue, setCatalogue] = useState<Map<string, CatalogueItem>>(new Map());
  const [tags, setTags] = useState<AmazonTags>({});
  const [profileDone, setProfileDone] = useState(true);
  const [likeKey, setLikeKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    setCatalogue(new Map((await listActiveCatalogue(db)).map((c) => [c.id, c])));
    setTags((await getCached<AmazonTags>(db, AMAZON_TAGS_CACHE_KEY))?.value ?? {});
    const { profile } = await getProfile(db);
    setProfileDone(profileComplete(profile));
    const key = segmentKey(profile);
    setLikeKey(key);
    if (!api.configured) {
      setData(null);
      return;
    }
    try {
      const window = recent ? '90d' : 'all';
      const wantLikeYou = likeYou && paid && key !== null;
      let res = await loadAggregates(db, api, wantLikeYou ? key! : 'all', window);
      let fell = false;
      // Too few people like you yet: say so and show everyone.
      if (wantLikeYou && res?.data.segment_status === 'hidden') {
        res = await loadAggregates(db, api, 'all', window);
        fell = true;
      }
      setFallback(fell);
      setStale(res?.stale ?? false);
      setData(res?.data ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [api, db, likeYou, paid, recent]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const rows = useMemo(() => {
    if (!data) return { ranked: [], early: [], testing: [] as AggregateRowDto[] };
    const keep = (r: AggregateRowDto) => kind === 'all' || catalogue.get(r.remedy_id)?.kind === kind;
    const list = data.remedies.filter(keep);
    const byDelta = (a: AggregateRowDto, b: AggregateRowDto) => (a.median_delta ?? 0) - (b.median_delta ?? 0);
    return {
      ranked: list.filter((r) => r.status === 'ok').sort(byDelta),
      early: list.filter((r) => r.status === 'early').sort(byDelta),
      testing: list.filter((r) => r.status === 'hidden' && r.users > 0).sort((a, b) => b.users - a.users),
    };
  }, [catalogue, data, kind]);

  const toggleLikeYou = () => {
    if (!paid) return router.push({ pathname: '/paywall', params: { trigger: 'people_like_you' } });
    if (!likeKey) return router.push('/settings/profile');
    setLikeYou((v) => !v);
  };

  const name = (id: string) => catalogue.get(id)?.name ?? id;
  const icon = (id: string) => iconFor({ id, category: catalogue.get(id)?.category ?? '' });
  const hasShop = (r: AggregateRowDto) => {
    const item = catalogue.get(r.remedy_id);
    return r.status === 'ok' && !!item?.amazon && amazonUrl(item.amazon, region, tags) !== null;
  };

  return (
    <View>
      <Small style={{ marginBottom: space(3) }}>
        {DATA_NOTE}{' '}
        <Text style={{ color: colors.accent }} onPress={() => Linking.openURL(`${config.siteUrl}/methods`)}>
          How we calculate this
        </Text>
      </Small>
      <View style={styles.filters}>
        <Chip label={paid ? 'People like you' : 'People like you 🔒'} selected={likeYou && paid} onPress={toggleLikeYou} />
        <Chip label="Devices" selected={kind === 'device'} onPress={() => setKind(kind === 'device' ? 'all' : 'device')} />
        <Chip label="Habits" selected={kind === 'habit'} onPress={() => setKind(kind === 'habit' ? 'all' : 'habit')} />
        <Chip label="Last 90 days" selected={recent} onPress={() => setRecent((v) => !v)} />
      </View>
      {!profileDone ? (
        <Card onPress={() => router.push('/settings/profile')}>
          <Body>Finish your profile to see results from people like you.</Body>
        </Card>
      ) : null}
      {fallback ? <Small style={{ marginBottom: space(3) }}>Not enough people like you yet, so this shows everyone.</Small> : null}
      {stale ? <Small style={{ marginBottom: space(3) }}>Offline: showing the last results downloaded.</Small> : null}
      {error ? <ErrorNote message={`Could not load community results. ${error}`} onRetry={load} /> : null}
      {data === undefined && !error ? <Loading /> : null}
      {data === null ? (
        <Card>
          <Body muted>Community results need a connection to the SnoreHive server.</Body>
        </Card>
      ) : null}
      {data && rows.ranked.length === 0 && rows.early.length === 0 ? (
        <Card>
          <H2>Early days</H2>
          <Body muted>
            {data.testing.people} people are testing {data.testing.remedies} remedies; results appear when 30 people have tried one.
          </Body>
        </Card>
      ) : null}
      {rows.ranked.map((r, i) => (
        <RemedyRow key={r.remedy_id} rank={i + 1} row={r} name={name(r.remedy_id)} icon={icon(r.remedy_id)} shop={hasShop(r)} />
      ))}
      {rows.early.length ? <H2>Early data</H2> : null}
      {rows.early.map((r) => (
        <RemedyRow key={r.remedy_id} row={r} name={name(r.remedy_id)} icon={icon(r.remedy_id)} shop={false} muted />
      ))}
      {rows.testing.length ? <H2>Being tested</H2> : null}
      {rows.testing.map((r) => (
        <Card key={r.remedy_id} onPress={() => router.push(`/remedy/${r.remedy_id}`)}>
          <Text style={styles.name}>{name(r.remedy_id)}</Text>
          <Small>Being tested by {r.users} {r.users === 1 ? 'person' : 'people'}</Small>
        </Card>
      ))}
      {data?.stacks.length ? <H2>Combinations</H2> : null}
      {data?.stacks.map((s) => (
        <Card key={s.remedy_ids.join('+')}>
          <Text style={styles.name}>
            {name(s.remedy_ids[0])} + {name(s.remedy_ids[1])}
          </Text>
          <View style={styles.rowTop}>
            <Text style={[styles.delta, { color: s.median_delta < 0 ? colors.good : colors.worse }]}>
              {s.median_delta > 0 ? '+' : ''}
              {Math.round(s.median_delta)}
            </Text>
            <ChangeBar median={s.median_delta} p25={s.p25} p75={s.p75} />
          </View>
          <Small>
            {s.users} people · {s.nights} nights
          </Small>
        </Card>
      ))}
    </View>
  );
}

function RemedyRow({ row, name, icon, shop, rank, muted }: { row: AggregateRowDto; name: string; icon: IconName; shop: boolean; rank?: number; muted?: boolean }) {
  const d = row.median_delta ?? 0;
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/remedy/${row.remedy_id}`)} style={[styles.card, styles.withIcon]}>
      <HiveIcon icon={icon} kind="remedy" size={34} />
      <View style={{ flex: 1 }}>
        <View style={styles.rowTop}>
          <Text style={styles.name} numberOfLines={1}>
            {rank ? `${rank}. ` : ''}
            {name}
            {shop ? '  🛒' : ''}
          </Text>
          {row.trend === 'better' ? <Small>↗ improving</Small> : row.trend === 'worse' ? <Small>↘ fading</Small> : null}
        </View>
        <View style={styles.rowTop}>
          <Text style={[styles.delta, { color: muted ? colors.textMuted : d < 0 ? colors.good : colors.worse }]}>
            {d > 0 ? '+' : ''}
            {Math.round(d)} points
          </Text>
          <ChangeBar median={d} p25={row.p25 ?? d} p75={row.p75 ?? d} muted={muted} />
        </View>
        <Small>
          {row.users} people · {row.nights} nights
          {row.holds_without_alcohol === true ? ' · ✓ holds without alcohol nights' : row.holds_without_alcohol === false ? ' · may be explained by alcohol nights' : ''}
        </Small>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: 22, borderWidth: 1, borderColor: colors.border, padding: space(4), marginBottom: space(3) },
  withIcon: { flexDirection: 'row', alignItems: 'flex-start', gap: space(3) },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space(3), marginBottom: space(1) },
  name: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1 },
  delta: { fontSize: 18, fontWeight: '800' },
  blurredSmall: { fontSize: 13, lineHeight: 18 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2), marginBottom: space(4) },
});
