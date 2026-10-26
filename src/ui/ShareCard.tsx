import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';

import type { Bin } from '../domain/scoring';
import { intensityFor, scoreLabel } from '../domain/scoring';
import type { PeriodSummary, ShareKind } from '../domain/shareCard';
import { APP_NAME } from '../brand';
import { hexPath, NIGHT_LEGEND, ScoreCell } from './Hive';
import { Logo } from './Logo';
import { outlineAmplitudes } from './timelineShape';
import { colors, fonts, intensityColor, sky } from './theme';

/**
 * A night, week or month as an image to post (Reddit, Instagram, a group chat). Laid out at
 * 360 × 450 points and saved at 1080 × 1350 (4:5, which every feed shows uncropped). The logo
 * and name ride along on every share; the card carries snoring figures only.
 */
export const CARD_W = 360;
export const CARD_H = 450;

export type ShareCardData =
  | {
      kind: 'night';
      /** "Monday 26 October" */
      dateLabel: string;
      score: number;
      label: string;
      highlight: string;
      stats: { label: string; value: string }[];
      bins: readonly Bin[];
    }
  | {
      kind: Exclude<ShareKind, 'night'>;
      /** "20 – 26 Oct" */
      rangeLabel: string;
      summary: PeriodSummary;
      highlight: string;
    };

const NIGHT_COLOUR = new Map(NIGHT_LEGEND.map((l) => [l.label, l.colour]));
const cellColour = (label: string) => NIGHT_COLOUR.get(label) ?? colors.textFaint;
/** Text on a cell: dark on the honey shades, light on the quiet indigo. */
const cellText = (label: string) => (label === 'Quiet' ? colors.text : colors.accentText);

