/**
 * Small charts drawn with react-native-svg. Rules followed throughout: one y-axis only, thin
 * marks, bars with rounded data-ends on a shared baseline, recessive grid, text in text
 * colours (never the series colour), and tap-to-inspect instead of hover.
 */
import { useId, useRef, useState } from 'react';
import { type GestureResponderEvent, type LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { colors, intensityColor } from './theme';
import { colourRuns, labelX, outlineAmplitudes, outlinePath } from './timelineShape';

function useWidth(initial = 320) {
  const [w, setW] = useState(initial);
  return [w, (e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)] as const;
}

/** Rounded top on a bar anchored to the baseline. */
function barPath(x: number, w: number, top: number, base: number): string {
  const r = Math.min(4, w / 2, (base - top) / 2);
  if (base - top <= 0.5) return '';
  return `M${x},${base} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + w - r},${top} Q${x + w},${top} ${x + w},${top + r} L${x + w},${base} Z`;
}

export interface TimelineBin {
  index: number;
  snoreS: number;
  /** Mean level above the night's floor; sets the outline's height. */
  levelDb: number;
  intensity: keyof typeof intensityColor | null;
}

/**
 * The night as a loudness outline mirrored around a centre line, in 5-minute bins: its height is
 * how loud each stretch was, and stretches with snoring are filled with their loudest intensity.
 * Below it, a slider: drag along the timeline or the slider to scrub through the night (the time
 * shows while dragging) and let go to pick that moment. Moments are marked on the slider track.
 */
export function NightTimeline({
  bins,
  startedAtS,
  onSelect,
  selected,
  recorded,
  playheadS,
  cursorS,
  highlight,
  moments,
  onStep,
  soundUntilS,
  overlay,
  height = 140,
}: {
  bins: TimelineBin[];
  startedAtS: number;
  /** A tap, or the end of a drag: the 5-minute bin and the second of the night it landed on. */
  onSelect?: (index: number, atS: number) => void;
  selected?: number | null;
  /** Stretches with recorded sound (seconds from the start), marked along the bottom. */
  recorded?: { startS: number; endS: number }[];
  /** Where playback is, in seconds from the start; drawn as a line. */
  playheadS?: number | null;
  /** The picked second, where the slider's thumb sits when nothing is playing. */
  cursorS?: number | null;
  /** The picked moment, shaded on the timeline. */
  highlight?: { startS: number; endS: number } | null;
  /** Moments to mark on the slider track. */
  moments?: { startS: number; kind: 'snore' | 'other' | 'sound' }[];
  /** Screen reader swipe up or down: the next or previous moment. */
  onStep?: (direction: 1 | -1) => void;
  /** Sleep sounds played until this second: shaded behind the outline. */
  soundUntilS?: number | null;
  /** Optional thin lines drawn under the bars (SpO2, heart rate), each scaled to its own band below the chart. */
  overlay?: { label: string; points: { x: number; y: number }[]; color: string }[];
  height?: number;
}) {
  const [width, onLayout] = useWidth();
  const [scrubS, setScrubS] = useState<number | null>(null);
  const drag = useRef<{ pageX: number; x: number; moved: boolean } | null>(null);
  const clipId = `outline-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const bottomAxis = 18;
  const sliderH = onSelect ? 30 : 0;
  const overlayH = overlay?.length ? 36 * overlay.length : 0;
  const plotH = height - bottomAxis;
  const centreY = plotH / 2;
  const step = width / Math.max(bins.length, 1);
  const totalS = Math.max(1, bins.length * 300);
  const xAt = (s: number) => (s / totalS) * width;
  const sAt = (x: number) => Math.min(totalS - 1, Math.max(0, Math.round((x / Math.max(1, width)) * totalS)));
  const outline = outlinePath(outlineAmplitudes(bins.map((b) => b.levelDb)), width, centreY, centreY - 2);
  const runs = colourRuns(bins.map((b) => b.intensity));
  const hourTicks: { x: number; label: string }[] = [];
  for (let i = 0; i < bins.length; i++) {
    const t = new Date((startedAtS + i * 300) * 1000);
    if (t.getMinutes() < 5) hourTicks.push({ x: i * step, label: `${t.getHours()}:00` });
  }
  const clock = (s: number) => new Date((startedAtS + s) * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const lineS = scrubS ?? playheadS ?? null;
  const thumbS = scrubS ?? playheadS ?? cursorS ?? (selected !== undefined && selected !== null ? selected * 300 + 150 : null);
  const sliderY = height + sliderH / 2;

  const touchX = (e: GestureResponderEvent) => {
    const d = drag.current;
    if (!d) return e.nativeEvent.locationX;
    if (Math.abs(e.nativeEvent.pageX - d.pageX) > 6) d.moved = true;
    return d.x + (e.nativeEvent.pageX - d.pageX);
  };
  const finish = (atS: number) => {
    setScrubS(null);
    drag.current = null;
    onSelect?.(Math.min(bins.length - 1, Math.floor(atS / 300)), atS);
  };

  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height + sliderH + overlayH}>
        <Defs>
          <ClipPath id={clipId}>
            <Path d={outline} />
          </ClipPath>
        </Defs>
        {soundUntilS ? <Rect x={0} y={0} width={xAt(soundUntilS)} height={plotH} rx={6} fill={colors.info} opacity={0.08} /> : null}
        {highlight ? (
          <Rect x={xAt(highlight.startS)} y={0} width={Math.max(3, xAt(highlight.endS - highlight.startS))} height={plotH} rx={2} fill={colors.text} opacity={0.12} />
        ) : null}
        <Line x1={0} x2={width} y1={centreY} y2={centreY} stroke={colors.border} strokeWidth={1} />
        <Path d={outline} fill={colors.textFaint} opacity={0.35} />
        <G clipPath={`url(#${clipId})`}>
          {runs.map((r) => (
            <Rect key={r.start} x={r.start * step} y={0} width={(r.end - r.start) * step} height={plotH} fill={intensityColor[r.key]} />
          ))}
        </G>
        {recorded?.map((r) => (
          <Rect key={r.startS} x={xAt(r.startS)} y={plotH - 4} width={Math.max(1.5, xAt(r.endS - r.startS))} height={3} rx={1.5} fill={colors.info} opacity={0.8} />
        ))}
        {lineS !== null ? (
          <Line x1={xAt(lineS)} x2={xAt(lineS)} y1={0} y2={plotH} stroke={colors.accent} strokeWidth={2} />
        ) : selected !== undefined && selected !== null && !highlight ? (
          <Line x1={(selected + 0.5) * step} x2={(selected + 0.5) * step} y1={0} y2={plotH} stroke={colors.text} strokeWidth={1} opacity={0.7} />
        ) : null}
        {hourTicks
          .filter((_, k) => hourTicks.length <= 8 || k % 2 === 0)
          .map((t) => (
            <SvgText key={t.x} x={labelX(t.x, width)} y={height - 4} fill={colors.textFaint} fontSize={10} textAnchor="middle">
              {t.label}
            </SvgText>
          ))}
        {onSelect ? (
          <G>
            <Line x1={6} x2={width - 6} y1={sliderY} y2={sliderY} stroke={colors.border} strokeWidth={4} strokeLinecap="round" />
            {moments
              ?.filter((m) => m.kind !== 'sound')
              .map((m) => (
                <Rect key={m.startS} x={xAt(m.startS) - 1} y={sliderY - 4} width={2} height={8} rx={1} fill={m.kind === 'snore' ? colors.accent : colors.textMuted} />
              ))}
            {thumbS !== null ? (
              <Circle cx={Math.min(width - 9, Math.max(9, xAt(thumbS)))} cy={sliderY} r={scrubS !== null ? 10 : 8} fill={colors.text} stroke={colors.accent} strokeWidth={2} />
            ) : null}
          </G>
        ) : null}
        {overlay?.map((o, k) => {
          const top = height + sliderH + k * 36 + 6;
          const ys = o.points.map((p) => p.y);
          const lo = Math.min(...ys);
          const hi = Math.max(...ys);
          const sy = (y: number) => top + 24 - ((y - lo) / Math.max(1, hi - lo)) * 24;
          const sx = (x: number) => (x / Math.max(1, bins.length * 300)) * width;
          const d = o.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
          return (
            <Path key={o.label} d={d} stroke={o.color} strokeWidth={2} fill="none" strokeLinejoin="round" />
          );
        })}
      </Svg>
      {overlay?.map((o, k) => (
        <Text key={o.label} style={{ position: 'absolute', left: 0, top: height + sliderH + k * 36 - 6, color: colors.textMuted, fontSize: 11 }}>
          {o.label}
        </Text>
      ))}
      {scrubS !== null ? (
        <View pointerEvents="none" style={[chartStyles.bubble, { left: Math.min(width - 64, Math.max(0, xAt(scrubS) - 32)) }]}>
          <Text style={chartStyles.bubbleText}>{clock(scrubS)}</Text>
        </View>
      ) : null}
      {onSelect ? (
        <View
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Timeline"
          accessibilityHint="Swipe up or down to move between moments. Drag to scrub through the night."
          accessibilityValue={{ text: thumbS !== null ? clock(thumbS) : 'Nothing picked' }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={(e) => onStep?.(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          // Once a sideways drag has started, the screen does not take it over to scroll.
          onResponderTerminationRequest={() => !drag.current?.moved}
          onResponderGrant={(e) => {
            drag.current = { pageX: e.nativeEvent.pageX, x: e.nativeEvent.locationX, moved: false };
            setScrubS(sAt(e.nativeEvent.locationX));
          }}
          onResponderMove={(e) => setScrubS(sAt(touchX(e)))}
          onResponderRelease={(e) => finish(sAt(touchX(e)))}
          onResponderTerminate={() => {
            drag.current = null;
            setScrubS(null);
          }}
          style={{ position: 'absolute', left: 0, top: 0, width, height: height + sliderH }}
        />
      ) : null}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  bubble: { position: 'absolute', top: -6, width: 64, alignItems: 'center', backgroundColor: colors.surfaceRaised, borderRadius: 8, paddingVertical: 2 },
  bubbleText: { color: colors.text, fontSize: 12, fontWeight: '700' },
});

/** One series over time on a single 0–100 axis, with an optional moving average. */
export function TrendChart({
  values,
  average,
  max = 100,
  height = 180,
  format = (v: number) => String(Math.round(v)),
  onSelect,
  selected,
}: {
  values: (number | null)[];
  average?: (number | null)[];
  max?: number;
  height?: number;
  format?: (v: number) => string;
  onSelect?: (i: number) => void;
  selected?: number | null;
}) {
  const [width, onLayout] = useWidth();
  const left = 28;
  const pad = 8;
  const plotW = width - left - pad;
  const x = (i: number) => left + (values.length <= 1 ? plotW / 2 : (i / (values.length - 1)) * plotW);
  const y = (v: number) => pad + (1 - v / max) * (height - 2 * pad);
  const path = (vs: (number | null)[]) => {
    let d = '';
    let pen = false;
    vs.forEach((v, i) => {
      if (v === null) {
        pen = false;
        return;
      }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)} `;
      pen = true;
    });
    return d;
  };
  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        {[0, 0.5, 1].map((f) => (
          <Line key={f} x1={left} x2={width - pad} y1={y(f * max)} y2={y(f * max)} stroke={colors.border} strokeWidth={1} />
        ))}
        {[0, 0.5, 1].map((f) => (
          <SvgText key={`t${f}`} x={0} y={y(f * max) + 4} fill={colors.textFaint} fontSize={10}>
            {format(f * max)}
          </SvgText>
        ))}
        {average ? <Path d={path(average)} stroke={colors.accent} strokeWidth={2} fill="none" strokeLinejoin="round" /> : null}
        <Path d={path(values)} stroke={colors.info} strokeWidth={2} fill="none" strokeLinejoin="round" opacity={average ? 0.6 : 1} />
        {values.map((v, i) =>
          v === null ? null : (
            <Circle key={i} cx={x(i)} cy={y(v)} r={selected === i ? 5 : 3} fill={colors.info} stroke={colors.surface} strokeWidth={2} />
          ),
        )}
      </Svg>
      {onSelect ? (
        <View style={{ position: 'absolute', left, top: 0, right: pad, height, flexDirection: 'row' }}>
          {values.map((_, i) => (
            <Pressable key={i} style={{ flex: 1 }} onPress={() => onSelect(i)} accessibilityLabel={`Night ${i + 1}`} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function Sparkline({ values, width = 80, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return <View style={{ width, height }} />;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const d = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${((i / (values.length - 1)) * (width - 4) + 2).toFixed(1)},${(height - 2 - ((v - lo) / Math.max(1, hi - lo)) * (height - 4)).toFixed(1)}`)
    .join(' ');
  return (
    <Svg width={width} height={height} accessibilityLabel="Score trend">
      <Path d={d} stroke={colors.info} strokeWidth={2} fill="none" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * Median change with its interquartile band on a shared −40…+40 scale centred on zero.
 * Negative (a lower snore score) is improvement.
 */
export function ChangeBar({ median, p25, p75, muted, width = 120, height = 18, range = 40 }: { median: number; p25: number; p75: number; muted?: boolean; width?: number; height?: number; range?: number }) {
  const x = (v: number) => ((Math.max(-range, Math.min(range, v)) + range) / (2 * range)) * width;
  const color = muted ? colors.textFaint : median < 0 ? colors.good : colors.worse;
  return (
    <Svg width={width} height={height} accessibilityLabel={`Median change ${Math.round(median)} points, middle half ${Math.round(p25)} to ${Math.round(p75)}`}>
      <Line x1={x(0)} x2={x(0)} y1={0} y2={height} stroke={colors.borderStrong} strokeWidth={1} />
      <Rect x={Math.min(x(p25), x(p75))} y={height / 2 - 3} width={Math.max(2, Math.abs(x(p75) - x(p25)))} height={6} rx={3} fill={color} opacity={0.35} />
      <Circle cx={x(median)} cy={height / 2} r={5} fill={color} stroke={colors.surface} strokeWidth={2} />
    </Svg>
  );
}

/** Distribution of per-person results in 5-point buckets. */
export function Histogram({ buckets, mark, height = 120 }: { buckets: { bucket: number; count: number }[]; mark?: number | null; height?: number }) {
  const [width, onLayout] = useWidth();
  const n = buckets.length;
  const gap = 2;
  const bw = (width - gap * (n - 1)) / Math.max(1, n);
  const max = Math.max(1, ...buckets.map((b) => b.count));
  const base = height - 16;
  const markIdx = mark === null || mark === undefined ? -1 : buckets.findIndex((b) => mark >= b.bucket && mark < b.bucket + 5);
  return (
    <View onLayout={onLayout}>
      <Svg width={width} height={height}>
        <Line x1={0} x2={width} y1={base} y2={base} stroke={colors.border} />
        {buckets.map((b, i) => {
          const x = i * (bw + gap);
          const h = (b.count / max) * (base - 6);
          return <Path key={b.bucket} d={barPath(x, bw, base - h, base)} fill={b.bucket < 0 ? colors.good : colors.worse} opacity={i === markIdx ? 1 : 0.55} />;
        })}
        {markIdx >= 0 ? (
          <Line x1={markIdx * (bw + gap) + bw / 2} x2={markIdx * (bw + gap) + bw / 2} y1={0} y2={base} stroke={colors.text} strokeWidth={2} strokeDasharray="3,3" />
        ) : null}
        {[0, Math.floor(n / 2), n - 1].map((i) =>
          buckets[i] ? (
            <SvgText key={i} x={Math.min(width - 24, i * (bw + gap))} y={height - 2} fill={colors.textFaint} fontSize={10}>
              {buckets[i].bucket > 0 ? `+${buckets[i].bucket}` : buckets[i].bucket}
            </SvgText>
          ) : null,
        )}
      </Svg>
    </View>
  );
}
