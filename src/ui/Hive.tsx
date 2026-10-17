import { useId, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';

import { scoreLabel } from '../domain/scoring';
import { colors, fonts, honey } from './theme';

/**
 * Honeycomb pieces, after the logo's cell: a pointy-topped hexagon with softened corners. Used
 * where the hive means something (your score, your nights) and never for things to tap through.
 */

/** A pointy-topped hexagon centred on (cx, cy) with circumradius r, corners rounded over `corner`. */
export function hexPath(cx: number, cy: number, r: number, corner = r * 0.16): string {
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  });
  const n = (v: number) => Math.round(v * 10) / 10;
  return (
    pts
      .map((p, i) => {
        const toward = (q: readonly [number, number]) => {
          const [dx, dy] = [q[0] - p[0], q[1] - p[1]];
          const len = Math.hypot(dx, dy);
          return [p[0] + (dx / len) * corner, p[1] + (dy / len) * corner];
        };
        const [a, b] = [toward(pts[(i + 5) % 6]), toward(pts[(i + 1) % 6])];
        return `${i ? 'L' : 'M'}${n(a[0])},${n(a[1])} Q${n(p[0])},${n(p[1])} ${n(b[0])},${n(b[1])}`;
      })
      .join(' ') + 'Z'
  );
}

/** Width of a pointy-topped hexagon of the given height. */
export const hexWidth = (height: number) => (height * Math.sqrt(3)) / 2;

/** The night's score in a honey-outlined cell (This Morning). */
export function ScoreCell({ score, height = 120 }: { score: number; height?: number }) {
  const id = `score${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const width = hexWidth(height);
  const stroke = height * 0.05;
  return (
    <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`Snore score ${score}, ${scoreLabel(score)}`}>
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            {honey.map((c, i) => (
              <Stop key={c} offset={i / (honey.length - 1)} stopColor={c} />
            ))}
          </LinearGradient>
        </Defs>
        <Path
          d={hexPath(width / 2, height / 2, height / 2 - stroke / 2)}
          fill="rgba(246, 200, 95, 0.08)"
          stroke={`url(#${id})`}
          strokeWidth={stroke}
          strokeLinejoin="round"
        />
      </Svg>
      <Text style={{ color: colors.text, fontSize: height * 0.42, fontFamily: fonts.heading }} importantForAccessibility="no">
        {score}
      </Text>
    </View>
  );
}

/** Brighter means louder, from a dim indigo for a quiet night to pale honey for an epic one. */
const NIGHT_COLOUR: Record<string, string> = { Quiet: '#3A4085', Light: '#9A8344', Moderate: '#D9B45C', Loud: '#F6C85F', Epic: '#FFE6A8' };
export const NIGHT_LEGEND = Object.entries(NIGHT_COLOUR).map(([label, colour]) => ({ label, colour }));

export interface HiveDay {
  key: string;
  /** The night recorded that day, if any. */
  night: { id: string; score: number } | null;
}

/**
 * "Your hive of nights": one cell a day, a week to a row, oldest first, every other row shifted
 * half a cell like a honeycomb. Tapping a night opens it. The last day is outlined.
 */
export function NightsHive({ days, onOpen }: { days: readonly HiveDay[]; onOpen: (nightId: string) => void }) {
  const [width, setWidth] = useState(0);
  const perRow = 7;
  const gap = 4;
  const rows = Math.ceil(days.length / perRow);
  // Seven cells and the half-cell shift of alternate rows fit the width.
  const cellW = width > 0 ? (width - gap * (perRow - 1)) / (perRow + (rows > 1 ? 0.5 : 0)) : 0;
  const cellH = (cellW * 2) / Math.sqrt(3);
  const rowStep = cellH * 0.75 + gap * 0.87;
  const height = rows > 0 ? cellH + (rows - 1) * rowStep : 0;
  const recorded = days.filter((d) => d.night).length;
  return (
    <View
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      accessible
      accessibilityLabel={`Your nights as honeycomb cells, brighter for louder: ${recorded} of the last ${days.length} days recorded.`}
    >
      {width > 0 ? (
        <Svg width={width} height={height}>
          {days.map((d, i) => {
            const row = Math.floor(i / perRow);
            const col = i % perRow;
            const cx = cellW / 2 + col * (cellW + gap) + (row % 2 ? (cellW + gap) / 2 : 0);
            const cy = cellH / 2 + row * rowStep;
            const last = i === days.length - 1;
            const path = hexPath(cx, cy, cellH / 2 - 1);
            return d.night ? (
              <Path
                key={d.key}
                d={path}
                fill={NIGHT_COLOUR[scoreLabel(d.night.score)]}
                stroke={last ? colors.text : 'none'}
                strokeWidth={last ? 2 : 0}
                onPress={() => d.night && onOpen(d.night.id)}
              />
            ) : (
              <Path key={d.key} d={path} fill="none" stroke={last ? colors.textMuted : 'rgba(191, 200, 255, 0.16)'} strokeWidth={last ? 2 : 1.2} />
            );
          })}
        </Svg>
      ) : null}
    </View>
  );
}