export function ShareCard({ data }: { data: ShareCardData }) {
  return (
    <View style={styles.card} collapsable={false}>
      <Svg width={CARD_W} height={CARD_H} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id="cardSky" x1="0" y1="0" x2="0" y2="1">
            {sky.night.map((c, i) => (
              <Stop key={c} offset={i / (sky.night.length - 1)} stopColor={c} />
            ))}
          </LinearGradient>
          <Pattern id="cardComb" width={34.64} height={60} patternUnits="userSpaceOnUse">
            <Path d="M17.32,0 L34.64,10 L34.64,30 L17.32,40 L0,30 L0,10 Z M17.32,40 L17.32,60" fill="none" stroke={colors.accent} strokeOpacity={0.07} strokeWidth={1} />
          </Pattern>
          <RadialGradient id="cardGlow" cx="50%" cy="38%" r="45%">
            <Stop offset={0} stopColor={colors.accent} stopOpacity={0.16} />
            <Stop offset={1} stopColor={colors.accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect width={CARD_W} height={CARD_H} fill="url(#cardSky)" />
        <Rect width={CARD_W} height={CARD_H} fill="url(#cardComb)" />
        <Rect width={CARD_W} height={CARD_H} fill="url(#cardGlow)" />
      </Svg>

      <View style={styles.header}>
        <View style={styles.brand}>
          <Logo width={30} glow={false} />
          <Text style={styles.brandName}>{APP_NAME}</Text>
        </View>
        <Text style={styles.when}>{data.kind === 'night' ? data.dateLabel : data.rangeLabel}</Text>
      </View>

      <View style={styles.body}>{data.kind === 'night' ? <NightBody data={data} /> : <PeriodBody data={data} />}</View>

      <View style={styles.footer}>
        <Text style={styles.footerMain}>Track your snoring free with {APP_NAME}</Text>
        <Text style={styles.footerSub}>On iPhone and Android</Text>
      </View>
    </View>
  );
}

function NightBody({ data }: { data: Extract<ShareCardData, { kind: 'night' }> }) {
  const w = CARD_W - 48;
  const h = 44;
  const amps = outlineAmplitudes(data.bins.map((b) => b.meanDb));
  const step = w / Math.max(1, data.bins.length);
  return (
    <>
      <ScoreCell score={data.score} height={136} />
      <Text style={styles.label}>{data.label}</Text>
      <Text style={styles.highlight}>{data.highlight}</Text>
      {data.bins.length > 0 ? (
        <Svg width={w} height={h} style={{ marginTop: 14 }}>
          {data.bins.map((b, i) => {
            const bh = Math.max(3, amps[i] * h);
            const fill = b.snoreS > 0 ? intensityColor[intensityFor(b.maxDb)] : '#3A4085';
            return <Rect key={b.index} x={i * step + 0.5} y={(h - bh) / 2} width={Math.max(1, step - 1)} height={bh} rx={Math.min(2, step / 2)} fill={fill} />;
          })}
        </Svg>
      ) : null}
      <View style={styles.stats}>
        {data.stats.map((s) => (
          <View key={s.label} style={styles.stat}>
            <Text style={styles.statValue}>{s.value}</Text>
            <Text style={styles.statLabel}>{s.label}</Text>
          </View>
        ))}
      </View>
    </>
  );
}

function PeriodBody({ data }: { data: Extract<ShareCardData, { kind: 'week' | 'month' }> }) {
  const { summary } = data;
  return (
    <>
      <Text style={styles.title}>{data.kind === 'week' ? 'My week of snoring' : 'My month of snoring'}</Text>
      {data.kind === 'week' ? <WeekCells days={summary.days} /> : <MonthHive days={summary.days} />}
      <View style={styles.averageRow}>
        {summary.average !== null ? <ScoreCell score={summary.average} height={78} /> : null}
        <View style={{ flexShrink: 1 }}>
          <Text style={styles.averageLabel}>{summary.average !== null ? `Average · ${summary.label}` : 'No full nights yet'}</Text>
          <Text style={styles.periodHighlight}>{data.highlight}</Text>
        </View>
      </View>
    </>
  );
}

/** Seven cells across, each with its night's score and the day under it. */
function WeekCells({ days }: { days: PeriodSummary['days'] }) {
  const cellW = 40;
  const cellH = (cellW * 2) / Math.sqrt(3);
  return (
    <View style={styles.weekRow}>
      {days.map((d) => {
        const date = new Date(Number(d.key.slice(0, 4)), Number(d.key.slice(5, 7)) - 1, Number(d.key.slice(8, 10)));
        const name = d.score !== null ? scoreLabel(d.score) : null;
        return (
          <View key={d.key} style={{ alignItems: 'center', gap: 6 }}>
            <View style={{ width: cellW, height: cellH }}>
              <Svg width={cellW} height={cellH}>
                {name ? (
                  <Path d={hexPath(cellW / 2, cellH / 2, cellH / 2 - 1)} fill={cellColour(name)} />
                ) : (
                  <Path d={hexPath(cellW / 2, cellH / 2, cellH / 2 - 1)} fill="none" stroke="rgba(191, 200, 255, 0.25)" strokeWidth={1.2} />
                )}
              </Svg>
              {name && d.score !== null ? (
                <View style={[StyleSheet.absoluteFill, styles.center]}>
                  <Text style={[styles.cellScore, { color: cellText(name) }]}>{d.score}</Text>
                </View>
              ) : null}
            </View>
            <Text style={styles.dayName}>{date.toLocaleDateString(undefined, { weekday: 'narrow' })}</Text>
          </View>
        );
      })}
    </View>
  );
}

/** A honeycomb of the month: a cell a day, a week to a row, alternate rows shifted half a cell. */
function MonthHive({ days }: { days: PeriodSummary['days'] }) {
  const perRow = 7;
  const gap = 4;
  const width = CARD_W - 64;
  const cellW = (width - gap * (perRow - 1 + 0.5)) / (perRow + 0.5);
  const cellH = (cellW * 2) / Math.sqrt(3);
  const rows = Math.ceil(days.length / perRow);
  const rowStep = cellH * 0.75 + gap * 0.87;
  const height = cellH + (rows - 1) * rowStep + 2;
  return (
    <Svg width={width} height={height} style={{ marginTop: 14 }}>
      {days.map((d, i) => {
        const row = Math.floor(i / perRow);
        const col = i % perRow;
        const cx = cellW / 2 + col * (cellW + gap) + (row % 2 ? (cellW + gap) / 2 : 0);
        const cy = cellH / 2 + 1 + row * rowStep;
        const path = hexPath(cx, cy, cellH / 2 - 1);
        return d.score !== null ? (
          <Path key={d.key} d={path} fill={cellColour(scoreLabel(d.score))} />
        ) : (
          <Path key={d.key} d={path} fill="none" stroke="rgba(191, 200, 255, 0.22)" strokeWidth={1.2} />
        );
      })}
    </Svg>
  );
}

const styles = StyleSheet.create({
  card: { width: CARD_W, height: CARD_H, overflow: 'hidden', backgroundColor: colors.bg },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 18 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandName: { color: colors.text, fontFamily: fonts.heading, fontSize: 18 },
  when: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  label: { color: colors.accent, fontFamily: fonts.heading, fontSize: 24, marginTop: 6 },
  highlight: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'center', marginTop: 4 },
  stats: { flexDirection: 'row', alignSelf: 'stretch', marginTop: 16, paddingVertical: 10, borderRadius: 16, backgroundColor: 'rgba(28, 36, 80, 0.62)' },
  stat: { flex: 1, alignItems: 'center' },
  statValue: { color: colors.text, fontSize: 17, fontWeight: '800', textTransform: 'capitalize' },
  statLabel: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  title: { color: colors.text, fontFamily: fonts.heading, fontSize: 24, textAlign: 'center' },
  weekRow: { flexDirection: 'row', gap: 4, marginTop: 18 },
  cellScore: { fontFamily: fonts.heading, fontSize: 14 },
  dayName: { color: colors.textMuted, fontSize: 12, fontWeight: '700' },
  center: { alignItems: 'center', justifyContent: 'center' },
  averageRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 18 },
  averageLabel: { color: colors.accent, fontFamily: fonts.heading, fontSize: 18 },
  periodHighlight: { color: colors.text, fontSize: 15, fontWeight: '600', marginTop: 2 },
  footer: { alignItems: 'center', paddingBottom: 16, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(170, 182, 255, 0.12)', marginHorizontal: 20 },
  footerMain: { color: colors.text, fontSize: 13, fontWeight: '700' },
  footerSub: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
});
