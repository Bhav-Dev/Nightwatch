import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';

import type { RemedyDetailResponse } from '../../../shared/api';
import { AMAZON_DISCLOSURE, type AmazonTags, amazonUrl, LINK_DISCLOSURE } from '../../../shared/amazon';
import { eligibleNights, withinUserDelta } from '../../../shared/remedyEffect';
import { loadRemedyDetail } from '../../community/aggregates';
import { config } from '../../config';
import { getCached } from '../../data/cacheRepo';
import { AMAZON_TAGS_CACHE_KEY } from '../../data/catalogueClient';
import { getCatalogueItem } from '../../data/catalogueRepo';
import { nightSummaries } from '../../data/historyRepo';
import type { CatalogueItem } from '../../domain/catalogue';
import { useApp } from '../../state/AppContext';
import { ChangeBar, Histogram } from '../../ui/charts';
import { Body, Button, Card, H2, Loading, Locked, Screen, Small } from '../../ui/kit';
import { colors, space } from '../../ui/theme';

const SEGMENT_LABEL: Record<string, string> = { age: 'Age', sex: 'Sex', bmi: 'BMI', position: 'Sleep position', pauses: 'Breathing pauses reported', apnoea: 'Apnoea or CPAP' };
const segmentLabel = (key: string) =>
  key
    .split('|')
    .map((p) => {
      const [d, v] = p.split(':');
      return `${SEGMENT_LABEL[d] ?? d} ${v.replace('_', ' ')}`;
    })
    .join(', ');

export default function RemedyDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const { api, paid, region } = useApp();
  const [item, setItem] = useState<CatalogueItem | null>(null);
  const [detail, setDetail] = useState<RemedyDetailResponse | null | undefined>(undefined);
  const [mine, setMine] = useState<number | null>(null);
  const [tags, setTags] = useState<AmazonTags>({});

  useEffect(() => {
    (async () => {
      setItem(await getCatalogueItem(db, id));
      setTags((await getCached<AmazonTags>(db, AMAZON_TAGS_CACHE_KEY))?.value ?? {});
      // Your result uses the same within-person comparison as the community figure.
      const d = withinUserDelta(eligibleNights(await nightSummaries(db)), id);
      setMine(d ? d.delta_score : null);
      setDetail(api.configured ? await loadRemedyDetail(db, api, id).catch(() => null) : null);
    })();
  }, [api, db, id]);

  const all = detail?.all ?? null;
  const product = detail?.amazon ?? item?.amazon ?? null;
  // Shop links only on remedies with real community data behind them.
  const link = all?.status === 'ok' && product ? amazonUrl(product, region, tags) : null;
  const article = detail?.article_md || item?.article_md || '';

  return (
    <Screen title={item?.name ?? ''} eyebrow={item?.category}>
      <Stack.Screen options={{ title: '' }} />
      {detail === undefined ? <Loading /> : null}
      {all && all.status !== 'hidden' ? (
        <Card>
          <H2>Everyone who tested it</H2>
          <View style={styles.big}>
            <Text style={[styles.delta, { color: all.status === 'early' ? colors.textMuted : (all.median_delta ?? 0) < 0 ? colors.good : colors.worse }]}>
              {(all.median_delta ?? 0) > 0 ? '+' : ''}
              {Math.round(all.median_delta ?? 0)} points
            </Text>
            <ChangeBar median={all.median_delta ?? 0} p25={all.p25 ?? 0} p75={all.p75 ?? 0} muted={all.status === 'early'} width={140} />
          </View>
          <Small>
            Median change in snore score with this remedy, against the same people’s own nights without it. The middle half of people saw {Math.round(all.p25 ?? 0)} to{' '}
            {Math.round(all.p75 ?? 0)}. {all.users} people, {all.nights} nights.
            {all.status === 'early' ? ' Early data: fewer than 30 people or 300 nights so far.' : ''}
          </Small>
          {all.holds_without_alcohol === false ? <Small style={{ marginTop: space(2) }}>Much of this effect disappears when alcohol nights are compared like for like.</Small> : null}
          {all.holds_without_alcohol === null ? <Small style={{ marginTop: space(2) }}>Not yet enough matched nights to check against alcohol.</Small> : null}
          {detail?.distribution.length ? (
            <>
              <Small style={{ marginTop: space(4), marginBottom: space(2) }}>How results spread across people{paid && mine !== null ? ' (dashed line: you)' : ''}</Small>
              <Histogram buckets={detail.distribution} mark={paid ? mine : null} />
            </>
          ) : null}
        </Card>
      ) : detail !== undefined ? (
        <Card>
          <Body muted>{all ? `Being tested by ${all.users} ${all.users === 1 ? 'person' : 'people'}. Results appear when 30 people have tried it.` : 'No community results for this yet.'}</Body>
        </Card>
      ) : null}

      <Card>
        <H2>Your result</H2>
        {paid ? (
          mine !== null ? (
            <Body>
              Your score was {Math.abs(Math.round(mine))} points {mine < 0 ? 'lower' : 'higher'} with this
              {all?.median_delta !== null && all?.median_delta !== undefined && all.status !== 'hidden'
                ? `, against ${Math.round(all.median_delta)} for everyone who tested it.`
                : '.'}
            </Body>
          ) : (
            <Body muted>Log at least 5 nights with it and 5 without to see your own result.</Body>
          )
        ) : (
          <Locked label="Compare your result with everyone else’s" trigger="your_result" />
        )}
        <Button kind="link" label="Run a 14-night test" onPress={() => router.push(paid ? `/experiment/${id}` : { pathname: '/paywall', params: { trigger: 'experiment' } })} />
      </Card>

      {detail?.by_segment_locked ? (
        <Locked label="See results by age, BMI and sleep position" trigger="people_like_you" />
      ) : detail?.by_segment.length ? (
        <Card>
          <H2>By group</H2>
          {detail.by_segment.map((s) => (
            <View key={s.segment} style={styles.segment}>
              <Text style={styles.segmentName}>{segmentLabel(s.segment)}</Text>
              <Text style={{ color: (s.median_delta ?? 0) < 0 ? colors.good : colors.worse, fontWeight: '700' }}>
                {(s.median_delta ?? 0) > 0 ? '+' : ''}
                {Math.round(s.median_delta ?? 0)}
              </Text>
              <Small>{s.users} people</Small>
            </View>
          ))}
        </Card>
      ) : null}

      {article ? (
        <Card>
          <H2>About this remedy</H2>
          <Body>{article}</Body>
        </Card>
      ) : null}

      {link ? (
        <Card>
          <Button label="Where to buy" onPress={() => Linking.openURL(link)} />
          <Small style={{ marginTop: space(2) }}>
            {LINK_DISCLOSURE} {AMAZON_DISCLOSURE}
          </Small>
        </Card>
      ) : null}
      <Small>
        Self-reported results from app users, not medical evidence.{' '}
        <Text style={{ color: colors.accent }} onPress={() => Linking.openURL(`${config.siteUrl}/methods`)}>
          How we calculate this
        </Text>
      </Small>
    </Screen>
  );
}

const styles = StyleSheet.create({
  big: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: space(2) },
  delta: { fontSize: 28, fontWeight: '800' },
  segment: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2), borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  segmentName: { color: colors.text, flex: 1, textTransform: 'capitalize' },
});
